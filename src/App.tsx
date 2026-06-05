import { useCallback, useEffect, useState } from "react";
import { Activity, Eraser, TriangleAlert, HardDrive, Github } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DiskInfo, SmartReport } from "./types";
import { listDisks, getSmart, smartctlAvailable } from "./lib/api";
import {
  checkAndInstallUpdate,
  REPO_URL,
  type UpdateStage,
} from "./lib/updater";
import { DiskList } from "./components/DiskList";
import { SmartPanel } from "./components/SmartPanel";
import { FormatPanel } from "./components/FormatPanel";
import { UpdateBanner } from "./components/UpdateBanner";

type Tab = "health" | "format";

export default function App() {
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [loadingDisks, setLoadingDisks] = useState(true);
  const [selected, setSelected] = useState<DiskInfo | null>(null);
  const [tab, setTab] = useState<Tab>("health");

  const [report, setReport] = useState<SmartReport | null>(null);
  const [loadingSmart, setLoadingSmart] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);
  const [smartctlOk, setSmartctlOk] = useState(true);

  const [updateStage, setUpdateStage] = useState<UpdateStage>({ kind: "idle" });

  const refreshDisks = useCallback(async () => {
    setLoadingDisks(true);
    try {
      const list = await listDisks();
      setDisks(list);
      setSelected((prev) => {
        if (prev) {
          const match = list.find((d) => d.id === prev.id);
          if (match) return match;
        }
        return list[0] ?? null;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDisks(false);
    }
  }, []);

  const loadSmart = useCallback(async (disk: DiskInfo) => {
    setLoadingSmart(true);
    setSmartError(null);
    setReport(null);
    try {
      const r = await getSmart(disk.id);
      setReport(r);
    } catch (e) {
      setSmartError(String(e));
    } finally {
      setLoadingSmart(false);
    }
  }, []);

  useEffect(() => {
    smartctlAvailable().then(setSmartctlOk).catch(() => setSmartctlOk(false));
    refreshDisks();
    // Check for updates on startup; download & install automatically if any.
    checkAndInstallUpdate(setUpdateStage).catch(() => {});
  }, [refreshDisks]);

  useEffect(() => {
    if (selected) loadSmart(selected);
  }, [selected, loadSmart]);

  function selectDisk(d: DiskInfo) {
    setSelected(d);
    setTab("health");
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas">
      <DiskList
        disks={disks}
        loading={loadingDisks}
        selectedId={selected?.id ?? null}
        onSelect={selectDisk}
        onRefresh={refreshDisks}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-line px-6 py-3">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div>
              <h1 className="text-sm font-semibold leading-none text-ink">
                DiskWipe.IO
              </h1>
              <p className="mt-1 text-xs leading-none text-ink-faint">
                SMART monitoring &amp; secure formatting
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {selected && (
              <nav className="flex items-center gap-1 rounded-lg bg-canvas-inset p-1">
                <TabButton
                  active={tab === "health"}
                  onClick={() => setTab("health")}
                  icon={<Activity size={15} />}
                  label="Health"
                />
                <TabButton
                  active={tab === "format"}
                  onClick={() => setTab("format")}
                  icon={<Eraser size={15} />}
                  label="Format"
                />
              </nav>
            )}

            <button
              className="btn-ghost h-8 w-8 !px-0"
              title="Open project on GitHub"
              aria-label="Open project on GitHub"
              onClick={() => openUrl(REPO_URL).catch(() => {})}
            >
              <Github size={17} />
            </button>
          </div>
        </header>


        {!smartctlOk && (
          <div className="flex items-center gap-2 border-b border-warn/20 bg-warn/5 px-6 py-2 text-xs text-warn">
            <TriangleAlert size={14} />
            <span>
              <code className="font-mono">smartctl</code> was not found. Install{" "}
              <span className="font-medium">smartmontools</span> to read SMART
              data.
            </span>
          </div>
        )}

        {/* Body */}
        <section className="flex-1 overflow-y-auto px-6 py-6">
          {!selected ? (
            <EmptyState />
          ) : tab === "health" ? (
            <SmartPanel
              disk={selected}
              report={report}
              loading={loadingSmart}
              error={smartError}
            />
          ) : (
            <FormatPanel
              disk={selected}
              onAfterFormat={() => {
                loadSmart(selected);
                setTab("health");
              }}
            />
          )}
        </section>

        <UpdateBanner stage={updateStage} />
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-canvas-raised text-ink shadow-sm"
          : "text-ink-muted hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <HardDrive size={40} className="text-ink-faint" />
      <p className="mt-4 text-sm text-ink-muted">
        Select a disk from the sidebar to view its SMART health.
      </p>
    </div>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" fill="none" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#d97757" />
      <circle cx="32" cy="32" r="17" stroke="#1a1916" strokeWidth="4" />
      <circle cx="32" cy="32" r="4" fill="#1a1916" />
      <path
        d="M32 15v8M32 41v8M15 32h8M41 32h8"
        stroke="#1a1916"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
