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
import { CancellationError, CancellationToken } from "builder-util-runtime";
import type { UpdateStatus } from "@shared/types";

const { autoUpdater } = electronUpdater;

let status: UpdateStatus = { state: "idle" };
let listenersBound = false;
let getWindow: () => BrowserWindow | null = () => null;

/** Cancels the transfer in flight. Null whenever nothing is downloading. */
let downloadToken: CancellationToken | null = null;
/** The version last offered, kept so pause/resume and decline can name it. */
let offeredVersion = "";
/** That release's notes — the GitHub release body, which is RELEASES.md at that version. */
let offeredNotes: string | undefined;
/** Last progress seen, so a paused card can show how far it got. */
let lastProgress = { percent: 0, transferred: 0, total: 0 };

const DEVELOPMENT_UNSUPPORTED_MESSAGE =
  "Updates are only available in an installed build. This looks like a development run.";

const UNSIGNED_MAC_UNSUPPORTED_MESSAGE =
  "Automatic updates require a signed macOS build. Download the newest DMG from GitHub Releases.";

const LEGACY_LINUX_RELEASE_MESSAGE =
  "This Linux release predates updater metadata. Download the latest AppImage, DEB, RPM, or Arch package from GitHub Releases.";

function publishError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (process.platform === "linux" && /latest-linux\.yml/i.test(message) && /404|cannot find/i.test(message)) {
    publish({ state: "unsupported", message: LEGACY_LINUX_RELEASE_MESSAGE });
    return;
  }
  // electron-updater includes full HTTP headers and its internal stack in some messages.
  // The first line contains the useful reason and keeps About readable.
  publish({ state: "error", message: message.split("\n")[0] || "The update check failed." });
}

/**
 * `releaseNotes` is a string for one release, or a newest-first list when several versions
 * are skipped. About intentionally shows only the main/latest update, so keep the first
 * non-empty entry instead of concatenating historical changelogs.
 */
function releaseNotesText(notes: unknown): string | undefined {
  if (typeof notes === "string") return notes.trim() || undefined;
  if (!Array.isArray(notes)) return undefined;

  for (const entry of notes) {
      const item = entry as { version?: string; note?: string | null };
      const body = (item.note ?? "").trim();
      if (body) return body;
  }
  return undefined;
}

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

  // Nothing is fetched or installed without the user saying so. `autoInstallOnAppQuit` is the
  // "later" branch: a downloaded update lands the next time the app closes on its own.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => publish({ state: "checking" }));

  autoUpdater.on("update-available", (info) => {
    offeredVersion = info.version;
    offeredNotes = releaseNotesText(info.releaseNotes);
    lastProgress = { percent: 0, transferred: 0, total: 0 };
    // Offer only. The download waits for `startUpdateDownload`.
    publish({ state: "available", version: info.version, notes: offeredNotes });
  });

  autoUpdater.on("update-not-available", (info) => {
    publish({ state: "up-to-date", version: info?.version ?? app.getVersion() });
  });

  autoUpdater.on("download-progress", (progress) => {
    lastProgress = {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    };
    publish({ state: "downloading", version: offeredVersion, notes: offeredNotes, ...lastProgress });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadToken = null;
    offeredNotes = releaseNotesText(info.releaseNotes) ?? offeredNotes;
    publish({ state: "downloaded", version: info.version, notes: offeredNotes });
  });

  autoUpdater.on("error", (error) => {
    // A pause cancels the transfer, and electron-updater reports that as an error. The paused
    // card is already on screen, so swallow it rather than replacing it with a failure.
    if (error instanceof CancellationError) return;
    publishError(error);
  });
}

/**
 * Accepts the offered update. Also serves as resume: electron-updater has no byte-range resume,
 * so a paused transfer starts over rather than continuing from where it stopped.
 */
export function startUpdateDownload(): boolean {
  if (!isAutoUpdateSupported()) return false;
  if (!["available", "paused", "declined"].includes(status.state)) return false;

  bindListeners();
  downloadToken = new CancellationToken();
  publish({ state: "downloading", version: offeredVersion, ...lastProgress });

  autoUpdater.downloadUpdate(downloadToken).catch((error: unknown) => {
    if (error instanceof CancellationError) return;
    publishError(error);
  });
  return true;
}

export function pauseUpdateDownload(): boolean {
  if (status.state !== "downloading" || !downloadToken) return false;
  downloadToken.cancel();
  downloadToken = null;
  publish({ state: "paused", version: offeredVersion, notes: offeredNotes, ...lastProgress });
  return true;
}

/** Dismisses the offer without fetching it; About keeps a button to take it up later. */
export function declineUpdate(): boolean {
  if (status.state === "downloading") pauseUpdateDownload();
  if (!offeredVersion) return false;
  publish({ state: "declined", version: offeredVersion, notes: offeredNotes });
  return true;
}

export function initUpdater(resolveWindow: () => BrowserWindow | null): void {
  getWindow = resolveWindow;
  const message = unsupportedMessage();
  if (message) {
    status = { state: "unsupported", message };
    return;
  }
  bindListeners();
  // A check shortly after launch. Finding something publishes `available`, which the renderer
  // turns into an accept/decline prompt; a failure stays in `status` for the About page instead
  // of interrupting playback.
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
    publishError(error);
  }
  return status;
}

/** Quits and swaps in the downloaded installer. No-op unless a download has finished. */
export function installUpdate(): boolean {
  if (status.state !== "downloaded") return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}
