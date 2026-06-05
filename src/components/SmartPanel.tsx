import { useState } from "react";
import { Thermometer, Clock, RotateCw, FileDown, Activity } from "lucide-react";
import type { DiskInfo, SmartReport } from "../types";
import { formatBytes } from "../lib/format";
import { saveSmartPdf } from "../lib/pdf";
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

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-clay" />
          <div>
            <h2 className="text-lg font-semibold text-ink">{report.model}</h2>
            <p className="font-mono text-xs text-ink-muted">
              {report.serial} · {report.firmware} · {report.protocol}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <HealthBadge health={report.overall} />
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            <FileDown size={15} />
            {saving ? "Saving…" : "Save PDF"}
          </button>
        </div>
      </div>

      {savedPath && (
        <div className="card border-ok/30 bg-ok/5 px-4 py-2.5 text-sm text-ok">
          Report saved to <span className="font-mono">{savedPath}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Capacity"
          value={formatBytes(report.capacityBytes || disk.sizeBytes)}
        />
        <Stat
          label="Temperature"
          value={
            <span className="inline-flex items-center gap-1.5">
              <Thermometer size={16} className="text-ink-muted" />
              {report.temperatureC != null ? `${report.temperatureC}°C` : "—"}
            </span>
          }
        />
        <Stat
          label="Power-On Hours"
          value={
            <span className="inline-flex items-center gap-1.5">
              <Clock size={16} className="text-ink-muted" />
              {report.powerOnHours != null ? report.powerOnHours : "—"}
            </span>
          }
        />
        <Stat
          label="Power Cycles"
          value={
            <span className="inline-flex items-center gap-1.5">
              <RotateCw size={16} className="text-ink-muted" />
              {report.powerCycles != null ? report.powerCycles : "—"}
            </span>
          }
        />
      </div>

      {report.attributes.length > 0 && (
        <AttributesTable report={report} />
      )}

      {report.nvme && Object.keys(report.nvme).length > 0 && (
        <NvmePanel nvme={report.nvme} />
      )}
    </div>
  );
}

function AttributesTable({ report }: { report: SmartReport }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
        S.M.A.R.T. Attributes
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-faint">
              <th className="px-4 py-2 font-medium">ID</th>
              <th className="px-4 py-2 font-medium">Attribute</th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
              <th className="px-4 py-2 text-right font-medium">Worst</th>
              <th className="px-4 py-2 text-right font-medium">Thresh</th>
              <th className="px-4 py-2 text-right font-medium">Raw</th>
            </tr>
          </thead>
          <tbody>
            {report.attributes.map((a) => (
              <tr
                key={a.id}
                className="border-t border-line-soft hover:bg-line-soft/40"
              >
                <td className="px-4 py-2 font-mono text-ink-muted">{a.id}</td>
                <td className="px-4 py-2 text-ink">{a.name}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">
                  {a.value}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                  {a.worst}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                  {a.threshold}
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono tabular-nums ${
                    a.status === "bad"
                      ? "text-bad"
                      : a.status === "warn"
                      ? "text-warn"
                      : "text-ink"
                  }`}
                >
                  {a.raw}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NvmePanel({ nvme }: { nvme: Record<string, number> }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
        NVMe Health Log
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-px p-2 sm:grid-cols-2">
        {Object.entries(nvme).map(([k, v]) => (
          <div
            key={k}
            className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-line-soft/40"
          >
            <span className="text-sm capitalize text-ink-muted">
              {k.replace(/_/g, " ")}
            </span>
            <span className="font-mono text-sm tabular-nums text-ink">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
