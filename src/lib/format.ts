/** Human-readable byte sizes (binary units). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / Math.pow(1024, i);
  const decimals = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/** Filesystems offered per platform. */
export function filesystemOptions(): string[] {
  // Detected on the backend at format time; this is just the UI menu.
  return ["exfat", "ntfs", "ext4", "fat32"];
}
