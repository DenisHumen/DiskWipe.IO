import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export const REPO_URL = "https://github.com/DenisHumen/DiskWipe.IO";

export type UpdateStage =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "installing"; version: string }
  | { kind: "uptodate" }
  | { kind: "error"; message: string };

/**
 * Check for a newer release on startup and, if found, download and install it
 * immediately, then relaunch. Progress is reported through `onStage`.
 *
 * Safe to call in the browser/dev: when the updater plugin is unavailable the
 * call simply reports an error and the app continues normally.
 */
export async function checkAndInstallUpdate(
  onStage: (s: UpdateStage) => void
): Promise<void> {
  let update: Update | null = null;
  try {
    onStage({ kind: "checking" });
    update = await check();
  } catch (e) {
    onStage({ kind: "error", message: String(e) });
    return;
  }

  if (!update) {
    onStage({ kind: "uptodate" });
    return;
  }

  const version = update.version;
  onStage({ kind: "available", version });

  try {
    let downloaded = 0;
    let total = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          onStage({ kind: "downloading", version, percent: 0 });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          onStage({
            kind: "downloading",
            version,
            percent: total > 0 ? (downloaded / total) * 100 : 0,
          });
          break;
        case "Finished":
          onStage({ kind: "installing", version });
          break;
      }
    });

    // The new version is installed; restart into it.
    await relaunch();
  } catch (e) {
    onStage({ kind: "error", message: String(e) });
  }
}
