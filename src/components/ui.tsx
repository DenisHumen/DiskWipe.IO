import type { Health } from "../types";

export function HealthDot({ health }: { health: Health }) {
  const color =
    health === "good"
      ? "bg-ok"
      : health === "caution"
      ? "bg-warn"
      : health === "bad"
      ? "bg-bad"
      : "bg-ink-faint";
  return (
    <span className="relative flex h-2.5 w-2.5">
      {health !== "unknown" && (
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-50 ${color} ${
            health === "bad" ? "animate-ping" : ""
          }`}
        />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

export function HealthBadge({ health }: { health: Health }) {
  const map: Record<Health, { label: string; cls: string }> = {
    good: { label: "Good", cls: "bg-ok/15 text-ok" },
    caution: { label: "Caution", cls: "bg-warn/15 text-warn" },
    bad: { label: "Bad", cls: "bg-bad/15 text-bad" },
    unknown: { label: "Unknown", cls: "bg-line text-ink-muted" },
  };
  const m = map[health];
  return (
    <span className={`tag ${m.cls}`}>
      <HealthDot health={health} />
      {m.label}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-lg bg-line-soft ${className}`} />;
}
