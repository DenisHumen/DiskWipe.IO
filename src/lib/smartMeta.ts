/**
 * Human-friendly metadata for S.M.A.R.T. attributes and NVMe health logs.
 * Turns cryptic IDs and raw counters into plain-language labels, descriptions,
 * formatted values and a clear OK / Watch / Critical status.
 */
import type { AttrStatus, Health, SmartAttribute, SmartReport } from "../types";
import { formatBytes } from "./format";

/** Friendly label + one-line plain-language explanation per SMART attribute ID. */
const ATTR_META: Record<number, { label: string; description: string }> = {
  1: { label: "Read Error Rate", description: "Rate of hardware read errors. Higher raw values can signal surface trouble." },
  3: { label: "Spin-Up Time", description: "Time the platters take to reach full speed." },
  4: { label: "Start/Stop Count", description: "Number of spindle start and stop cycles." },
  5: { label: "Reallocated Sectors", description: "Bad sectors remapped to spares. Should stay at 0." },
  7: { label: "Seek Error Rate", description: "Rate of errors while positioning the heads." },
  9: { label: "Power-On Hours", description: "Total time the drive has been powered on." },
  10: { label: "Spin Retry Count", description: "Retries needed to spin the platters up. Should be 0." },
  12: { label: "Power Cycle Count", description: "Number of full power-on / power-off cycles." },
  177: { label: "Wear Leveling Count", description: "Flash wear levelling cycles used on an SSD." },
  179: { label: "Used Reserved Blocks", description: "Spare flash blocks already consumed." },
  181: { label: "Program Fail Count", description: "Failed flash program operations." },
  182: { label: "Erase Fail Count", description: "Failed flash erase operations." },
  183: { label: "Runtime Bad Blocks", description: "Bad blocks found during normal use." },
  184: { label: "End-to-End Error", description: "Data path errors inside the drive. Should be 0." },
  187: { label: "Uncorrectable Errors", description: "Errors the drive could not recover. Should be 0." },
  188: { label: "Command Timeout", description: "Operations that timed out, often a cable or power issue." },
  190: { label: "Airflow Temperature", description: "Drive temperature relative to its airflow sensor." },
  194: { label: "Temperature", description: "Current drive temperature." },
  195: { label: "Hardware ECC Recovered", description: "Errors silently corrected by the drive's ECC." },
  196: { label: "Reallocation Events", description: "Times a sector remap was attempted." },
  197: { label: "Pending Sectors", description: "Unstable sectors waiting to be remapped. Should be 0." },
  198: { label: "Offline Uncorrectable", description: "Sectors that failed an offline scan. Should be 0." },
  199: { label: "CRC Error Count", description: "Errors on the data cable — usually a loose or bad cable." },
  231: { label: "SSD Life Left", description: "Estimated remaining flash endurance." },
  233: { label: "Media Wearout", description: "Remaining SSD write endurance (lower means more worn)." },
  241: { label: "Total Data Written", description: "Lifetime data written to the drive." },
  242: { label: "Total Data Read", description: "Lifetime data read from the drive." },
};

export interface AttrView {
  id: number;
  label: string;
  description: string;
  value: number;
  worst: number;
  threshold: number;
  raw: string;
  status: AttrStatus;
}

/** Map a raw SMART attribute onto a human-friendly view model. */
export function attributeView(a: SmartAttribute): AttrView {
  const meta = ATTR_META[a.id];
  const label = meta?.label ?? titleCase(a.name);
  const description = meta?.description ?? "Vendor-specific S.M.A.R.T. attribute.";
  return {
    id: a.id,
    label,
    description,
    value: a.value,
    worst: a.worst,
    threshold: a.threshold,
    raw: a.raw,
    status: a.status,
  };
}

export interface NvmeView {
  key: string;
  label: string;
  display: string;
  description: string;
  status: AttrStatus;
}

/** Turn the NVMe health log into ordered, human-readable rows. */
export function nvmeViews(nvme: Record<string, number>): NvmeView[] {
  const rows: NvmeView[] = [];
  const seen = new Set<string>();

  const push = (key: string, build: (v: number) => Omit<NvmeView, "key">) => {
    if (!(key in nvme) || seen.has(key)) return;
    seen.add(key);
    rows.push({ key, ...build(nvme[key]) });
  };

  push("critical_warning", (v) => ({
    label: "Critical Warning",
    display: v === 0 ? "None" : `0x${v.toString(16)}`,
    description: "Bit flags for serious conditions. 0 means everything is fine.",
    status: v === 0 ? "ok" : "bad",
  }));
  push("temperature", (v) => ({
    label: "Temperature",
    display: `${v} °C`,
    description: "Current controller temperature.",
    status: v >= 70 ? "bad" : v >= 60 ? "warn" : "ok",
  }));
  push("percentage_used", (v) => ({
    label: "Life Used",
    display: `${v}%`,
    description: "Estimated portion of the drive's rated write endurance consumed.",
    status: v >= 90 ? "bad" : v >= 80 ? "warn" : "ok",
  }));
  push("available_spare", (v) => ({
    label: "Available Spare",
    display: `${v}%`,
    description: "Remaining spare flash capacity for sector remapping.",
    status: v <= 5 ? "bad" : v <= 20 ? "warn" : "ok",
  }));
  push("available_spare_threshold", (v) => ({
    label: "Spare Threshold",
    display: `${v}%`,
    description: "Spare level at which the drive reports a warning.",
    status: "ok",
  }));
  push("data_units_written", (v) => ({
    label: "Total Data Written",
    display: formatBytes(v * 512000),
    description: "Lifetime host data written to the drive.",
    status: "ok",
  }));
  push("data_units_read", (v) => ({
    label: "Total Data Read",
    display: formatBytes(v * 512000),
    description: "Lifetime host data read from the drive.",
    status: "ok",
  }));
  push("host_writes", (v) => ({
    label: "Write Commands",
    display: groupNum(v),
    description: "Total number of host write commands processed.",
    status: "ok",
  }));
  push("host_reads", (v) => ({
    label: "Read Commands",
    display: groupNum(v),
    description: "Total number of host read commands processed.",
    status: "ok",
  }));
  push("power_on_hours", (v) => ({
    label: "Power-On Hours",
    display: `${groupNum(v)} h${v ? ` · ${humanHours(v)}` : ""}`,
    description: "Total time the drive has been powered on.",
    status: "ok",
  }));
  push("power_cycles", (v) => ({
    label: "Power Cycles",
    display: groupNum(v),
    description: "Number of times the drive has been powered on.",
    status: "ok",
  }));
  push("unsafe_shutdowns", (v) => ({
    label: "Unsafe Shutdowns",
    display: groupNum(v),
    description: "Power losses without a clean shutdown.",
    status: "ok",
  }));
  push("media_errors", (v) => ({
    label: "Media Errors",
    display: groupNum(v),
    description: "Unrecovered data integrity errors. Should be 0.",
    status: v === 0 ? "ok" : "bad",
  }));
  push("num_err_log_entries", (v) => ({
    label: "Error Log Entries",
    display: groupNum(v),
    description: "Entries recorded in the controller error log.",
    status: "ok",
  }));
  push("controller_busy_time", (v) => ({
    label: "Controller Busy Time",
    display: `${groupNum(v)} min`,
    description: "Time the controller spent processing I/O.",
    status: "ok",
  }));
  push("warning_temp_time", (v) => ({
    label: "Warning Temp Time",
    display: `${groupNum(v)} min`,
    description: "Time spent above the warning temperature.",
    status: v === 0 ? "ok" : "warn",
  }));
  push("critical_comp_time", (v) => ({
    label: "Critical Temp Time",
    display: `${groupNum(v)} min`,
    description: "Time spent above the critical temperature.",
    status: v === 0 ? "ok" : "bad",
  }));

  // Any remaining keys we did not special-case.
  for (const [key, v] of Object.entries(nvme)) {
    if (seen.has(key)) continue;
    rows.push({
      key,
      label: titleCase(key.replace(/_/g, " ")),
      display: groupNum(v),
      description: "Vendor-specific NVMe health value.",
      status: "ok",
    });
  }
  return rows;
}

export interface HealthSummary {
  title: string;
  message: string;
  okCount: number;
  warnCount: number;
  badCount: number;
}

/** A plain-language headline + supporting detail for the overall health. */
export function healthSummary(report: SmartReport): HealthSummary {
  const all: AttrStatus[] = [
    ...report.attributes.map((a) => a.status),
    ...(report.nvme ? nvmeViews(report.nvme).map((n) => n.status) : []),
  ];
  const badCount = all.filter((s) => s === "bad").length;
  const warnCount = all.filter((s) => s === "warn").length;
  const okCount = all.filter((s) => s === "ok").length;

  let title: string;
  let message: string;
  switch (report.overall) {
    case "good":
      title = "This drive is healthy";
      message =
        "All S.M.A.R.T. checks passed. No reallocated sectors, pending sectors or unrecoverable errors were detected.";
      break;
    case "caution":
      title = "Keep an eye on this drive";
      message =
        warnCount > 0
          ? `${warnCount} indicator${warnCount === 1 ? "" : "s"} need${
              warnCount === 1 ? "s" : ""
            } attention. The drive still works, but consider backing up important data.`
          : "Some indicators are trending toward their limits. Consider backing up important data.";
      break;
    case "bad":
      title = "This drive may be failing";
      message =
        badCount > 0
          ? `${badCount} critical indicator${
              badCount === 1 ? "" : "s"
            } failed. Back up your data immediately and plan to replace the drive.`
          : "The drive failed its overall health check. Back up your data and plan to replace it.";
      break;
    default:
      title = "Health status unknown";
      message =
        "Not enough S.M.A.R.T. data was reported. The drive may be behind a USB bridge or require elevated privileges.";
  }
  return { title, message, okCount, warnCount, badCount };
}

/** Map an attribute status to the shared Health type used by badges/dots. */
export function statusToHealth(status: AttrStatus): Health {
  return status === "bad" ? "bad" : status === "warn" ? "caution" : "good";
}

export function statusLabel(status: AttrStatus): string {
  return status === "bad" ? "Critical" : status === "warn" ? "Watch" : "OK";
}

/** "12345" -> "12,345". */
export function groupNum(n: number): string {
  return n.toLocaleString("en-US");
}

/** Power-on hours -> "3y 2mo" / "45d" / "12h" rough human duration. */
export function humanHours(hours: number): string {
  if (hours <= 0) return "—";
  const days = Math.floor(hours / 24);
  if (days < 1) return `${hours}h`;
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  if (years > 0) return months > 0 ? `${years}y ${months}mo` : `${years}y`;
  if (days >= 30) return `${months}mo`;
  return `${days}d`;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
