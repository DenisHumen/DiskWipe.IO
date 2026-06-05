import { HardDrive, Usb, ShieldCheck, RefreshCw } from "lucide-react";
import type { DiskInfo } from "../types";
import { formatBytes } from "../lib/format";

export function DiskList({
  disks,
  loading,
  selectedId,
  onSelect,
  onRefresh,
}: {
  disks: DiskInfo[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (d: DiskInfo) => void;
  onRefresh: () => void;
}) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-canvas-inset">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Disks
        </span>
        <button
          className="btn-ghost h-7 w-7 !px-0"
          onClick={onRefresh}
          title="Rescan disks"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {disks.length === 0 && !loading && (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">
            No disks detected.
          </p>
        )}

        {disks.map((d) => {
          const active = d.id === selectedId;
          const Icon = d.isRemovable ? Usb : HardDrive;
          return (
            <button
              key={d.id}
              onClick={() => onSelect(d)}
              className={`group mb-1 flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                active ? "bg-canvas-raised" : "hover:bg-line-soft/60"
              }`}
            >
              <Icon
                size={18}
                className={`mt-0.5 shrink-0 ${
                  active ? "text-clay" : "text-ink-muted group-hover:text-ink"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-ink">
                    {d.model || "Unknown disk"}
                  </span>
                  {d.isSystem && (
                    <ShieldCheck size={13} className="shrink-0 text-clay" />
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                  <span className="tabular-nums">{formatBytes(d.sizeBytes)}</span>
                  <span className="text-ink-faint">·</span>
                  <span className="uppercase">{d.bus || "—"}</span>
                  <span className="text-ink-faint">·</span>
                  <span>{d.rotational ? "HDD" : "SSD"}</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">
                  {d.path}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
