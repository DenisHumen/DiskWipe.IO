# Bundled binaries

This directory is populated at build time (CI) with platform-specific
helper executables that ship inside the installer so the app works out of
the box:

- `smartctl` (smartmontools) — used to read S.M.A.R.T. data.

On Windows the file is `smartctl.exe`; on Linux it is `smartctl`. When this
folder has no `smartctl`, the app falls back to a `smartctl` found on `PATH`.

The `.gitkeep` file keeps the Tauri resource glob (`resources/bin/*`) valid
even before the binaries are fetched.
