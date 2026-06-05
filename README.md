<div align="center">

<img src="assets/logo.svg" alt="DiskWipe.IO" width="120" height="120" />

# DiskWipe.IO

**S.M.A.R.T. disk health monitoring & secure formatting — for Windows and Linux.**

Read drive health like *CrystalDiskInfo*, run a quick or full sector-by-sector
erase, and export a SMART report to PDF — all from one clean, Claude-inspired app.

[![Build](https://github.com/DenisHumen/DiskWipe.IO/actions/workflows/build.yml/badge.svg)](https://github.com/DenisHumen/DiskWipe.IO/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-d97757.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Ubuntu%20%7C%20Fedora-1a1916)

</div>

---

## ✨ Features

- **S.M.A.R.T. monitoring** — full ATA attribute tables and NVMe health logs,
  with temperature, power-on hours, power cycles and an at-a-glance health
  verdict (Good / Caution / Bad), powered by `smartctl`.
- **Two formatting modes**
  - **Quick format** — recreates the filesystem in seconds.
  - **Full erase** — overwrites *every sector* with zeros, then lays down a
    fresh filesystem, with live progress.
- **System-disk protection** — the drive hosting your OS is detected and
  **locked** so it can never be formatted by accident.
- **Serial-confirmation safety** — destructive actions require you to type the
  exact device serial number to unlock.
- **PDF reports** — export the SMART health of any disk to a clean PDF, choosing
  exactly where to save it.
- **Batteries included** — `smartctl` ships **inside the installer**, so SMART
  works out of the box with nothing else to install.
- **Automatic updates** — on launch the app checks GitHub for a newer signed
  release and, if found, downloads and installs it, then restarts.
- **One-click repository link** — the GitHub icon in the header opens the
  project page.
- **Native & lightweight** — built with Tauri 2; ships as a small `.exe`/`.msi`
  on Windows and `.deb` / `.AppImage` / `.rpm` on Linux.

## 🖥️ Supported platforms

| OS      | Packages                         | Notes                       |
| ------- | -------------------------------- | --------------------------- |
| Windows | `.exe` (NSIS), `.msi`            | Formatting via `diskpart`   |
| Ubuntu  | `.deb`, `.AppImage`              | Formatting via `mkfs`       |
| Fedora  | `.rpm`, `.AppImage`              | Formatting via `mkfs`       |

> macOS is supported as a **development host** for reading disks; formatting is
> intentionally disabled there.

## 📥 Download

Grab the latest installers from the
[**Releases**](https://github.com/DenisHumen/DiskWipe.IO/releases) page:

- **Windows** — `DiskWipe.IO_x.y.z_x64-setup.exe` or `.msi`
- **Ubuntu / Debian** — `.deb` or the portable `.AppImage`
- **Fedora / RHEL** — `.rpm` or the portable `.AppImage`

`smartctl` is bundled inside every installer, so SMART reads work immediately.
The app also **updates itself**: each launch it checks the latest release and
installs a newer signed build automatically.

Releases are built automatically by CI whenever a `vX.Y.Z` tag is pushed.

## 🔒 Safety model

DiskWipe.IO touches raw block devices, so it is deliberately cautious. Before
**any** destructive operation it enforces:

1. The target must exist and must **not** be the system disk.
2. No partition may be mounted at a system path (`/`, `/boot`, …).
3. The disk must report a serial number, and you must **type it** to confirm.
4. The process must run with administrator / root privileges.

If any check fails, nothing is written.

## 🚀 Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
- **smartmontools** — only needed for *local development*. Installed builds ship
  their own `smartctl`, but `tauri dev` uses one from `PATH`:
  - Ubuntu/Debian: `sudo apt install smartmontools`
  - Fedora: `sudo dnf install smartmontools`
  - macOS: `brew install smartmontools`
  - Windows: [download installer](https://www.smartmontools.org/) and add to `PATH`
- Linux only: WebKitGTK & GTK dev libraries (see CI for the exact list)

### Run in development

```bash
npm install
npm run tauri dev
```

### Build installers locally

```bash
npm install
node scripts/gen-logo.mjs   # regenerate the icon source (optional)
npm run tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`.

> **Privileges:** reading SMART and formatting disks require elevation. Launch
> the built app with `sudo` (Linux) or *Run as administrator* (Windows).

## 🏗️ Architecture

```
React + TypeScript + Tailwind  ──invoke──▶  Rust (Tauri 2) backend
  · DiskList / SmartPanel / FormatPanel       · disks.rs   enumerate + detect system disk
  · jsPDF report generation                   · smart.rs   parse `smartctl --json`
  · live format progress via events           · format.rs  guarded quick / full erase
                                              · util.rs    privileges & process helpers
```

| Concern        | Windows                 | Linux                       |
| -------------- | ----------------------- | --------------------------- |
| Enumerate      | `Get-Disk` (PowerShell) | `lsblk -J -O`               |
| SMART          | `smartctl --json`       | `smartctl --json`           |
| Quick format   | `diskpart`              | `wipefs` + `mkfs.*`         |
| Full erase     | `diskpart clean all`    | zero-fill + `mkfs.*`        |
| System disk    | `IsBoot` / `IsSystem`   | root/boot mountpoint        |

## 🔁 Releases & auto-update (maintainers)

The auto-updater verifies a cryptographic signature, so release bundles must be
signed in CI. Two repository **secrets** are required before pushing a release
tag:

| Secret | Value |
| ------ | ----- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the generated private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key password (empty if none) |

The matching **public** key is committed in
[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) under
`plugins.updater.pubkey`. To add the secrets:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.diskwipe-signing/diskwipe.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""
```

Cut a release by pushing a tag:

```bash
git tag -a v0.1.1 -m "DiskWipe.IO v0.1.1" && git push origin v0.1.1
```

CI then builds, signs and publishes the installers plus the `latest.json`
update manifest to the GitHub Release.

## 🤝 Contributing

Issues and pull requests are welcome. The CI builds and tests every push to
`main` and produces installers for all supported platforms.

## 📄 License

[MIT](LICENSE) © DiskWipe.IO contributors