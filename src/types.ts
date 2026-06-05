/** Shared data model — mirrors the Rust backend structs in src-tauri/src. */

export type Health = "good" | "caution" | "bad" | "unknown";
export type AttrStatus = "ok" | "warn" | "bad";

export interface DiskInfo {
  /** Stable identifier passed back to the backend (device path). */
  id: string;
  /** OS device path, e.g. /dev/sda or \\\\.\\PhysicalDrive0. */
  path: string;
  /** Model / product name. */
  model: string;
  serial: string;
  sizeBytes: number;
  /** True when the disk hosts the running OS — protected from formatting. */
  isSystem: boolean;
  isRemovable: boolean;
  /** SATA / NVMe / USB / ... */
  bus: string;
  /** True for spinning HDDs, false for SSD/flash. */
  rotational: boolean;
  /** Mount points of partitions on this disk. */
  mountpoints: string[];
}

export interface SmartAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  threshold: number;
  raw: string;
  status: AttrStatus;
}

export interface SmartReport {
  device: string;
  model: string;
  serial: string;
  firmware: string;
  capacityBytes: number;
  temperatureC: number | null;
  powerOnHours: number | null;
  powerCycles: number | null;
  healthPassed: boolean;
  overall: Health;
  /** ATA / NVMe / SCSI */
  protocol: string;
  rotationRate: number | null;
  attributes: SmartAttribute[];
  /** NVMe SMART/health log key/value pairs (when protocol === "NVMe"). */
  nvme: Record<string, number> | null;
}

export type FormatMode = "quick" | "full";

export interface FormatRequest {
  diskId: string;
  mode: FormatMode;
  filesystem: string;
  label: string;
  /** Must equal the disk serial — a deliberate, explicit safety confirmation. */
  confirmSerial: string;
}

export interface FormatProgress {
  diskId: string;
  phase: string;
  percent: number;
  message: string;
}
