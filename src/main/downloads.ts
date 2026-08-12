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
import { spawn, type ChildProcess } from "node:child_process";
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
const activeAdaptive = new Map<string, ChildProcess>();

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
    extension = request.sourceKind === "dash"
      ? ".mp4"
      : path.extname(new URL(request.url).pathname) || ".mp4";
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

  upsert(record);
  if (request.sourceKind === "dash" || /\.mpd(?:$|\?)/i.test(request.url)) {
    void prepareAdaptiveDownload(record);
  } else {
    awaitingItem.set(request.url, record);
    window.webContents.downloadURL(request.url);
  }
  void saveSubtitlesFor(record);
  return record;
}

/**
 * Saves one representation from a DASH manifest as a normal MP4. This is intentionally
 * stream-copy rather than a transcode: selecting 720p preserves that exact source and
 * avoids turning a download into a long CPU/GPU encoding job.
 */
async function prepareAdaptiveDownload(
  record: DownloadRecord,
): Promise<void> {
  const manifestPath = `${record.savePath}.mpd.part`;
  try {
    const response = await fetch(record.url, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Manifest request failed with HTTP ${response.status}.`);
    const original = await response.text();
    const representationPattern = /<Representation\b[\s\S]*?<\/Representation>/g;
    let found = false;
    const filtered = original.replace(representationPattern, (block) => {
      const height = Number(block.match(/\bheight="(\d+)"/)?.[1] ?? 0);
      if (height === 0) return block; // audio
      if (height === record.resolution) {
        found = true;
        return block;
      }
      return "";
    });
    if (!found) throw new Error(`The manifest does not contain a ${record.resolution}p video stream.`);

    const sourceUrl = new URL(record.url);
    const baseUrl = `${sourceUrl.origin}${sourceUrl.pathname.replace(/[^/]+$/, "")}`;
    // Resolving a relative DASH segment drops the manifest query, so put the CloudFront
    // signature directly on every segment template just as the browser signer does.
    const signedQuery = sourceUrl.search.slice(1).replace(/&/g, "&amp;");
    const signedManifest = signedQuery
      ? filtered.replace(
          /\b(initialization|media)="([^"]+)"/g,
          (_match, name: string, value: string) => `${name}="${value}?${signedQuery}"`,
        )
      : filtered;
    const localManifest = signedManifest.replace(
      /(<Period\b[^>]*>)/,
      `$1\n<BaseURL>${baseUrl}</BaseURL>`,
    );
    fs.writeFileSync(manifestPath, localManifest, "utf8");
    startAdaptiveDownload(record, manifestPath);
  } catch (error) {
    finishAdaptiveDownload(
      record,
      `${record.savePath}.part`,
      manifestPath,
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function startAdaptiveDownload(
  record: DownloadRecord,
  manifestPath: string,
): void {
  const partPath = `${record.savePath}.part`;
  const args = ["-hide_banner", "-loglevel", "error", "-progress", "pipe:2", "-nostats", "-y"];
  args.push(
    "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
    "-i", manifestPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-c", "copy",
    "-movflags", "+faststart",
    "-f", "mp4",
    partPath,
  );

  const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  activeAdaptive.set(record.id, child);
  const errors: Buffer[] = [];
  let settled = false;
  child.stderr?.on("data", (chunk: Buffer) => {
    errors.push(chunk);
    if (errors.length > 20) errors.shift();
    try {
      const size = fs.statSync(partPath).size;
      const current = findRecord(record.id);
      if (current) broadcast(upsert({ ...current, receivedBytes: size, state: "progressing" }));
    } catch {
      // The muxer has not created the file yet.
    }
  });
  child.once("error", (error) => {
    if (settled) return;
    settled = true;
    finishAdaptiveDownload(record, partPath, manifestPath, false, error.message);
  });
  child.once("close", (code, signal) => {
    if (settled) return;
    settled = true;
    activeAdaptive.delete(record.id);
    if (signal) return;
    const message = Buffer.concat(errors).toString("utf8").trim().split("\n").at(-1);
    finishAdaptiveDownload(record, partPath, manifestPath, code === 0, message);
  });
}

function finishAdaptiveDownload(
  record: DownloadRecord,
  partPath: string,
  manifestPath: string,
  succeeded: boolean,
  error?: string,
): void {
  activeAdaptive.delete(record.id);
  try { fs.rmSync(manifestPath, { force: true }); } catch { /* ignored */ }
  const current = findRecord(record.id) ?? record;
  if (succeeded) {
    try {
      fs.renameSync(partPath, record.savePath);
      const size = fs.statSync(record.savePath).size;
      broadcast(upsert({
        ...current,
        receivedBytes: size,
        totalBytes: size,
        state: "completed",
        completedAt: Date.now(),
        fileExists: true,
        failureReason: undefined,
      }));
      return;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  try { fs.rmSync(partPath, { force: true }); } catch { /* ignored */ }
  broadcast(upsert({
    ...current,
    state: "interrupted",
    fileExists: false,
    failureReason: error || `The ${record.resolution}p adaptive stream could not be saved.`,
  }));
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
  const adaptive = activeAdaptive.get(id);
  if (adaptive?.pid) {
    if (process.platform === "win32") return false;
    try { adaptive.kill("SIGSTOP"); } catch { return false; }
    const record = findRecord(id);
    if (record) broadcast(upsert({ ...record, state: "paused" }));
    return true;
  }
  const item = active.get(id);
  if (!item || item.isPaused()) return false;
  item.pause();
  return true;
}

export function resumeDownload(id: string): boolean {
  const adaptive = activeAdaptive.get(id);
  if (adaptive?.pid) {
    if (process.platform === "win32") return false;
    try { adaptive.kill("SIGCONT"); } catch { return false; }
    const record = findRecord(id);
    if (record) broadcast(upsert({ ...record, state: "progressing" }));
    return true;
  }
  const item = active.get(id);
  if (!item || !item.canResume()) return false;
  item.resume();
  return true;
}

export function cancelDownload(id: string): boolean {
  const adaptive = activeAdaptive.get(id);
  if (adaptive) {
    adaptive.kill("SIGKILL");
    activeAdaptive.delete(id);
    const record = findRecord(id);
    if (record) {
      try { fs.rmSync(`${record.savePath}.part`, { force: true }); } catch { /* ignored */ }
      try { fs.rmSync(`${record.savePath}.mpd.part`, { force: true }); } catch { /* ignored */ }
      broadcast(upsert({ ...record, state: "cancelled" }));
    }
    return true;
  }
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
  const adaptive = activeAdaptive.get(id);
  if (adaptive) {
    adaptive.kill("SIGKILL");
    activeAdaptive.delete(id);
  }

  const record = findRecord(id);
  if (record && deleteFile && record.savePath) {
    for (const target of [record.savePath, `${record.savePath}.part`, `${record.savePath}.mpd.part`, ...(record.subtitles ?? []).map((s) => s.path)]) {
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
