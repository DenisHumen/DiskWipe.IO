//! Disk formatting with layered safety guards.
//!
//! Guarantees enforced before any destructive action:
//!  - the target must exist and must NOT be the system disk;
//!  - the user-supplied serial must match the real device serial;
//!  - no partition may be mounted at a system path;
//!  - the process must hold administrator / root privileges.
//!
//! macOS (development host) intentionally refuses all formatting.

use crate::model::{DiskInfo, FormatProgress, FormatRequest};
use crate::{disks, util};
use tauri::{AppHandle, Emitter};

const PROTECTED_MOUNTS: [&str; 5] = ["/", "/boot", "/boot/efi", "/var", "/usr"];

pub fn run(app: AppHandle, req: FormatRequest) -> Result<(), String> {
    let disk = disks::list()?
        .into_iter()
        .find(|d| d.id == req.disk_id)
        .ok_or("disk not found (it may have been removed)")?;

    // --- Safety guards -----------------------------------------------------
    if disk.is_system {
        return Err("refusing to format the system disk".into());
    }
    if disk
        .mountpoints
        .iter()
        .any(|m| PROTECTED_MOUNTS.contains(&m.as_str()))
    {
        return Err("refusing to format a disk mounted at a system path".into());
    }
    if disk.serial.trim().is_empty() {
        return Err("disk reports no serial number; cannot safely confirm the target".into());
    }
    if req.confirm_serial.trim() != disk.serial.trim() {
        return Err("confirmation serial does not match the selected disk".into());
    }
    if req.mode != "quick" && req.mode != "full" {
        return Err(format!("unknown format mode: {}", req.mode));
    }
    if !util::is_admin() {
        return Err("administrator / root privileges are required to format disks".into());
    }

    let id = disk.id.clone();
    let emit = move |phase: &str, percent: f64, message: &str| {
        let _ = app.emit(
            "format-progress",
            FormatProgress {
                disk_id: id.clone(),
                phase: phase.to_string(),
                percent,
                message: message.to_string(),
            },
        );
    };

    platform_format(&disk, &req, &emit)
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------
#[cfg(target_os = "linux")]
fn platform_format<F>(disk: &DiskInfo, req: &FormatRequest, emit: &F) -> Result<(), String>
where
    F: Fn(&str, f64, &str),
{
    emit("prepare", 1.0, "Unmounting partitions…");
    for m in &disk.mountpoints {
        let _ = util::run_capture("umount", &[m]);
    }

    if req.mode == "full" {
        zero_fill(&disk.path, disk.size_bytes, emit)?;
    }

    emit("wipe", 90.0, "Clearing existing signatures…");
    let _ = util::run_capture("wipefs", &["-a", &disk.path]);

    emit("mkfs", 94.0, "Creating filesystem…");
    mkfs_linux(&disk.path, &req.filesystem, &req.label)?;

    emit("done", 100.0, "Format complete");
    Ok(())
}

#[cfg(target_os = "linux")]
fn mkfs_linux(dev: &str, fs: &str, label: &str) -> Result<(), String> {
    let label = if label.trim().is_empty() {
        "DISKWIPE"
    } else {
        label.trim()
    };
    match fs {
        "ext4" => util::run_ok("mkfs.ext4", &["-F", "-L", label, dev]).map(|_| ()),
        "ntfs" => util::run_ok("mkfs.ntfs", &["-f", "-L", label, dev]).map(|_| ()),
        "exfat" => util::run_ok("mkfs.exfat", &["-n", label, dev]).map(|_| ()),
        "fat32" => util::run_ok("mkfs.vfat", &["-F", "32", "-n", label, dev]).map(|_| ()),
        other => Err(format!("unsupported filesystem on Linux: {other}")),
    }
}

/// Overwrite every sector with zeros, emitting progress between 2% and 88%.
#[cfg(target_os = "linux")]
fn zero_fill<F>(path: &str, size: u64, emit: &F) -> Result<(), String>
where
    F: Fn(&str, f64, &str),
{
    use std::fs::OpenOptions;
    use std::io::Write;

    let mut file = OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|e| format!("cannot open {path} for writing: {e}"))?;

    let buf = vec![0u8; 4 * 1024 * 1024];
    let total = size.max(1);
    let mut written: u64 = 0;
    let mut last_pct = 0.0_f64;

    while written < size {
        let chunk = std::cmp::min(buf.len() as u64, size - written) as usize;
        file.write_all(&buf[..chunk])
            .map_err(|e| format!("write error at offset {written}: {e}"))?;
        written += chunk as u64;

        let pct = 2.0 + (written as f64 / total as f64) * 86.0;
        if pct - last_pct >= 0.5 {
            emit(
                "erase",
                pct,
                &format!(
                    "Overwriting sectors… {} / {} MiB",
                    written / 1_048_576,
                    size / 1_048_576
                ),
            );
            last_pct = pct;
        }
    }
    let _ = file.flush();
    Ok(())
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
fn platform_format<F>(disk: &DiskInfo, req: &FormatRequest, emit: &F) -> Result<(), String>
where
    F: Fn(&str, f64, &str),
{
    use std::io::Write;

    let number = util::trailing_number(&disk.path)
        .ok_or("could not determine the physical drive number")?;

    let fs = match req.filesystem.as_str() {
        "ntfs" | "fat32" | "exfat" => req.filesystem.as_str(),
        // ext4 is not available on Windows; fall back to exFAT.
        _ => "exfat",
    };
    let label = if req.label.trim().is_empty() {
        "DISKWIPE"
    } else {
        req.label.trim()
    };

    // `clean all` zeros the entire disk (full erase); `clean` is a quick wipe.
    let clean = if req.mode == "full" { "clean all" } else { "clean" };
    if req.mode == "full" {
        emit("erase", 5.0, "Overwriting all sectors (clean all)…");
    } else {
        emit("prepare", 10.0, "Clearing partition table…");
    }

    let script = format!(
        "select disk {number}\r\n{clean}\r\ncreate partition primary\r\nformat fs={fs} quick label=\"{label}\"\r\nassign\r\nexit\r\n"
    );

    let mut tmp = std::env::temp_dir();
    tmp.push(format!("diskwipe_{number}.txt"));
    std::fs::File::create(&tmp)
        .and_then(|mut f| f.write_all(script.as_bytes()))
        .map_err(|e| format!("could not write diskpart script: {e}"))?;

    emit("format", 60.0, "Running diskpart…");
    let result = util::run_ok("diskpart", &["/s", &tmp.to_string_lossy()]);
    let _ = std::fs::remove_file(&tmp);
    result?;

    emit("done", 100.0, "Format complete");
    Ok(())
}

// ---------------------------------------------------------------------------
// macOS — disabled by design (development host).
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
fn platform_format<F>(_disk: &DiskInfo, _req: &FormatRequest, _emit: &F) -> Result<(), String>
where
    F: Fn(&str, f64, &str),
{
    Err("Disk formatting is disabled on macOS in this build (development host only).".into())
}

#[cfg(test)]
mod tests {
    use crate::util::trailing_number;

    #[test]
    fn parses_physical_drive_number() {
        assert_eq!(trailing_number("\\\\.\\PhysicalDrive0"), Some(0));
        assert_eq!(trailing_number("\\\\.\\PhysicalDrive12"), Some(12));
        assert_eq!(trailing_number("/dev/sda"), None);
    }
}
