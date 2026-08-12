/**
 * The single IPC surface. Every provider call runs here in the main process, which is
 * what lets the requests carry `user-agent` / `x-forwarded-for` and sidesteps CORS.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AppConfig,
  AppInfo,
  DownloadRequest,
  SeasonDownloadRequest,
  MediaType,
  Result,
  WatchHistoryItem,
  PreparedLiveStream,
} from "@shared/types";
import { MovieBoxService } from "./providers/moviebox";
import { fetchPlaylist } from "./providers/m3u";
import { fetchSubtitleAsVttDataUrl } from "./providers/subtitles";
import {
  clearHistory,
  getConfig,
  getHistory,
  recordHistory,
  removeHistory,
  updateConfig,
} from "./store";
import {
  cancelDownload,
  clearFinishedDownloads,
  clearSeasonQueue,
  pendingSeasonCount,
  listDownloads,
  openDownload,
  pauseDownload,
  removeDownload,
  resumeDownload,
  revealDownload,
  startDownload,
  startSeasonDownload,
} from "./downloads";
import {
  checkForUpdates,
  getUpdateStatus,
  installUpdate,
  isAutoUpdateSupported,
} from "./updater";
import { generateMediaPreview, prepareLiveStream, setDecodableCodecs, stageManifest } from "./live";
import { toolAvailable } from "./media-tools";

const moviebox = new MovieBoxService();

function packageType(): string {
  if (!app.isPackaged) return "development";
  if (process.platform === "darwin") return "macOS DMG (unsigned)";
  if (process.platform === "win32") return "Windows NSIS";
  if (process.env.APPIMAGE) return "AppImage";

  const marker = join(process.resourcesPath, "package-type");
  if (existsSync(marker)) return readFileSync(marker, "utf8").trim() || "Linux package";
  return "DEB/RPM package";
}

/** Wraps a handler so the renderer always receives a Result instead of a rejected promise. */
function handle<A extends unknown[], R>(
  channel: string,
  handler: (...args: A) => Promise<R> | R,
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...(args as A)) } satisfies Result<R>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message } satisfies Result<R>;
    }
  });
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  handle("catalog:home", () => moviebox.home());
  handle("catalog:featured", (tabId: string, page: number) =>
    moviebox.featured(tabId ?? "0", page ?? 1),
  );
  handle("catalog:search", (query: string, page: number) => moviebox.search(query, page ?? 1));
  handle("catalog:suggest", (query: string) => moviebox.suggest(query));
  handle("catalog:details", (subjectId: string) => moviebox.details(subjectId));
  handle("catalog:person", (staffId: string, name: string, avatarUrl: string | null) =>
    moviebox.person(staffId, name, avatarUrl),
  );
  handle("catalog:audioVariants", (title: string, mediaType: MediaType) =>
    moviebox.audioVariants(title, mediaType),
  );
  handle("catalog:releases", (subjectId: string, season: number, episode: number) =>
    moviebox.releases(subjectId, season ?? 0, episode ?? 0),
  );
  handle("catalog:subtitles", (subjectId: string, resourceId: string) =>
    moviebox.subtitles(subjectId, resourceId),
  );
  handle("catalog:clearCache", () => {
    moviebox.clearCache();
    return true;
  });

  handle("subtitle:load", (url: string) => fetchSubtitleAsVttDataUrl(url));

  handle("tv:playlist", (url: string, forceRefresh: boolean) =>
    fetchPlaylist(url, forceRefresh ?? false),
  );
  handle("media:prepareLive", (url: string, startAt: number, resolution: number): Promise<PreparedLiveStream> =>
    prepareLiveStream(url, startAt, resolution),
  );
  handle("media:preview", (url: string, position: number, resolution: number) =>
    generateMediaPreview(url, position, resolution),
  );

  handle("config:get", () => getConfig());
  handle("config:update", (patch: Partial<AppConfig>) => updateConfig(patch));

  handle("history:list", () => getHistory());
  handle("history:record", (item: WatchHistoryItem) => recordHistory(item));
  handle("history:remove", (subjectId: string) => removeHistory(subjectId));
  handle("history:clear", () => clearHistory());

  handle("download:start", (request: DownloadRequest) => startDownload(request));
  handle("download:startSeason", (request: SeasonDownloadRequest) =>
    startSeasonDownload(request),
  );
  handle("download:clearQueue", () => clearSeasonQueue());
  handle("download:queueSize", () => pendingSeasonCount());
  // The renderer is the only place that knows what Chromium will decode here.
  handle("media:stageManifest", (xml: string) => stageManifest(xml));

  handle("media:decodable", (codecs: string[]) => {
    setDecodableCodecs(Array.isArray(codecs) ? codecs : []);
    return true;
  });

  handle("download:list", () => listDownloads());
  handle("download:pause", (id: string) => pauseDownload(id));
  handle("download:resume", (id: string) => resumeDownload(id));
  handle("download:cancel", (id: string) => cancelDownload(id));
  handle("download:remove", (id: string, deleteFile: boolean) =>
    removeDownload(id, Boolean(deleteFile)),
  );
  handle("download:clearFinished", () => clearFinishedDownloads());
  handle("download:open", (id: string) => openDownload(id));
  handle("download:reveal", (id: string) => revealDownload(id));

  handle("app:info", async (): Promise<AppInfo> => {
    const gpuInfo = await app.getGPUInfo("basic").catch(() => null) as {
      gpuDevice?: { vendorId?: number }[];
    } | null;
    const vendorId = Number(gpuInfo?.gpuDevice?.[0]?.vendorId ?? 0);
    const vendor = vendorId === 0x10de
      ? "NVIDIA"
      : vendorId === 0x1002 || vendorId === 0x1022
        ? "AMD"
        : vendorId === 0x8086
          ? "Intel"
          : vendorId
            ? `GPU vendor 0x${vendorId.toString(16)}`
            : "GPU not detected";
    const decode = app.getGPUFeatureStatus().video_decode;
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform}-${process.arch}`,
      packageType: packageType(),
      ffmpeg: toolAvailable("ffmpeg"),
      updatable: isAutoUpdateSupported(),
      gpu: `${vendor} · video decode ${decode}`,
    };
  });

  handle("update:status", () => getUpdateStatus());
  handle("update:check", () => checkForUpdates());
  handle("update:install", () => installUpdate());

  handle("shell:openExternal", (url: string) => shell.openExternal(url));

  handle("window:toggleFullScreen", (value: boolean) => {
    const window = getWindow();
    if (!window) return false;
    window.setFullScreen(value);
    return window.isFullScreen();
  });

  handle("app:restart", () => {
    app.relaunch();
    app.quit();
    return true;
  });

  handle("dialog:pickPlaylistFile", async () => {
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: "Add an M3U playlist",
      filters: [{ name: "Playlists", extensions: ["m3u", "m3u8"] }],
      properties: ["openFile"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
