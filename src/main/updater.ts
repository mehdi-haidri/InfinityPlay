/**
 * Auto-update against GitHub Releases.
 *
 * electron-updater reads the `publish` block in electron-builder.yml, so the packaged app
 * knows which repo to poll without any of it being configured here. Updating only works
 * for an installed build: in dev, and for an unpacked directory, there is no installer to
 * swap, so the whole flow reports `unsupported` rather than throwing.
 */
import { app, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateStatus } from "@shared/types";

const { autoUpdater } = electronUpdater;

let status: UpdateStatus = { state: "idle" };
let listenersBound = false;
let getWindow: () => BrowserWindow | null = () => null;

const DEVELOPMENT_UNSUPPORTED_MESSAGE =
  "Updates are only available in an installed build. This looks like a development run.";

const UNSIGNED_MAC_UNSUPPORTED_MESSAGE =
  "Automatic updates require a signed macOS build. Download the newest DMG from GitHub Releases.";

function unsupportedMessage(): string | null {
  if (!app.isPackaged) return DEVELOPMENT_UNSUPPORTED_MESSAGE;
  // Squirrel.Mac rejects unsigned update bundles. Keep checks disabled until the release
  // workflow is supplied with a Developer ID certificate and notarization credentials.
  if (process.platform === "darwin") return UNSIGNED_MAC_UNSUPPORTED_MESSAGE;
  return null;
}

export function isAutoUpdateSupported(): boolean {
  return unsupportedMessage() === null;
}

function publish(next: UpdateStatus): void {
  status = next;
  const window = getWindow();
  if (window && !window.isDestroyed()) window.webContents.send("update:status", next);
}

function bindListeners(): void {
  if (listenersBound) return;
  listenersBound = true;

  // The app decides when to download and when to restart, so nothing happens implicitly.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => publish({ state: "checking" }));

  autoUpdater.on("update-available", (info) => {
    publish({ state: "available", version: info.version });
    // Fetch straight away; the user is only asked before the restart.
    autoUpdater.downloadUpdate().catch((error: unknown) => {
      publish({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    publish({ state: "up-to-date", version: info?.version ?? app.getVersion() });
  });

  autoUpdater.on("download-progress", (progress) => {
    publish({
      state: "downloading",
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    publish({ state: "downloaded", version: info.version });
  });

  autoUpdater.on("error", (error) => {
    publish({
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export function initUpdater(resolveWindow: () => BrowserWindow | null): void {
  getWindow = resolveWindow;
  const message = unsupportedMessage();
  if (message) {
    status = { state: "unsupported", message };
    return;
  }
  bindListeners();
  // A silent check shortly after launch; failures stay in `status` and surface on the
  // About page rather than interrupting playback with a dialog.
  setTimeout(() => void checkForUpdates(), 8_000);
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const message = unsupportedMessage();
  if (message) {
    publish({ state: "unsupported", message });
    return status;
  }
  bindListeners();
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publish({
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return status;
}

/** Quits and swaps in the downloaded installer. No-op unless a download has finished. */
export function installUpdate(): boolean {
  if (status.state !== "downloaded") return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}
