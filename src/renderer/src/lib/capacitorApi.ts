import { Preferences } from "@capacitor/preferences";
import { Browser } from "@capacitor/browser";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { App as CapApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import type {
  AppConfig,
  AppInfo,
  AudioVariant,
  CatalogItem,
  FavoriteItem,
  Channel,
  DownloadRecord,
  DownloadRequest,
  HomePage,
  InfinityPlayApi,
  MediaDetails,
  MediaType,
  PersonDetails,
  PreparedLiveStream,
  Release,
  Result,
  SeasonDownloadRequest,
  SubtitleOption,
  UpdateStatus,
  WatchHistoryItem,
} from "@shared/types";
import { DEFAULT_CONFIG } from "@shared/types";
import { MovieBoxService } from "@/../../main/providers/moviebox";
import { fetchPlaylist } from "@/../../main/providers/m3u";
import { fetchSubtitleAsVttDataUrl } from "@/../../main/providers/subtitles";

const STORAGE_KEYS = {
  CONFIG: "infinityplay_config",
  HISTORY: "infinityplay_history",
  DOWNLOADS: "infinityplay_downloads",
  FAVORITES: "infinityplay_favorites",
};

interface NativeDownloadStatus {
  state: DownloadRecord["state"];
  receivedBytes: number;
  totalBytes: number;
  fileUrl: string;
  failureReason: string;
}

interface InfinityDownloadsPlugin {
  start(options: { url: string; title: string }): Promise<{ id: string }>;
  status(options: { id: string }): Promise<NativeDownloadStatus>;
  cancel(options: { id: string }): Promise<void>;
  open(options: { id: string }): Promise<void>;
}

const nativeDownloads = registerPlugin<InfinityDownloadsPlugin>("InfinityDownloads");

export interface NativePlayerResult {
  positionMs: number;
  durationMs: number;
  ended: boolean;
  error: string;
  cancelled: boolean;
}

interface InfinityPlayerPlugin {
  open(options: {
    url: string;
    title: string;
    positionMs: number;
    subtitlesJson: string;
  }): Promise<NativePlayerResult>;
}

/** Android Media3 bridge for on-demand Movies and Series. */
export const nativePlayer = registerPlugin<InfinityPlayerPlugin>("InfinityPlayer");

let cachedConfig: AppConfig | null = null;

async function getStoredConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEYS.CONFIG });
    if (value) {
      cachedConfig = { ...DEFAULT_CONFIG, ...JSON.parse(value) };
      return cachedConfig!;
    }
  } catch {
    // Fallback
  }
  cachedConfig = { ...DEFAULT_CONFIG };
  return cachedConfig;
}

function getSyncConfig(): AppConfig {
  return cachedConfig ?? DEFAULT_CONFIG;
}

async function saveStoredConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await getStoredConfig();
  cachedConfig = { ...current, ...patch };
  await Preferences.set({
    key: STORAGE_KEYS.CONFIG,
    value: JSON.stringify(cachedConfig),
  });
  return cachedConfig;
}

async function getStoredHistory(): Promise<WatchHistoryItem[]> {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEYS.HISTORY });
    if (value) return JSON.parse(value);
  } catch {
    // Fallback
  }
  return [];
}

async function saveStoredHistory(items: WatchHistoryItem[]): Promise<WatchHistoryItem[]> {
  await Preferences.set({
    key: STORAGE_KEYS.HISTORY,
    value: JSON.stringify(items),
  });
  return items;
}

async function getStoredFavorites(): Promise<FavoriteItem[]> {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEYS.FAVORITES });
    if (value) return JSON.parse(value);
  } catch {
    // Keep the catalog usable if preferences are temporarily unavailable.
  }
  return [];
}

async function saveStoredFavorites(items: FavoriteItem[]): Promise<FavoriteItem[]> {
  await Preferences.set({ key: STORAGE_KEYS.FAVORITES, value: JSON.stringify(items) });
  return items;
}

async function getStoredDownloads(): Promise<DownloadRecord[]> {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEYS.DOWNLOADS });
    if (value) return JSON.parse(value);
  } catch {
    // Fallback
  }
  return [];
}

async function saveStoredDownloads(records: DownloadRecord[]): Promise<DownloadRecord[]> {
  await Preferences.set({
    key: STORAGE_KEYS.DOWNLOADS,
    value: JSON.stringify(records),
  });
  return records;
}

const moviebox = new MovieBoxService(getSyncConfig);

const downloadListeners = new Set<(record: DownloadRecord) => void>();
let downloadPoll: number | undefined;

function notifyDownloadProgress(record: DownloadRecord) {
  for (const listener of downloadListeners) {
    try {
      listener(record);
    } catch {
      // Listener error
    }
  }
}

async function refreshNativeDownloads(): Promise<DownloadRecord[]> {
  const records = await getStoredDownloads();
  let anyChanged = false;
  const updated = await Promise.all(records.map(async (record) => {
    if (!["progressing", "paused"].includes(record.state)) return record;
    try {
      const status = await nativeDownloads.status({ id: record.id });
      const next: DownloadRecord = {
        ...record,
        ...status,
        completedAt: status.state === "completed" ? Date.now() : record.completedAt,
        fileExists: status.state === "completed",
      };
      if (JSON.stringify(next) !== JSON.stringify(record)) {
        anyChanged = true;
        notifyDownloadProgress(next);
      }
      return next;
    } catch {
      return record;
    }
  }));
  if (anyChanged) await saveStoredDownloads(updated);
  return updated;
}

function syncDownloadPoll() {
  if (downloadListeners.size > 0 && downloadPoll === undefined) {
    void refreshNativeDownloads();
    downloadPoll = window.setInterval(() => void refreshNativeDownloads(), 1500);
  } else if (downloadListeners.size === 0 && downloadPoll !== undefined) {
    window.clearInterval(downloadPoll);
    downloadPoll = undefined;
  }
}

const wrapResult = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};

export const createCapacitorApi = (): InfinityPlayApi => {
  // Pre-warm config
  void getStoredConfig();

  return {
    catalog: {
      home: () => wrapResult(() => moviebox.home()),
      featured: (tabId = "0", page = 1) => wrapResult(() => moviebox.featured(tabId, page)),
      search: (query: string, page = 1) => wrapResult(() => moviebox.search(query, page)),
      suggest: (query: string) => wrapResult(() => moviebox.suggest(query)),
      details: (subjectId: string) => wrapResult(() => moviebox.details(subjectId)),
      person: (staffId: string, name: string, avatarUrl: string | null) =>
        wrapResult(() => moviebox.person(staffId, name, avatarUrl)),
      audioVariants: (title: string, mediaType: MediaType) =>
        wrapResult(() => moviebox.audioVariants(title, mediaType)),
      releases: (subjectId: string, season = 0, episode = 0) =>
        wrapResult(() => moviebox.releases(subjectId, season, episode)),
      subtitles: (subjectId: string, resourceId: string) =>
        wrapResult(() => moviebox.subtitles(subjectId, resourceId)),
      clearCache: () =>
        wrapResult(async () => {
          moviebox.clearCache();
          return true;
        }),
    },
    subtitle: {
      load: (url: string) => wrapResult(() => fetchSubtitleAsVttDataUrl(url)),
    },
    tv: {
      playlist: (url: string, forceRefresh = false) =>
        wrapResult(() => fetchPlaylist(url, forceRefresh)),
    },
    media: {
      prepareLive: (url: string, startAt = 0, resolution = 0) =>
        wrapResult(async (): Promise<PreparedLiveStream> => {
          // Native WebView decodes HLS/DASH/MP4 directly
          return { url, transcoded: false };
        }),
      preview: () => wrapResult(async () => null),
      stageManifest: (xml: string) =>
        wrapResult(async () => {
          const blob = new Blob([xml], { type: "application/dash+xml" });
          return URL.createObjectURL(blob);
        }),
      reportDecodable: () => wrapResult(async () => true),
    },
    config: {
      get: () => wrapResult(() => getStoredConfig()),
      update: (patch: Partial<AppConfig>) => wrapResult(() => saveStoredConfig(patch)),
    },
    history: {
      list: () => wrapResult(() => getStoredHistory()),
      record: (item: WatchHistoryItem) =>
        wrapResult(async () => {
          const history = await getStoredHistory();
          const filtered = history.filter((h) => h.subjectId !== item.subjectId);
          filtered.unshift(item);
          return saveStoredHistory(filtered);
        }),
      remove: (subjectId: string) =>
        wrapResult(async () => {
          const history = await getStoredHistory();
          const filtered = history.filter((h) => h.subjectId !== subjectId);
          return saveStoredHistory(filtered);
        }),
      clear: () => wrapResult(() => saveStoredHistory([])),
    },
    favorites: {
      list: () => wrapResult(() => getStoredFavorites()),
      toggle: (item: CatalogItem) =>
        wrapResult(async () => {
          const favorites = await getStoredFavorites();
          const exists = favorites.some((entry) => entry.id === item.id);
          return saveStoredFavorites(
            exists
              ? favorites.filter((entry) => entry.id !== item.id)
              : [{ ...item, addedAt: Date.now() }, ...favorites],
          );
        }),
    },
    downloads: {
      start: (request: DownloadRequest) =>
        wrapResult(async () => {
          const downloads = await getStoredDownloads();
          const episodeSuffix = request.season > 0
            ? `-S${String(request.season).padStart(2, "0")}E${String(request.episode).padStart(2, "0")}`
            : "";
          const filename = `${request.title}${episodeSuffix}-${request.resolution || "auto"}p.mp4`;
          const { id } = await nativeDownloads.start({ url: request.url, title: filename });
          const record: DownloadRecord = {
            ...request,
            id,
            filename,
            savePath: "Android/InfinityPlay/Movies",
            fileUrl: "",
            receivedBytes: 0,
            totalBytes: 0,
            state: "progressing",
            startedAt: Date.now(),
            completedAt: null,
            fileExists: false,
            subtitles: [],
          };
          downloads.unshift(record);
          await saveStoredDownloads(downloads);
          notifyDownloadProgress(record);
          return record;
        }),
      startSeason: () => wrapResult(async () => 0),
      clearQueue: () => wrapResult(async () => 0),
      queueSize: () => wrapResult(async () => 0),
      list: () => wrapResult(() => refreshNativeDownloads()),
      pause: () => wrapResult(async () => false),
      resume: () => wrapResult(async () => false),
      cancel: (id: string) =>
        wrapResult(async () => {
          await nativeDownloads.cancel({ id });
          const downloads = await getStoredDownloads();
          const remaining = downloads.filter((d) => d.id !== id);
          await saveStoredDownloads(remaining);
          return true;
        }),
      remove: (id: string) =>
        wrapResult(async () => {
          await nativeDownloads.cancel({ id }).catch(() => undefined);
          const downloads = await getStoredDownloads();
          const remaining = downloads.filter((d) => d.id !== id);
          return saveStoredDownloads(remaining);
        }),
      clearFinished: () =>
        wrapResult(async () => {
          return saveStoredDownloads([]);
        }),
      open: (id: string) =>
        wrapResult(async () => {
          await nativeDownloads.open({ id });
          return "";
        }),
      reveal: () => wrapResult(async () => false),
      onProgress: (listener: (record: DownloadRecord) => void) => {
        downloadListeners.add(listener);
        syncDownloadPoll();
        return () => {
          downloadListeners.delete(listener);
          syncDownloadPoll();
        };
      },
    },
    app: {
      info: () =>
        wrapResult(async (): Promise<AppInfo> => {
          const nativeInfo = await CapApp.getInfo();
          return {
          name: nativeInfo.name || "InfinityPlay",
          version: nativeInfo.version,
          electron: "N/A (Capacitor/Android)",
          chrome: navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? "WebView",
          node: "N/A",
          platform: "Android",
          packageType: "Android APK / App Bundle",
          updatable: false,
          ffmpeg: false,
          ffmpegVersion: "",
          gpu: "Android Mobile GPU",
        };
        }),
    },
    updates: {
      status: () => wrapResult(async () => ({ state: "up-to-date", version: (await CapApp.getInfo()).version })),
      check: () => wrapResult(async () => ({ state: "up-to-date", version: (await CapApp.getInfo()).version })),
      install: () => wrapResult(async () => false),
      onStatus: () => () => {},
    },
    system: {
      openExternal: (url: string) =>
        wrapResult(async () => {
          await Browser.open({ url });
        }),
      setFullScreen: (value: boolean) =>
        wrapResult(async () => {
          if (value && document.documentElement.requestFullscreen) {
            void document.documentElement.requestFullscreen();
          } else if (document.exitFullscreen) {
            void document.exitFullscreen();
          }
          return value;
        }),
      pickPlaylistFile: () => wrapResult(async () => null),
      restart: () =>
        wrapResult(async () => {
          window.location.reload();
          return true;
        }),
    },
  };
};
