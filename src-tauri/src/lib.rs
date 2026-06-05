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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
