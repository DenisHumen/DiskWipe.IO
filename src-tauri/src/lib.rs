//! DiskWipe.IO backend — Tauri command surface.

mod disks;
mod format;
mod model;
mod smart;
mod util;

use model::{DiskInfo, FormatRequest, SmartReport};

#[tauri::command]
async fn list_disks() -> Result<Vec<DiskInfo>, String> {
    disks::list()
}

#[tauri::command]
async fn get_smart(disk_id: String) -> Result<SmartReport, String> {
    smart::report(&disk_id)
}

#[tauri::command]
fn smartctl_available() -> bool {
    smart::available()
}

#[tauri::command]
fn has_admin_rights() -> bool {
    util::is_admin()
}

#[tauri::command]
async fn format_disk(app: tauri::AppHandle, req: FormatRequest) -> Result<(), String> {
    // Run the (potentially long, blocking) format off the async runtime thread.
    tauri::async_runtime::spawn_blocking(move || format::run(app, req))
        .await
        .map_err(|e| format!("format task panicked: {e}"))?
}

/// Write raw bytes to a path chosen by the user via the native save dialog.
#[tauri::command]
fn save_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| format!("could not write {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    // Desktop-only plugins: opening URLs, in-app updates and relaunch.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            resolve_bundled_smartctl(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_disks,
            get_smart,
            smartctl_available,
            has_admin_rights,
            format_disk,
            save_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DiskWipe.IO");
}

/// Locate the `smartctl` shipped inside the installer (under the app's resource
/// directory at `bin/smartctl[.exe]`). If found, it is preferred over any copy
/// on `PATH`, so SMART works out of the box with no separate install.
fn resolve_bundled_smartctl(app: &tauri::App) {
    use tauri::Manager;

    let exe_name = if cfg!(windows) {
        "smartctl.exe"
    } else {
        "smartctl"
    };

    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("bin").join(exe_name);
        if candidate.is_file() {
            // Resources may lose the executable bit on Unix — restore it.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::metadata(&candidate) {
                    let mut perms = meta.permissions();
                    perms.set_mode(perms.mode() | 0o755);
                    let _ = std::fs::set_permissions(&candidate, perms);
                }
            }
            util::set_smartctl(candidate.to_string_lossy().into_owned());
        }
    }
}
