import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  AppInfo,
  AudioVariant,
  DownloadRecord,
  DownloadRequest,
  CatalogItem,
  Channel,
  HomePage,
  MediaDetails,
  MediaType,
  PersonDetails,
  PreparedLiveStream,
  Release,
  Result,
  SubtitleOption,
  UpdateStatus,
  WatchHistoryItem,
} from "@shared/types";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, ...args);

const api = {
  catalog: {
    home: () => invoke<HomePage>("catalog:home"),
    featured: (tabId = "0", page = 1) => invoke<HomePage>("catalog:featured", tabId, page),
    search: (query: string, page = 1) => invoke<CatalogItem[]>("catalog:search", query, page),
    suggest: (query: string) => invoke<CatalogItem[]>("catalog:suggest", query),
    details: (subjectId: string) => invoke<MediaDetails>("catalog:details", subjectId),
    person: (staffId: string, name: string, avatarUrl: string | null) =>
      invoke<PersonDetails>("catalog:person", staffId, name, avatarUrl),
    audioVariants: (title: string, mediaType: MediaType) =>
      invoke<AudioVariant[]>("catalog:audioVariants", title, mediaType),
    releases: (subjectId: string, season = 0, episode = 0) =>
      invoke<Release[]>("catalog:releases", subjectId, season, episode),
    subtitles: (subjectId: string, resourceId: string) =>
      invoke<SubtitleOption[]>("catalog:subtitles", subjectId, resourceId),
    clearCache: () => invoke<boolean>("catalog:clearCache"),
  },
  subtitle: {
    load: (url: string) => invoke<string>("subtitle:load", url),
  },
  tv: {
    playlist: (url: string, forceRefresh = false) =>
      invoke<Channel[]>("tv:playlist", url, forceRefresh),
  },
  media: {
    prepareLive: (url: string, startAt = 0, resolution = 0) =>
      invoke<PreparedLiveStream>("media:prepareLive", url, startAt, resolution),
    preview: (url: string, position: number, resolution = 0) =>
      invoke<string | null>("media:preview", url, position, resolution),
  },
  config: {
    get: () => invoke<AppConfig>("config:get"),
    update: (patch: Partial<AppConfig>) => invoke<AppConfig>("config:update", patch),
  },
  history: {
    list: () => invoke<WatchHistoryItem[]>("history:list"),
    record: (item: WatchHistoryItem) => invoke<WatchHistoryItem[]>("history:record", item),
    remove: (subjectId: string) => invoke<WatchHistoryItem[]>("history:remove", subjectId),
    clear: () => invoke<WatchHistoryItem[]>("history:clear"),
  },
  downloads: {
    start: (request: DownloadRequest) => invoke<DownloadRecord>("download:start", request),
    list: () => invoke<DownloadRecord[]>("download:list"),
    pause: (id: string) => invoke<boolean>("download:pause", id),
    resume: (id: string) => invoke<boolean>("download:resume", id),
    cancel: (id: string) => invoke<boolean>("download:cancel", id),
    remove: (id: string, deleteFile: boolean) =>
      invoke<DownloadRecord[]>("download:remove", id, deleteFile),
    clearFinished: () => invoke<DownloadRecord[]>("download:clearFinished"),
    open: (id: string) => invoke<string>("download:open", id),
    reveal: (id: string) => invoke<boolean>("download:reveal", id),
    onProgress: (listener: (record: DownloadRecord) => void) => {
      const wrapped = (_event: unknown, record: DownloadRecord) => listener(record);
      ipcRenderer.on("download:progress", wrapped);
      return () => {
        ipcRenderer.removeListener("download:progress", wrapped);
      };
    },
  },
  app: {
    info: () => invoke<AppInfo>("app:info"),
  },
  updates: {
    status: () => invoke<UpdateStatus>("update:status"),
    check: () => invoke<UpdateStatus>("update:check"),
    install: () => invoke<boolean>("update:install"),
    onStatus: (listener: (status: UpdateStatus) => void) => {
      const wrapped = (_event: unknown, status: UpdateStatus) => listener(status);
      ipcRenderer.on("update:status", wrapped);
      return () => {
        ipcRenderer.removeListener("update:status", wrapped);
      };
    },
  },
  system: {
    openExternal: (url: string) => invoke<void>("shell:openExternal", url),
    setFullScreen: (value: boolean) => invoke<boolean>("window:toggleFullScreen", value),
    pickPlaylistFile: () => invoke<string | null>("dialog:pickPlaylistFile"),
    restart: () => invoke<boolean>("app:restart"),
  },
};

export type InfinityPlayApi = typeof api;

contextBridge.exposeInMainWorld("infinityplay", api);
