import { useState } from "react";
import {
  Thermometer,
  Clock,
  RotateCw,
  FileDown,
  HardDrive,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldQuestion,
  CheckCircle2,
} from "lucide-react";
import type { AttrStatus, DiskInfo, SmartReport } from "../types";
import { formatBytes } from "../lib/format";
import { saveSmartPdf } from "../lib/pdf";
import {
  attributeView,
  nvmeViews,
  healthSummary,
  humanHours,
  statusLabel,
} from "../lib/smartMeta";
import { HealthBadge, Stat, Skeleton } from "./ui";

export function SmartPanel({
  disk,
  report,
  loading,
  error,
}: {
  disk: DiskInfo;
  report: SmartReport | null;
  loading: boolean;
  error: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  async function handleSave() {
    if (!report) return;
    setSaving(true);
    setSavedPath(null);
    try {
      const path = await saveSmartPdf(disk, report);
      if (path) setSavedPath(path);
    } catch (e) {
      console.error(e);
      alert(`Failed to save PDF: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-bad/30 bg-bad/5 p-6 text-sm text-bad">
        <p className="font-semibold">Could not read SMART data</p>
        <p className="mt-1 text-bad/80">{error}</p>
        <p className="mt-3 text-ink-muted">
          Make sure <code className="font-mono">smartctl</code> is installed and
          the app is running with administrator / root privileges.
        </p>
      </div>
    );
  }

  if (!report) return null;

  const tempStatus: AttrStatus =
    report.temperatureC == null
      ? "ok"
      : report.temperatureC >= 65
      ? "bad"
      : report.temperatureC >= 55
      ? "warn"
      : "ok";

  return (
    <div className="animate-fade-in space-y-5">
      {/* Header: device identity + actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-clay/10 text-clay">
            <HardDrive size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold leading-tight text-ink">
              {report.model || disk.model || "Unknown drive"}
            </h2>
            <p className="font-mono text-xs text-ink-muted">
              {[report.serial, report.firmware, report.protocol]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          <FileDown size={15} />
          {saving ? "Saving…" : "Save PDF"}
        </button>
      </div>

      <HealthSummaryCard report={report} />

      {savedPath && (
        <div className="card flex items-center gap-2 border-ok/30 bg-ok/5 px-4 py-2.5 text-sm text-ok">
          <CheckCircle2 size={16} />
          Report saved to <span className="font-mono">{savedPath}</span>
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Capacity"
          value={formatBytes(report.capacityBytes || disk.sizeBytes)}
        />
        <Stat
          label="Temperature"
          value={
            <span
              className={`inline-flex items-center gap-1.5 ${
                tempStatus === "bad"
                  ? "text-bad"
                  : tempStatus === "warn"
                  ? "text-warn"
                  : "text-ink"
              }`}
            >
              <Thermometer size={16} />
              {report.temperatureC != null ? `${report.temperatureC}°C` : "—"}
            </span>
          }
          hint={
            report.temperatureC != null
              ? tempStatus === "bad"
                ? "Running hot"
                : tempStatus === "warn"
                ? "Warm"
                : "Normal range"
              : undefined
          }
        />
        <Stat
          label="Power-On Hours"
          value={
            <span className="inline-flex items-center gap-1.5">
              <Clock size={16} className="text-ink-muted" />
              {report.powerOnHours != null
                ? report.powerOnHours.toLocaleString("en-US")
                : "—"}
            </span>
          }
          hint={
            report.powerOnHours != null && report.powerOnHours > 0
              ? `≈ ${humanHours(report.powerOnHours)} in service`
              : undefined
          }
        />
        <Stat
          label="Power Cycles"
          value={
            <span className="inline-flex items-center gap-1.5">
              <RotateCw size={16} className="text-ink-muted" />
              {report.powerCycles != null
                ? report.powerCycles.toLocaleString("en-US")
                : "—"}
            </span>
          }
        />
      </div>

      {report.attributes.length > 0 && <AttributesTable report={report} />}

      {report.nvme && Object.keys(report.nvme).length > 0 && (
        <NvmePanel nvme={report.nvme} />
      )}
    </div>
  );
}

function HealthSummaryCard({ report }: { report: SmartReport }) {
  const summary = healthSummary(report);
  const tone =
    report.overall === "good"
      ? {
          ring: "border-ok/30 bg-ok/[0.06]",
          icon: <ShieldCheck size={26} className="text-ok" />,
        }
      : report.overall === "caution"
      ? {
          ring: "border-warn/30 bg-warn/[0.06]",
          icon: <ShieldAlert size={26} className="text-warn" />,
        }
      : report.overall === "bad"
      ? {
          ring: "border-bad/30 bg-bad/[0.06]",
          icon: <ShieldX size={26} className="text-bad" />,
        }
      : {
          ring: "border-line bg-canvas-inset/40",
          icon: <ShieldQuestion size={26} className="text-ink-muted" />,
        };

  return (
    <div className={`card flex gap-4 border p-5 ${tone.ring}`}>
      <div className="mt-0.5 shrink-0">{tone.icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-base font-semibold text-ink">{summary.title}</h3>
          <HealthBadge health={report.overall} />
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {summary.message}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <CountChip n={summary.okCount} label="OK" cls="bg-ok/12 text-ok" />
          {summary.warnCount > 0 && (
            <CountChip
              n={summary.warnCount}
              label="Watch"
              cls="bg-warn/12 text-warn"
            />
          )}
          {summary.badCount > 0 && (
            <CountChip
              n={summary.badCount}
              label="Critical"
              cls="bg-bad/12 text-bad"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CountChip({
  n,
  label,
  cls,
}: {
  n: number;
  label: string;
  cls: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium ${cls}`}
    >
      <span className="tabular-nums">{n}</span>
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: AttrStatus }) {
  const cls =
    status === "bad"
      ? "bg-bad/15 text-bad"
      : status === "warn"
      ? "bg-warn/15 text-warn"
      : "bg-ok/12 text-ok";
  const dot =
    status === "bad" ? "bg-bad" : status === "warn" ? "bg-warn" : "bg-ok";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {statusLabel(status)}
    </span>
  );
}

function AttributesTable({ report }: { report: SmartReport }) {
  const rows = report.attributes.map(attributeView);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          S.M.A.R.T. Attributes
        </span>
        <span className="text-xs text-ink-faint">
          {rows.length} monitored values
        </span>
      </div>
      <div className="divide-y divide-line-soft">
        {rows.map((a) => (
          <div
            key={a.id}
            className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-line-soft/40 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-ink-faint">
                  #{a.id}
                </span>
                <span className="truncate text-sm font-medium text-ink">
                  {a.label}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-snug text-ink-muted">
                {a.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <div className="text-right">
                <div className="font-mono text-sm tabular-nums text-ink">
                  {a.raw}
                </div>
                <div className="text-[11px] tabular-nums text-ink-faint">
                  val {a.value} · thr {a.threshold}
                </div>
              </div>
              <StatusPill status={a.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NvmePanel({ nvme }: { nvme: Record<string, number> }) {
  const rows = nvmeViews(nvme);
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
        NVMe Health Log
      </div>
      <div className="grid grid-cols-1 gap-px bg-line-soft sm:grid-cols-2">
        {rows.map((r) => (
          <div
            key={r.key}
            className="flex items-start justify-between gap-3 bg-canvas-raised px-4 py-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">{r.label}</div>
              <p className="mt-0.5 text-xs leading-snug text-ink-muted">
                {r.description}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div
                className={`font-mono text-sm tabular-nums ${
                  r.status === "bad"
                    ? "text-bad"
                    : r.status === "warn"
                    ? "text-warn"
                    : "text-ink"
                }`}
              >
                {r.display}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
