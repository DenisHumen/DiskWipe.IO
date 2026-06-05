import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DiskInfo,
  SmartReport,
  FormatRequest,
  FormatProgress,
} from "../types";

/** Enumerate physical disks on the host. */
export function listDisks(): Promise<DiskInfo[]> {
  return invoke<DiskInfo[]>("list_disks");
}

/** Collect a full SMART report for a single disk. */
export function getSmart(diskId: string): Promise<SmartReport> {
  return invoke<SmartReport>("get_smart", { diskId });
}

/**
 * Start a format operation. The backend refuses to touch the system disk and
 * validates `confirmSerial` against the real device serial before doing
 * anything destructive. Progress is reported via the `format-progress` event.
 */
export function formatDisk(req: FormatRequest): Promise<void> {
  return invoke("format_disk", { req });
}

/** Whether the current process has the privileges needed to format disks. */
export function hasAdminRights(): Promise<boolean> {
  return invoke<boolean>("has_admin_rights");
}

/** Whether `smartctl` (smartmontools) is available on PATH. */
export function smartctlAvailable(): Promise<boolean> {
  return invoke<boolean>("smartctl_available");
}

/** Subscribe to live format progress events. Returns an unlisten function. */
export function onFormatProgress(
  handler: (p: FormatProgress) => void
): Promise<UnlistenFn> {
  return listen<FormatProgress>("format-progress", (e) => handler(e.payload));
}
