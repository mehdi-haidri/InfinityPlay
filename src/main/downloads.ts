/**
 * Downloads ride on Chromium's own DownloadItem, which already provides pause, resume,
 * progress and disk writes, rather than a hand-rolled range/segment engine.
 *
 * Records are persisted, so the Downloads page survives a restart and knows what is on
 * disk. The live `DownloadItem` objects are not persistable, so they are held separately
 * and only exist for the lifetime of the process.
 */
import fs from "node:fs";
import path from "node:path";
import { app, shell, type BrowserWindow, type DownloadItem } from "electron";
import type { DownloadRecord, DownloadRequest } from "@shared/types";
import { getConfig, getDownloadRecords, saveDownloadRecords } from "./store";
import { MovieBoxService } from "./providers/moviebox";
import { saveSubtitleFile } from "./providers/subtitles";

const catalog = new MovieBoxService();

/** Matches the privileged scheme registered in `index.ts`. */
const localMediaUrl = (filePath: string): string =>
  `ipmedia://local/?path=${encodeURIComponent(filePath)}`;

/** In-flight items, keyed by record id. Empty after a restart. */
const active = new Map<string, DownloadItem>();

/** Downloads asked for but not yet claimed by a `will-download` event, keyed by URL. */
const awaitingItem = new Map<string, DownloadRecord>();

let resolveWindow: () => BrowserWindow | null = () => null;

/** Renderer-safe filename: no separators, no reserved characters, always an extension. */
function buildFilename(request: DownloadRequest): string {
  const episodeTag =
    request.season > 0
      ? ` S${String(request.season).padStart(2, "0")}E${String(request.episode).padStart(2, "0")}`
      : "";
  const quality = request.resolution > 0 ? ` ${request.resolution}p` : "";
  const base = `${request.title}${episodeTag}${quality}`.replace(/[\\/:*?"<>|]+/g, "_").trim();

  let extension = ".mp4";
  try {
    extension = path.extname(new URL(request.url).pathname) || ".mp4";
  } catch {
    // Keep the default.
  }
  return `${base || "download"}${extension}`;
}

/** Avoids clobbering an existing file by appending ` (2)`, ` (3)` and so on. */
function uniquePath(directory: string, filename: string): string {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(directory, filename);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${stem} (${counter})${extension}`);
    counter += 1;
  }
  return candidate;
}

function broadcast(record: DownloadRecord): void {
  const window = resolveWindow();
  if (window && !window.isDestroyed()) window.webContents.send("download:progress", record);
}

function upsert(record: DownloadRecord): DownloadRecord {
  const records = getDownloadRecords();
  const index = records.findIndex((entry) => entry.id === record.id);
  if (index === -1) records.unshift(record);
  else records[index] = record;
  saveDownloadRecords(records);
  return record;
}

const findRecord = (id: string): DownloadRecord | undefined =>
  getDownloadRecords().find((entry) => entry.id === id);

/**
 * Matches an incoming `DownloadItem` to the request that asked for it.
 *
 * The obvious `getURL()` lookup is not enough: a redirecting link (very common for CDN
 * and release downloads) arrives under its *final* URL, so the item goes unclaimed, never
 * gets a save path, and never reports progress. The whole redirect chain is checked, and
 * as a last resort a single outstanding request is adopted.
 */
function claimPending(item: DownloadItem): DownloadRecord | undefined {
  const candidates = [item.getURL(), ...(item.getURLChain?.() ?? [])];
  for (const url of candidates) {
    const pending = awaitingItem.get(url);
    if (pending) {
      awaitingItem.delete(url);
      return pending;
    }
  }

  if (awaitingItem.size === 1) {
    const [url, pending] = [...awaitingItem.entries()][0];
    awaitingItem.delete(url);
    return pending;
  }
  return undefined;
}

/**
 * Registers the single `will-download` listener and repairs records left mid-flight by a
 * previous run — Chromium cannot resume those, so they are reported as interrupted.
 */
export function initDownloads(getWindow: () => BrowserWindow | null): void {
  resolveWindow = getWindow;

  const repaired = getDownloadRecords().map((record) => {
    const fileExists = record.savePath ? fs.existsSync(record.savePath) : false;
    const state =
      record.state === "progressing" || record.state === "paused" ? "interrupted" : record.state;
    return {
      ...record,
      state,
      fileExists,
      subtitles: record.subtitles ?? [],
      // Records written before the private scheme existed still hold a `file://` URL.
      fileUrl: record.savePath ? localMediaUrl(record.savePath) : record.fileUrl,
    };
  });
  saveDownloadRecords(repaired as DownloadRecord[]);

  const window = getWindow();
  if (!window) return;

  window.webContents.session.on("will-download", (_event, item) => {
    const pending = claimPending(item);
    if (!pending) return;

    item.setSavePath(pending.savePath);
    active.set(pending.id, item);

    item.on("updated", () => {
      const state = item.isPaused() ? "paused" : "progressing";
      broadcast(
        upsert({
          ...pending,
          subtitles: findRecord(pending.id)?.subtitles ?? pending.subtitles,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          state,
        }),
      );
    });

    item.once("done", (_doneEvent, doneState) => {
      active.delete(pending.id);
      const mime = item.getMimeType().toLowerCase();
      const invalidPayload =
        mime.includes("dash+xml") || mime.includes("text/html") || mime.includes("application/json");
      const completed = doneState === "completed" && !invalidPayload;
      if (invalidPayload) {
        try {
          fs.rmSync(pending.savePath, { force: true });
        } catch {
          // The record below still explains why the unusable transfer was rejected.
        }
      }
      broadcast(
        upsert({
          ...pending,
          subtitles: findRecord(pending.id)?.subtitles ?? pending.subtitles,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes() || item.getReceivedBytes(),
          state: completed ? "completed" : doneState === "cancelled" ? "cancelled" : "interrupted",
          completedAt: completed ? Date.now() : null,
          fileExists: completed && fs.existsSync(pending.savePath),
          failureReason: invalidPayload
            ? "The server returned a manifest or error page instead of a playable video."
            : undefined,
        }),
      );
    });
  });
}

export function startDownload(request: DownloadRequest): DownloadRecord {
  const window = resolveWindow();
  if (!window) throw new Error("No window is available to own the download.");
  if (request.sourceKind === "dash" || /\.mpd(?:$|\?)/i.test(request.url)) {
    throw new Error("Adaptive DASH manifests cannot be saved as videos. Choose an MP4 source.");
  }

  const directory = app.getPath("downloads");
  const filename = buildFilename(request);
  const savePath = uniquePath(directory, filename);

  const record: DownloadRecord = {
    ...request,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    filename: path.basename(savePath),
    savePath,
    fileUrl: localMediaUrl(savePath),
    receivedBytes: 0,
    totalBytes: 0,
    state: "progressing",
    startedAt: Date.now(),
    completedAt: null,
    fileExists: false,
    subtitles: [],
  };

  awaitingItem.set(request.url, record);
  upsert(record);
  window.webContents.downloadURL(request.url);
  void saveSubtitlesFor(record);
  return record;
}

/**
 * Stores the title's captions as WebVTT next to the video so offline playback keeps
 * subtitles. Best-effort: a caption failure must never affect the video download.
 */
async function saveSubtitlesFor(record: DownloadRecord): Promise<void> {
  if (!record.resourceId) return;

  const { downloadSubtitles, preferredSubtitle } = getConfig();
  if (downloadSubtitles === "none") return;

  try {
    const options = await catalog.subtitles(record.subjectId, record.resourceId);
    if (options.length === 0) return;

    // `preferred` keeps a single language: the configured one, else English, else the
    // first on offer — saving all sixteen is a lot of files nobody asked for.
    let wanted = options;
    if (downloadSubtitles === "preferred") {
      const target = preferredSubtitle.toLowerCase();
      const chosen =
        options.find(
          (option) =>
            option.lang.toLowerCase() === target || option.name.toLowerCase() === target,
        ) ??
        options.find((option) => option.lang.toLowerCase() === "en") ??
        options[0];
      wanted = chosen ? [chosen] : [];
    }

    const stem = path.join(
      path.dirname(record.savePath),
      path.basename(record.savePath, path.extname(record.savePath)),
    );

    const saved: DownloadRecord["subtitles"] = [];
    for (const [index, option] of wanted.entries()) {
      // The first track takes the video's exact basename, which is the filename external
      // players look for when auto-loading subtitles. The rest are language-suffixed.
      const destination = index === 0 ? `${stem}.srt` : `${stem}.${option.lang || option.name}.srt`;
      try {
        await saveSubtitleFile(option.url, destination);
        saved.push({
          name: option.name,
          nativeName: option.nativeName,
          lang: option.lang,
          path: destination,
        });
      } catch {
        // Skip just this language.
      }
    }

    const current = findRecord(record.id);
    if (current) broadcast(upsert({ ...current, subtitles: saved }));
  } catch {
    // No captions available, or the API is unreachable; the video still downloads.
  }
}

/** Freshens `fileExists` so entries deleted outside the app are shown as missing. */
export function listDownloads(): DownloadRecord[] {
  const records = getDownloadRecords().map((record) => ({
    ...record,
    fileExists: record.state === "completed" ? fs.existsSync(record.savePath) : record.fileExists,
  }));
  saveDownloadRecords(records);
  return records;
}

export function pauseDownload(id: string): boolean {
  const item = active.get(id);
  if (!item || item.isPaused()) return false;
  item.pause();
  return true;
}

export function resumeDownload(id: string): boolean {
  const item = active.get(id);
  if (!item || !item.canResume()) return false;
  item.resume();
  return true;
}

export function cancelDownload(id: string): boolean {
  const item = active.get(id);
  if (item) {
    item.cancel();
    active.delete(id);
    return true;
  }
  // Nothing in flight: mark the stored record so the UI stops showing it as running.
  const record = findRecord(id);
  if (!record) return false;
  broadcast(upsert({ ...record, state: "cancelled" }));
  return true;
}

/** Removes the record, and the file too when `deleteFile` is set. */
export function removeDownload(id: string, deleteFile: boolean): DownloadRecord[] {
  const item = active.get(id);
  if (item) {
    item.cancel();
    active.delete(id);
  }

  const record = findRecord(id);
  if (record && deleteFile && record.savePath) {
    for (const target of [record.savePath, ...(record.subtitles ?? []).map((s) => s.path)]) {
      try {
        fs.rmSync(target, { force: true });
      } catch {
        // A locked or already-removed file should not block dropping the record.
      }
    }
  }

  const remaining = getDownloadRecords().filter((entry) => entry.id !== id);
  saveDownloadRecords(remaining);
  return remaining;
}

export function clearFinishedDownloads(): DownloadRecord[] {
  const remaining = getDownloadRecords().filter(
    (record) => record.state === "progressing" || record.state === "paused",
  );
  saveDownloadRecords(remaining);
  return remaining;
}

/** Hands the file to the OS default player. Returns the error string, or "" on success. */
export async function openDownload(id: string): Promise<string> {
  const record = findRecord(id);
  if (!record) return "That download is no longer listed.";
  if (!fs.existsSync(record.savePath)) return "The file is no longer on disk.";
  return shell.openPath(record.savePath);
}

export function revealDownload(id: string): boolean {
  const record = findRecord(id);
  if (!record || !fs.existsSync(record.savePath)) return false;
  shell.showItemInFolder(record.savePath);
  return true;
}
