import { Preferences } from "@capacitor/preferences";
import { Browser } from "@capacitor/browser";
import { Filesystem, Directory } from "@capacitor/filesystem";
import type {
  AppConfig,
  AppInfo,
  AudioVariant,
  CatalogItem,
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
};

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

function notifyDownloadProgress(record: DownloadRecord) {
  for (const listener of downloadListeners) {
    try {
      listener(record);
    } catch {
      // Listener error
    }
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
    downloads: {
      start: (request: DownloadRequest) =>
        wrapResult(async () => {
          const downloads = await getStoredDownloads();
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const record: DownloadRecord = {
            ...request,
            id,
            filename: `${request.title}.mp4`,
            savePath: request.url,
            fileUrl: request.url,
            receivedBytes: 0,
            totalBytes: 100,
            state: "completed",
            startedAt: Date.now(),
            completedAt: Date.now(),
            fileExists: true,
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
      list: () => wrapResult(() => getStoredDownloads()),
      pause: () => wrapResult(async () => false),
      resume: () => wrapResult(async () => false),
      cancel: (id: string) =>
        wrapResult(async () => {
          const downloads = await getStoredDownloads();
          const remaining = downloads.filter((d) => d.id !== id);
          await saveStoredDownloads(remaining);
          return true;
        }),
      remove: (id: string) =>
        wrapResult(async () => {
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
          const downloads = await getStoredDownloads();
          const item = downloads.find((d) => d.id === id);
          if (item?.fileUrl) {
            await Browser.open({ url: item.fileUrl });
            return "";
          }
          return "File not found";
        }),
      reveal: () => wrapResult(async () => false),
      onProgress: (listener: (record: DownloadRecord) => void) => {
        downloadListeners.add(listener);
        return () => {
          downloadListeners.delete(listener);
        };
      },
    },
    app: {
      info: () =>
        wrapResult(async (): Promise<AppInfo> => ({
          name: "InfinityPlay",
          version: "0.2.1",
          electron: "N/A (Capacitor/Android)",
          chrome: navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? "WebView",
          node: "N/A",
          platform: "Android",
          packageType: "Android APK / App Bundle",
          updatable: false,
          ffmpeg: false,
          ffmpegVersion: "",
          gpu: "Android Mobile GPU",
        })),
    },
    updates: {
      status: () => wrapResult(async () => ({ state: "up-to-date", version: "0.2.1" })),
      check: () => wrapResult(async () => ({ state: "up-to-date", version: "0.2.1" })),
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
