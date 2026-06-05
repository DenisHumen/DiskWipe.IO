fn main() {
    let mut attributes = tauri_build::Attributes::new();

    // On Windows, embed a manifest that requests administrator rights. Raw
    // S.M.A.R.T. access (\\.\PhysicalDrive*) and disk wiping (diskpart) require
    // elevation; without it SMART comes back empty and formatting fails.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest = include_str!("windows-app-manifest.xml");
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new().app_manifest(manifest));
    }

    tauri_build::try_build(attributes).expect("failed to run tauri build script");
}
