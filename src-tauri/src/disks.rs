//! Physical disk enumeration with system-disk detection, per platform.

use crate::model::DiskInfo;

#[cfg(target_os = "linux")]
const SYSTEM_MOUNTS: [&str; 4] = ["/", "/boot", "/boot/efi", "/var"];

pub fn list() -> Result<Vec<DiskInfo>, String> {
    #[cfg(target_os = "linux")]
    {
        linux::list()
    }
    #[cfg(target_os = "windows")]
    {
        windows::list()
    }
    #[cfg(target_os = "macos")]
    {
        macos::list()
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Err("unsupported platform".into())
    }
}

// ---------------------------------------------------------------------------
// Linux — via `lsblk -b -J -O`
// ---------------------------------------------------------------------------
#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use crate::util;
    use serde_json::Value;

    pub fn list() -> Result<Vec<DiskInfo>, String> {
        let out = util::run_ok("lsblk", &["-b", "-J", "-O"])?;
        let v: Value = serde_json::from_str(&out)
            .map_err(|e| format!("could not parse lsblk output: {e}"))?;
        let devices = v
            .get("blockdevices")
            .and_then(Value::as_array)
            .ok_or("lsblk returned no blockdevices")?;

        let mut disks = Vec::new();
        for d in devices {
            let dtype = d.get("type").and_then(Value::as_str).unwrap_or("");
            if dtype != "disk" {
                continue;
            }
            let name = d.get("name").and_then(Value::as_str).unwrap_or("");
            if name.is_empty() || name.starts_with("loop") || name.starts_with("ram") {
                continue;
            }
            let path = format!("/dev/{name}");
            let mountpoints = collect_mounts(d);
            let is_system = mountpoints.iter().any(|m| SYSTEM_MOUNTS.contains(&m.as_str()));

            disks.push(DiskInfo {
                id: path.clone(),
                path,
                model: string_field(d, "model"),
                serial: string_field(d, "serial"),
                size_bytes: d.get("size").and_then(Value::as_u64).unwrap_or(0),
                is_system,
                is_removable: bool_field(d, "rm") || bool_field(d, "hotplug"),
                bus: string_field(d, "tran").to_uppercase(),
                rotational: bool_field(d, "rota"),
                mountpoints,
            });
        }
        Ok(disks)
    }

    fn collect_mounts(d: &Value) -> Vec<String> {
        let mut mounts = Vec::new();
        push_mounts(d, &mut mounts);
        if let Some(children) = d.get("children").and_then(Value::as_array) {
            for c in children {
                push_mounts(c, &mut mounts);
                // APFS-style nested children (rare on Linux, e.g. LVM).
                if let Some(sub) = c.get("children").and_then(Value::as_array) {
                    for s in sub {
                        push_mounts(s, &mut mounts);
                    }
                }
            }
        }
        mounts
    }

    fn push_mounts(node: &Value, out: &mut Vec<String>) {
        if let Some(list) = node.get("mountpoints").and_then(Value::as_array) {
            for m in list {
                if let Some(s) = m.as_str() {
                    if !s.is_empty() {
                        out.push(s.to_string());
                    }
                }
            }
        } else if let Some(s) = node.get("mountpoint").and_then(Value::as_str) {
            if !s.is_empty() {
                out.push(s.to_string());
            }
        }
    }

    fn string_field(d: &Value, key: &str) -> String {
        d.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    }

    fn bool_field(d: &Value, key: &str) -> bool {
        match d.get(key) {
            Some(Value::Bool(b)) => *b,
            Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
            Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
            _ => false,
        }
    }
}

// ---------------------------------------------------------------------------
// Windows — via PowerShell (Get-Disk / Get-PhysicalDisk)
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use crate::util;
    use serde_json::Value;

    const SCRIPT: &str = r#"
$disks = Get-Disk | ForEach-Object {
  $d = $_
  $pd = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq ([string]$d.Number) } | Select-Object -First 1
  $letters = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue |
      Where-Object { $_.DriveLetter } | ForEach-Object { "$($_.DriveLetter):" })
  [pscustomobject]@{
    Number   = $d.Number
    Model    = $d.FriendlyName
    Serial   = ($d.SerialNumber -replace '\s','')
    Size     = $d.Size
    Bus      = [string]$d.BusType
    Media    = [string]$pd.MediaType
    IsBoot   = [bool]$d.IsBoot
    IsSystem = [bool]$d.IsSystem
    Letters  = $letters
  }
}
ConvertTo-Json -InputObject @($disks) -Depth 4
"#;

    pub fn list() -> Result<Vec<DiskInfo>, String> {
        let out = util::run_ok(
            "powershell",
            &["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
        )?;
        let v: Value = serde_json::from_str(out.trim())
            .map_err(|e| format!("could not parse Get-Disk output: {e}"))?;
        let arr = match v {
            Value::Array(a) => a,
            other => vec![other],
        };

        let mut disks = Vec::new();
        for d in &arr {
            let number = d.get("Number").and_then(Value::as_u64).unwrap_or(0);
            let path = format!("\\\\.\\PhysicalDrive{number}");
            let bus = d.get("Bus").and_then(Value::as_str).unwrap_or("").to_string();
            let media = d.get("Media").and_then(Value::as_str).unwrap_or("");
            let is_boot = d.get("IsBoot").and_then(Value::as_bool).unwrap_or(false);
            let is_system = d.get("IsSystem").and_then(Value::as_bool).unwrap_or(false);

            let mountpoints = d
                .get("Letters")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();

            disks.push(DiskInfo {
                id: path.clone(),
                path,
                model: d.get("Model").and_then(Value::as_str).unwrap_or("").trim().to_string(),
                serial: d.get("Serial").and_then(Value::as_str).unwrap_or("").trim().to_string(),
                size_bytes: d.get("Size").and_then(Value::as_u64).unwrap_or(0),
                is_system: is_boot || is_system,
                is_removable: bus.eq_ignore_ascii_case("USB"),
                bus: bus.to_uppercase(),
                rotational: media.eq_ignore_ascii_case("HDD"),
                mountpoints,
            });
        }
        Ok(disks)
    }
}

// ---------------------------------------------------------------------------
// macOS — development host only (formatting disabled). Via diskutil + plutil.
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use serde_json::Value;
    use std::process::Command;

    pub fn list() -> Result<Vec<DiskInfo>, String> {
        let root_disk = root_whole_disk();
        let listing = run_plist(&["list", "-plist"])?;
        let entries = listing
            .get("AllDisksAndPartitions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let mut disks = Vec::new();
        for e in &entries {
            let ident = match e.get("DeviceIdentifier").and_then(Value::as_str) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let info = run_plist(&["info", "-plist", &ident]).unwrap_or(Value::Null);

            let mut mountpoints = Vec::new();
            collect_mounts(e, &mut mountpoints);

            let path = format!("/dev/{ident}");
            disks.push(DiskInfo {
                id: path.clone(),
                path,
                model: str_field(&info, "MediaName"),
                serial: String::new(),
                size_bytes: e
                    .get("Size")
                    .and_then(Value::as_u64)
                    .or_else(|| info.get("TotalSize").and_then(Value::as_u64))
                    .unwrap_or(0),
                is_system: root_disk.as_deref() == Some(ident.as_str()),
                is_removable: bool_field(&info, "RemovableMedia")
                    || !bool_field(&info, "Internal"),
                bus: str_field(&info, "BusProtocol").to_uppercase(),
                rotational: !bool_field(&info, "SolidState"),
                mountpoints,
            });
        }
        Ok(disks)
    }

    fn collect_mounts(entry: &Value, out: &mut Vec<String>) {
        for key in ["Partitions", "APFSVolumes"] {
            if let Some(parts) = entry.get(key).and_then(Value::as_array) {
                for p in parts {
                    if let Some(m) = p.get("MountPoint").and_then(Value::as_str) {
                        if !m.is_empty() {
                            out.push(m.to_string());
                        }
                    }
                }
            }
        }
    }

    /// Determine the whole disk hosting `/` (e.g. "disk3").
    fn root_whole_disk() -> Option<String> {
        let out = Command::new("df").arg("/").output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let dev = text.lines().nth(1)?.split_whitespace().next()?;
        // /dev/disk3s1s1 -> disk3
        let name = dev.strip_prefix("/dev/")?;
        let digits: String = name
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if digits.is_empty() {
            None
        } else {
            Some(format!("disk{digits}"))
        }
    }

    fn run_plist(args: &[&str]) -> Result<Value, String> {
        let mut cmd = Command::new("diskutil");
        let raw = cmd
            .args(args)
            .output()
            .map_err(|e| format!("failed to run diskutil: {e}"))?;
        if !raw.status.success() {
            return Err(format!(
                "diskutil failed: {}",
                String::from_utf8_lossy(&raw.stderr).trim()
            ));
        }
        // Convert the plist to JSON using plutil reading from stdin.
        use std::io::Write;
        let mut child = Command::new("plutil")
            .args(["-convert", "json", "-o", "-", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to run plutil: {e}"))?;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&raw.stdout)
            .map_err(|e| format!("plutil stdin error: {e}"))?;
        let conv = child
            .wait_with_output()
            .map_err(|e| format!("plutil wait error: {e}"))?;
        serde_json::from_slice(&conv.stdout)
            .map_err(|e| format!("could not parse diskutil JSON: {e}"))
    }

    fn str_field(v: &Value, key: &str) -> String {
        v.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string()
    }

    fn bool_field(v: &Value, key: &str) -> bool {
        v.get(key).and_then(Value::as_bool).unwrap_or(false)
    }
}
