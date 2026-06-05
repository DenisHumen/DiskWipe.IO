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
    util::run_capture("smartctl", &["--version"])
        .map(|o| o.success)
        .unwrap_or(false)
}

pub fn report(device: &str) -> Result<SmartReport, String> {
    let v = run_smartctl(device)?;
    Ok(parse_report(device, &v))
}

fn run_smartctl(device: &str) -> Result<Value, String> {
    let mut value = invoke_smartctl(device, None)?;
    // Some USB/SAT bridges need an explicit device type to expose SMART data.
    let needs_retry = value.get("ata_smart_attributes").is_none()
        && value.get("nvme_smart_health_information_log").is_none()
        && value.get("smart_status").is_none();
    if needs_retry {
        if let Ok(retried) = invoke_smartctl(device, Some("sat")) {
            if retried.get("ata_smart_attributes").is_some()
                || retried.get("smart_status").is_some()
            {
                value = retried;
            }
        }
    }
    Ok(value)
}

fn invoke_smartctl(device: &str, dtype: Option<&str>) -> Result<Value, String> {
    let mut args = vec!["-j", "-a"];
    if let Some(t) = dtype {
        args.push("-d");
        args.push(t);
    }
    args.push(device);
    let out = util::run_capture("smartctl", &args)?;
    let text = if out.stdout.trim().is_empty() {
        out.stderr
    } else {
        out.stdout
    };
    serde_json::from_str(&text).map_err(|e| format!("could not parse smartctl output: {e}"))
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
}
