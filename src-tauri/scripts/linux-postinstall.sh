#!/bin/sh
# DiskWipe.IO — post-install (.deb postinst / .rpm %post).
#
# Grant the bundled smartctl the Linux capabilities it needs to read S.M.A.R.T.
# data as a normal (non-root) user, so disk health works out of the box without
# a password prompt. This mirrors the Windows build, which gains the same access
# via UAC elevation.
#
#   cap_dac_override  open the root:disk 0660 device node as a normal user
#   cap_sys_rawio     issue ATA/SCSI pass-through (SG_IO) commands
#   cap_sys_admin     issue NVMe admin pass-through commands
#
# This must never fail the package install (a non-zero exit leaves the package
# half-configured). Every step is best-effort and we always exit 0. When setcap
# is unavailable, or for the AppImage build, the app falls back to pkexec at
# runtime instead.

if command -v setcap >/dev/null 2>&1; then
    # The bundler installs resources under /usr/lib/<app>/bin/smartctl (deb/rpm).
    # Match by path so we never touch an unrelated app's smartctl copy.
    find /usr/lib /opt -maxdepth 4 -type f -path '*/bin/smartctl' 2>/dev/null | while IFS= read -r bin; do
        case "$bin" in
            *[Dd]isk[Ww]ipe*|*disk-wipe*|*diskwipe*)
                setcap cap_dac_override,cap_sys_rawio,cap_sys_admin+ep "$bin" >/dev/null 2>&1 || true
                ;;
        esac
    done
fi

exit 0
