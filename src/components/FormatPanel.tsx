import { useEffect, useState } from "react";
import {
  ShieldAlert,
  Zap,
  Eraser,
  Lock,
  TriangleAlert,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import type { DiskInfo, FormatMode, FormatProgress } from "../types";
import { formatBytes } from "../lib/format";
import { formatDisk, onFormatProgress, hasAdminRights } from "../lib/api";

const FILESYSTEMS = ["exfat", "ntfs", "ext4", "fat32"];

export function FormatPanel({
  disk,
  onAfterFormat,
}: {
  disk: DiskInfo;
  onAfterFormat: () => void;
}) {
  const [mode, setMode] = useState<FormatMode>("quick");
  const [fs, setFs] = useState("exfat");
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<FormatProgress | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);

  useEffect(() => {
    hasAdminRights().then(setIsAdmin).catch(() => setIsAdmin(true));
  }, []);

  // Reset the form whenever a different disk is selected.
  useEffect(() => {
    setConfirm("");
    setProgress(null);
    setDone(false);
    setError(null);
  }, [disk.id]);

  const serialOk =
    disk.serial.length > 0 && confirm.trim() === disk.serial.trim();
  const canFormat = !disk.isSystem && isAdmin && serialOk && !running;

  async function run() {
    setRunning(true);
    setError(null);
    setDone(false);
    setProgress({ diskId: disk.id, phase: "start", percent: 0, message: "Starting…" });

    const unlisten = await onFormatProgress((p) => {
      if (p.diskId === disk.id) setProgress(p);
    });

    try {
      await formatDisk({
        diskId: disk.id,
        mode,
        filesystem: fs,
        label,
        confirmSerial: confirm.trim(),
      });
      setDone(true);
      onAfterFormat();
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setRunning(false);
    }
  }

  if (disk.isSystem) {
    return (
      <div className="card flex items-start gap-4 border-clay/30 bg-clay/5 p-6">
        <Lock className="mt-0.5 shrink-0 text-clay" size={22} />
        <div>
          <h3 className="font-semibold text-ink">System disk — protected</h3>
          <p className="mt-1 text-sm text-ink-muted">
            This disk hosts the running operating system. DiskWipe.IO blocks all
            formatting on the system disk to prevent accidental data loss. Choose
            a different disk to continue.
          </p>
          {disk.mountpoints.length > 0 && (
            <p className="mt-2 font-mono text-xs text-ink-faint">
              mounts: {disk.mountpoints.join(", ")}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <div className="card border-bad/30 bg-bad/5 p-4">
        <div className="flex items-center gap-2 text-bad">
          <ShieldAlert size={18} />
          <span className="font-semibold">Destructive operation</span>
        </div>
        <p className="mt-1.5 text-sm text-ink-muted">
          Formatting <span className="font-medium text-ink">{disk.model}</span>{" "}
          ({formatBytes(disk.sizeBytes)}) permanently erases all data on it. This
          cannot be undone.
        </p>
      </div>

      {!isAdmin && (
        <div className="card flex items-center gap-3 border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
          <TriangleAlert size={16} />
          Administrator / root privileges are required. Relaunch the app
          elevated to enable formatting.
        </div>
      )}

      {/* Mode */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ModeCard
          active={mode === "quick"}
          onClick={() => setMode("quick")}
          icon={<Zap size={18} />}
          title="Quick format"
          desc="Recreates the filesystem. Fast — data is not overwritten."
        />
        <ModeCard
          active={mode === "full"}
          onClick={() => setMode("full")}
          icon={<Eraser size={18} />}
          title="Full erase"
          desc="Overwrites every sector with zeros, then creates a filesystem."
        />
      </div>

      {/* Options */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="card px-4 py-3">
          <span className="text-xs uppercase tracking-wide text-ink-faint">
            Filesystem
          </span>
          <select
            className="mt-1 w-full bg-transparent text-sm text-ink outline-none"
            value={fs}
            onChange={(e) => setFs(e.target.value)}
            disabled={running}
          >
            {FILESYSTEMS.map((f) => (
              <option key={f} value={f} className="bg-canvas-raised">
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="card px-4 py-3">
          <span className="text-xs uppercase tracking-wide text-ink-faint">
            Volume label
          </span>
          <input
            className="mt-1 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            value={label}
            placeholder="DISKWIPE"
            maxLength={32}
            onChange={(e) => setLabel(e.target.value)}
            disabled={running}
          />
        </label>
      </div>

      {/* Confirmation */}
      <div className="card p-4">
        <label className="text-sm text-ink">
          To confirm, type the disk serial{" "}
          <span className="select-all font-mono text-clay">
            {disk.serial || "(no serial reported)"}
          </span>
        </label>
        <input
          className="mt-2 w-full rounded-lg border border-line bg-canvas-inset px-3 py-2 font-mono text-sm text-ink outline-none focus:border-clay"
          value={confirm}
          placeholder="Type serial to unlock"
          onChange={(e) => setConfirm(e.target.value)}
          disabled={running}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Progress */}
      {progress && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ink">
              {done ? (
                <CheckCircle2 size={16} className="text-ok" />
              ) : (
                <Loader2 size={16} className="animate-spin text-clay" />
              )}
              {progress.message}
            </span>
            <span className="tabular-nums text-ink-muted">
              {Math.round(progress.percent)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                done ? "bg-ok" : "bg-clay"
              }`}
              style={{ width: `${Math.min(100, progress.percent)}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="card border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button className="btn-danger" onClick={run} disabled={!canFormat}>
          {running ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Eraser size={15} />
          )}
          {mode === "full" ? "Erase & Format" : "Quick Format"}
        </button>
      </div>
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`card p-4 text-left transition-colors ${
        active ? "border-clay bg-clay/5" : "hover:border-line"
      }`}
    >
      <div
        className={`flex items-center gap-2 font-medium ${
          active ? "text-clay" : "text-ink"
        }`}
      >
        {icon}
        {title}
      </div>
      <p className="mt-1.5 text-sm text-ink-muted">{desc}</p>
    </button>
  );
}
