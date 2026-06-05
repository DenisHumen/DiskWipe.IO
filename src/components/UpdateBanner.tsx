import { Download, Loader2, RefreshCw } from "lucide-react";
import type { UpdateStage } from "../lib/updater";

/**
 * Slim banner shown at the bottom of the window while an update is being
 * downloaded or installed. Hidden when idle / up to date.
 */
export function UpdateBanner({ stage }: { stage: UpdateStage }) {
  if (
    stage.kind === "idle" ||
    stage.kind === "uptodate" ||
    stage.kind === "checking" ||
    stage.kind === "error"
  ) {
    return null;
  }

  let label = "";
  let percent = 0;
  let icon = <Download size={15} className="text-clay" />;

  switch (stage.kind) {
    case "available":
      label = `Update ${stage.version} found — preparing…`;
      icon = <RefreshCw size={15} className="animate-spin text-clay" />;
      break;
    case "downloading":
      label = `Downloading update ${stage.version}…`;
      percent = stage.percent;
      break;
    case "installing":
      label = `Installing ${stage.version} — the app will restart…`;
      icon = <Loader2 size={15} className="animate-spin text-clay" />;
      percent = 100;
      break;
  }

  return (
    <div className="animate-fade-in border-t border-line bg-canvas-inset px-6 py-2.5">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-ink">
          {icon}
          {label}
        </span>
        {stage.kind === "downloading" && (
          <span className="tabular-nums text-ink-muted">
            {Math.round(percent)}%
          </span>
        )}
      </div>
      {(stage.kind === "downloading" || stage.kind === "installing") && (
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-clay transition-all duration-200"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
      )}
    </div>
  );
}
