//! Small process / privilege helpers used across the backend.

use std::process::Command;
use std::sync::OnceLock;

/// Absolute path to a bundled `smartctl`, resolved once at startup. When the
/// app ships its own copy (inside the installer) this points at it; otherwise
/// the code falls back to a `smartctl` discoverable on `PATH`.
static SMARTCTL: OnceLock<String> = OnceLock::new();

/// Record the path to the bundled smartctl executable (best effort).
pub fn set_smartctl(path: String) {
    let _ = SMARTCTL.set(path);
}

/// The smartctl command to invoke: the bundled binary if known, else `smartctl`.
pub fn smartctl_bin() -> String {
    SMARTCTL
        .get()
        .cloned()
        .unwrap_or_else(|| "smartctl".to_string())
}

pub struct CmdOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

/// Run a command and capture its output without treating a non-zero exit as a
/// hard error (some tools, like `smartctl`, use the exit code as a bit-field).
pub fn run_capture(cmd: &str, args: &[&str]) -> Result<CmdOutput, String> {
    let out = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("failed to launch `{cmd}`: {e}"))?;
    Ok(CmdOutput {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        success: out.status.success(),
    })
}

/// Run a command and require a successful exit status.
#[allow(dead_code)] // used on Linux (mkfs) and Windows (diskpart)
pub fn run_ok(cmd: &str, args: &[&str]) -> Result<String, String> {
    let o = run_capture(cmd, args)?;
    if !o.success {
        let detail = if o.stderr.trim().is_empty() {
            o.stdout.trim().to_string()
        } else {
            o.stderr.trim().to_string()
        };
        return Err(format!("`{cmd}` failed: {detail}"));
    }
    Ok(o.stdout)
}

/// Whether the current process can perform privileged disk operations.
#[cfg(unix)]
pub fn is_admin() -> bool {
    // SAFETY: geteuid() has no preconditions and never fails.
    unsafe { libc::geteuid() == 0 }
}

#[cfg(windows)]
pub fn is_admin() -> bool {
    // `net session` succeeds only from an elevated administrator context.
    Command::new("net")
        .args(["session"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Extract the trailing integer from a string, e.g. the `0` in
/// `\\.\PhysicalDrive0`. Returns `None` when there is no trailing digit.
#[allow(dead_code)] // used on Windows and in tests
pub fn trailing_number(s: &str) -> Option<u32> {
    let digits: String = s
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    digits.parse().ok()
}
