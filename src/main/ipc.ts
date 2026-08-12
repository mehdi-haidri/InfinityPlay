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
  MediaType,
  Result,
  WatchHistoryItem,
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
  listDownloads,
  openDownload,
  pauseDownload,
  removeDownload,
  resumeDownload,
  revealDownload,
  startDownload,
} from "./downloads";
import {
  checkForUpdates,
  getUpdateStatus,
  installUpdate,
  isAutoUpdateSupported,
} from "./updater";

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

  handle("config:get", () => getConfig());
  handle("config:update", (patch: Partial<AppConfig>) => updateConfig(patch));

  handle("history:list", () => getHistory());
  handle("history:record", (item: WatchHistoryItem) => recordHistory(item));
  handle("history:remove", (subjectId: string) => removeHistory(subjectId));
  handle("history:clear", () => clearHistory());

  handle("download:start", (request: DownloadRequest) => startDownload(request));
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

  handle("app:info", (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    packageType: packageType(),
    updatable: isAutoUpdateSupported(),
  }));

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
