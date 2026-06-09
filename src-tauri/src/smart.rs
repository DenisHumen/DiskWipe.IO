//! S.M.A.R.T. data collection via `smartctl --json` (smartmontools).

use crate::model::{SmartAttribute, SmartReport};
use crate::util;
use serde_json::Value;
use std::collections::BTreeMap;

/// Attributes whose non-zero raw value indicates developing failure.
const CRITICAL_ATTRS: [u64; 5] = [
    5,   // Reallocated_Sector_Ct
    187, // Reported_Uncorrect
    196, // Reallocated_Event_Count
    197, // Current_Pending_Sector
    198, // Offline_Uncorrectable
];

pub fn available() -> bool {
    util::run_capture(&util::smartctl_bin(), &["--version"])
        .map(|o| o.success)
        .unwrap_or(false)
}

pub fn report(device: &str) -> Result<SmartReport, String> {
    let v = run_smartctl(device)?;
    Ok(parse_report(device, &v))
}

fn run_smartctl(device: &str) -> Result<Value, String> {
    // Try each candidate device spelling / device-type in turn. Different drives
    // need different hints: NVMe SSDs want `-d nvme`, USB-SATA bridges want
    // `-d sat` (or a vendor-specific `-d usbjmicron`/`usbprolific`/…), and on
    // Windows the raw `\\.\PhysicalDriveN` handle sometimes only works under an
    // explicit type or the `/dev/sdX` spelling.
    //
    // Prefer the first response with *rich* data (an ATA attribute table or an
    // NVMe health log) and only fall back to a bare overall-status response when
    // nothing richer turns up. This matters for USB bridges, where the auto
    // probe often answers in SCSI mode with just `smart_status` and no
    // attributes; without this we'd stop there and never reach the `-d sat`
    // probe that returns the full health data (the way CrystalDiskInfo does).
    let mut weak: Option<Value> = None;
    let mut last: Option<Value> = None;

    for (dev, dtype) in candidate_invocations(device) {
        if let Ok(v) = invoke_smartctl(&dev, dtype, false) {
            if has_rich_payload(&v) {
                return Ok(v);
            }
            remember(&mut weak, &mut last, v);
        }
    }

    // Reading a raw device requires root on Linux. When the app runs
    // unprivileged and the bundled smartctl wasn't granted file capabilities at
    // install time (the AppImage build, or a filesystem without xattrs), retry
    // through `pkexec`, which pops a graphical PolicyKit prompt so the user can
    // authenticate once. On Windows this never runs (UAC already elevates the
    // whole process); on macOS it is a dev-only host with no devices to read.
    if cfg!(target_os = "linux") && !util::is_admin() {
        for (dev, dtype) in candidate_invocations(device) {
            match invoke_smartctl(&dev, dtype, true) {
                Ok(v) if has_rich_payload(&v) => return Ok(v),
                Ok(v) => remember(&mut weak, &mut last, v),
                // pkexec missing, or the auth dialog was dismissed — stop asking
                // rather than popping a fresh prompt for the next candidate.
                Err(_) => break,
            }
        }
    }

    weak.or(last)
        .ok_or_else(|| format!("smartctl returned no usable data for {device}"))
}

/// Stash a probe response: keep the first one with any payload as the `weak`
/// fallback, and always update `last` so we can surface *something* on failure.
fn remember(weak: &mut Option<Value>, last: &mut Option<Value>, v: Value) {
    if weak.is_none() && has_smart_payload(&v) {
        *weak = Some(v.clone());
    }
    *last = Some(v);
}

/// Whether a response carries full SMART detail — an ATA attribute table or an
/// NVMe health log — as opposed to only an overall pass/fail status.
fn has_rich_payload(v: &Value) -> bool {
    v.get("ata_smart_attributes").is_some()
        || v.get("nvme_smart_health_information_log").is_some()
}

/// Whether a response carries any usable health payload at all (rich detail, or
/// at least an overall `smart_status`).
fn has_smart_payload(v: &Value) -> bool {
    has_rich_payload(v) || v.get("smart_status").is_some()
}

/// Device-type hints to probe, in priority order. Covers internal SATA/NVMe
/// plus the USB-to-SATA and USB-to-NVMe bridges that need an explicit
/// pass-through type — the same fallbacks CrystalDiskInfo walks through. The
/// first probe that returns rich SMART data wins, so cheap auto/NVMe/SAT hits
/// short-circuit before the vendor-specific bridge types are ever tried.
const DEVICE_TYPES: [Option<&str>; 13] = [
    None,                // auto-detect (internal SATA/NVMe, modern USB bridges)
    Some("nvme"),        // NVMe SSDs (internal, and some USB-NVMe enclosures)
    Some("sat"),         // USB-SATA bridges — ATA pass-through over SCSI
    Some("sat,16"),      // bridges needing 16-byte ATA pass-through
    Some("sat,12"),      // bridges needing 12-byte ATA pass-through
    Some("usbjmicron"),  // JMicron USB-SATA bridges
    Some("usbprolific"), // Prolific USB-SATA bridges
    Some("usbsunplus"),  // SunplusIT USB-SATA bridges
    Some("usbcypress"),  // Cypress USB-SATA bridges
    Some("sntjmicron"),  // JMicron USB-NVMe enclosures
    Some("sntasmedia"),  // ASMedia USB-NVMe enclosures
    Some("ata"),         // direct ATA pass-through
    Some("scsi"),        // last-resort SCSI fallback
];

/// Ordered list of `(device, device-type)` pairs to probe for a given disk.
fn candidate_invocations(device: &str) -> Vec<(String, Option<&'static str>)> {
    #[allow(unused_mut)] // `list` is only mutated on Windows (the /dev/sdX block)
    let mut list: Vec<(String, Option<&'static str>)> =
        DEVICE_TYPES.iter().map(|&t| (device.to_string(), t)).collect();

    // Some smartmontools builds on Windows only accept the Unix-style `/dev/sdX`
    // spelling, where X maps PhysicalDrive0 -> a, 1 -> b, and so on.
    #[cfg(target_os = "windows")]
    if let Some(n) = crate::util::trailing_number(device) {
        if n < 26 {
            let letter = (b'a' + n as u8) as char;
            let sd = format!("/dev/sd{letter}");
            list.push((sd.clone(), None));
            list.push((sd.clone(), Some("sat")));
            list.push((sd, Some("nvme")));
        }
    }

    list
}

fn invoke_smartctl(device: &str, dtype: Option<&str>, elevate: bool) -> Result<Value, String> {
    let (cmd, args) = build_invocation(&util::smartctl_bin(), device, dtype, elevate);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = util::run_capture(&cmd, &arg_refs)?;
    let text = if out.stdout.trim().is_empty() {
        out.stderr
    } else {
        out.stdout
    };
    serde_json::from_str(&text).map_err(|e| format!("could not parse smartctl output: {e}"))
}

/// Build the `(command, args)` for a single smartctl probe. When `elevate` is
/// set the real command is wrapped in `pkexec`, so smartctl runs as root behind
/// a graphical PolicyKit prompt — the Linux fallback used when the binary lacks
/// the capabilities to open the device directly.
fn build_invocation(
    bin: &str,
    device: &str,
    dtype: Option<&str>,
    elevate: bool,
) -> (String, Vec<String>) {
    let mut smart_args: Vec<String> = vec!["-j".to_string(), "-a".to_string()];
    if let Some(t) = dtype {
        smart_args.push("-d".to_string());
        smart_args.push(t.to_string());
    }
    smart_args.push(device.to_string());

    if elevate {
        let mut args = Vec::with_capacity(smart_args.len() + 1);
        args.push(bin.to_string());
        args.extend(smart_args);
        ("pkexec".to_string(), args)
    } else {
        (bin.to_string(), smart_args)
    }
}

fn parse_report(device: &str, v: &Value) -> SmartReport {
    let model = first_str(v, &["model_name", "scsi_model_name", "model_family"]).unwrap_or_default();
    let serial = str_at(v, "serial_number").unwrap_or_default();
    let firmware = str_at(v, "firmware_version").unwrap_or_default();

    let capacity_bytes = v
        .pointer("/user_capacity/bytes")
        .and_then(Value::as_u64)
        .or_else(|| v.get("nvme_total_capacity").and_then(Value::as_u64))
        .unwrap_or(0);

    let temperature_c = v.pointer("/temperature/current").and_then(Value::as_i64);
    let power_on_hours = v.pointer("/power_on_time/hours").and_then(Value::as_i64);
    let power_cycles = v.get("power_cycle_count").and_then(Value::as_i64);
    let rotation_rate = v.get("rotation_rate").and_then(Value::as_i64);

    let smart_status = v.pointer("/smart_status/passed").and_then(Value::as_bool);
    let health_passed = smart_status.unwrap_or(true);

    // ATA attributes table
    let mut attributes = Vec::new();
    if let Some(table) = v.pointer("/ata_smart_attributes/table").and_then(Value::as_array) {
        for a in table {
            let id = a.get("id").and_then(Value::as_u64).unwrap_or(0);
            let name = a
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .replace('_', " ");
            let value = a.get("value").and_then(Value::as_i64).unwrap_or(0);
            let worst = a.get("worst").and_then(Value::as_i64).unwrap_or(0);
            let threshold = a.get("thresh").and_then(Value::as_i64).unwrap_or(0);
            let raw_value = a.pointer("/raw/value").and_then(Value::as_i64).unwrap_or(0);
            let raw = a
                .pointer("/raw/string")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .unwrap_or_else(|| raw_value.to_string());
            let when_failed = a.get("when_failed").and_then(Value::as_str).unwrap_or("");
            let status = attr_status(id, raw_value, when_failed).to_string();
            attributes.push(SmartAttribute {
                id,
                name,
                value,
                worst,
                threshold,
                raw,
                status,
            });
        }
    }

    // NVMe health log
    let mut nvme: Option<BTreeMap<String, i64>> = None;
    if let Some(log) = v
        .get("nvme_smart_health_information_log")
        .and_then(Value::as_object)
    {
        let mut map = BTreeMap::new();
        for (k, val) in log {
            if let Some(n) = val.as_i64() {
                map.insert(k.clone(), n);
            }
        }
        if !map.is_empty() {
            nvme = Some(map);
        }
    }

    let protocol = if nvme.is_some() {
        "NVMe".to_string()
    } else {
        str_at_ptr(v, "/device/protocol").unwrap_or_else(|| "ATA".to_string())
    };

    let has_data = smart_status.is_some() || !attributes.is_empty() || nvme.is_some();
    let overall = if !has_data {
        "unknown"
    } else if !health_passed || attributes.iter().any(|a| a.status == "bad") {
        "bad"
    } else if attributes.iter().any(|a| a.status == "warn") {
        "caution"
    } else {
        "good"
    }
    .to_string();

    SmartReport {
        device: device.to_string(),
        model,
        serial,
        firmware,
        capacity_bytes,
        temperature_c,
        power_on_hours,
        power_cycles,
        health_passed,
        overall,
        protocol,
        rotation_rate,
        attributes,
        nvme,
    }
}

fn attr_status(id: u64, raw_value: i64, when_failed: &str) -> &'static str {
    if !when_failed.is_empty() && when_failed != "-" {
        return "bad";
    }
    if CRITICAL_ATTRS.contains(&id) && raw_value > 0 {
        return "warn";
    }
    "ok"
}

fn str_at(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn str_at_ptr(v: &Value, ptr: &str) -> Option<String> {
    v.pointer(ptr)
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn first_str(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| str_at(v, k))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ata_report() {
        let json = r#"{
            "model_name": "Samsung SSD 860 EVO 1TB",
            "serial_number": "S3Z9NB0K123456",
            "firmware_version": "RVT04B6Q",
            "user_capacity": { "bytes": 1000204886016 },
            "temperature": { "current": 35 },
            "power_on_time": { "hours": 12044 },
            "power_cycle_count": 980,
            "rotation_rate": 0,
            "smart_status": { "passed": true },
            "device": { "protocol": "ATA" },
            "ata_smart_attributes": { "table": [
                { "id": 5, "name": "Reallocated_Sector_Ct", "value": 100, "worst": 100, "thresh": 10, "raw": { "value": 0, "string": "0" }, "when_failed": "" },
                { "id": 197, "name": "Current_Pending_Sector", "value": 100, "worst": 100, "thresh": 0, "raw": { "value": 3, "string": "3" }, "when_failed": "" }
            ]}
        }"#;
        let v: Value = serde_json::from_str(json).unwrap();
        let r = parse_report("/dev/sda", &v);
        assert_eq!(r.model, "Samsung SSD 860 EVO 1TB");
        assert_eq!(r.serial, "S3Z9NB0K123456");
        assert_eq!(r.capacity_bytes, 1000204886016);
        assert_eq!(r.temperature_c, Some(35));
        assert_eq!(r.protocol, "ATA");
        assert_eq!(r.attributes.len(), 2);
        // Pending sectors > 0 -> caution overall.
        assert_eq!(r.overall, "caution");
        assert_eq!(r.attributes[1].status, "warn");
    }

    #[test]
    fn failed_health_is_bad() {
        let json = r#"{ "smart_status": { "passed": false } }"#;
        let v: Value = serde_json::from_str(json).unwrap();
        let r = parse_report("/dev/sdb", &v);
        assert_eq!(r.overall, "bad");
    }

    #[test]
    fn parses_nvme_log() {
        let json = r#"{
            "model_name": "WD_BLACK SN850",
            "device": { "protocol": "NVMe" },
            "smart_status": { "passed": true },
            "nvme_smart_health_information_log": {
                "temperature": 41,
                "available_spare": 100,
                "percentage_used": 2,
                "data_units_written": 51234567
            }
        }"#;
        let v: Value = serde_json::from_str(json).unwrap();
        let r = parse_report("/dev/nvme0", &v);
        assert_eq!(r.protocol, "NVMe");
        assert!(r.nvme.is_some());
        assert_eq!(r.nvme.unwrap().get("percentage_used"), Some(&2));
        assert_eq!(r.overall, "good");
    }

    #[test]
    fn no_data_is_unknown() {
        let v: Value = serde_json::from_str("{}").unwrap();
        let r = parse_report("/dev/sdc", &v);
        assert_eq!(r.overall, "unknown");
    }

    #[test]
    fn builds_direct_invocation() {
        let (cmd, args) = build_invocation("/usr/lib/app/bin/smartctl", "/dev/sda", None, false);
        assert_eq!(cmd, "/usr/lib/app/bin/smartctl");
        assert_eq!(args, ["-j", "-a", "/dev/sda"]);
    }

    #[test]
    fn builds_elevated_invocation_via_pkexec() {
        let (cmd, args) =
            build_invocation("/usr/lib/app/bin/smartctl", "/dev/sda", Some("sat"), true);
        assert_eq!(cmd, "pkexec");
        assert_eq!(
            args,
            ["/usr/lib/app/bin/smartctl", "-j", "-a", "-d", "sat", "/dev/sda"]
        );
    }

    #[test]
    fn candidates_cover_usb_bridge_types() {
        let c = candidate_invocations("/dev/sda");
        let types: Vec<Option<&str>> = c.iter().map(|(_, t)| *t).collect();
        // Auto first (fast path for internal disks), then the USB fallbacks.
        assert_eq!(types[0], None);
        for t in ["sat", "sat,16", "usbjmicron", "usbprolific", "sntjmicron", "scsi"] {
            assert!(types.contains(&Some(t)), "missing -d {t}");
        }
        // The device string is carried through every probe.
        assert!(c.iter().all(|(d, _)| d.starts_with("/dev/sd")));
    }

    #[test]
    fn distinguishes_rich_from_bare_status() {
        let rich: Value = serde_json::from_str(r#"{"ata_smart_attributes":{"table":[]}}"#).unwrap();
        let nvme: Value =
            serde_json::from_str(r#"{"nvme_smart_health_information_log":{}}"#).unwrap();
        let bare: Value = serde_json::from_str(r#"{"smart_status":{"passed":true}}"#).unwrap();
        let empty: Value = serde_json::from_str("{}").unwrap();

        assert!(has_rich_payload(&rich));
        assert!(has_rich_payload(&nvme));
        assert!(!has_rich_payload(&bare)); // overall status only, no detail
        assert!(has_smart_payload(&bare));
        assert!(!has_smart_payload(&empty));
    }
}
