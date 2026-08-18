import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  AppInfo,
  AudioVariant,
  CastDevice,
  CastRequest,
  CastSession,
  DownloadControlResult,
  DownloadQueueStatus,
  DownloadRecord,
  DownloadRequest,
  FavoriteItem,
  WatchLaterItem,
  FreeMediaItem,
  FreeMediaProvider,
  CatalogItem,
  Channel,
  ChannelProgramme,
  HomePage,
  HomeRow,
  MediaDetails,
  MediaType,
  PersonDetails,
  PreparedLiveStream,
  PlaylistSource,
  SeasonDownloadRequest,
  Release,
  Result,
  SubtitleOption,
  UpdateStatus,
  WatchHistoryItem,
  WatchAvailability,
  XtreamSource,
} from "@shared/types";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, ...args);

const api = {
  catalog: {
    homeSections: () => invoke<string[]>("catalog:homeSections"),
    homeSection: (index: number) => invoke<HomeRow>("catalog:homeSection", index),
    anime: (page = 1) => invoke<CatalogItem[]>("catalog:anime", page),
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
    subtitles: (
      subjectId: string,
      resourceId: string,
      title?: string,
      year?: string,
      season?: number,
      episode?: number,
    ) => invoke<SubtitleOption[]>("catalog:subtitles", subjectId, resourceId, title, year, season, episode),
    searchOnlineSubtitles: (params: {
      title: string;
      year?: string;
      imdbId?: string;
      season?: number;
      episode?: number;
      languages?: string[];
    }) => invoke<SubtitleOption[]>("catalog:searchOnlineSubtitles", params),
    clearCache: () => invoke<boolean>("catalog:clearCache"),
  },
  subtitle: {
    load: (url: string) => invoke<string>("subtitle:load", url),
  },
  tv: {
    playlist: (source: PlaylistSource, forceRefresh = false) =>
      invoke<Channel[]>("tv:playlist", source, forceRefresh),
    epg: (url: string, channelIds: string[]) =>
      invoke<Record<string, ChannelProgramme[]>>("tv:epg", url, channelIds),
    xtream: (source: XtreamSource) => invoke<Channel[]>("tv:xtream", source),
    xtreamEpg: (source: XtreamSource, channelIds: string[]) =>
      invoke<Record<string, ChannelProgramme[]>>("tv:xtreamEpg", source, channelIds),
  },
  freeMedia: {
    browse: (provider: FreeMediaProvider, page = 1) =>
      invoke<FreeMediaItem[]>("free:browse", provider, page),
    search: (provider: FreeMediaProvider, query: string, page = 1) =>
      invoke<FreeMediaItem[]>("free:search", provider, query, page),
    details: (provider: FreeMediaProvider, id: string) =>
      invoke<FreeMediaItem>("free:details", provider, id),
  },
  availability: {
    title: (title: string, mediaType: MediaType) =>
      invoke<WatchAvailability>("availability:title", title, mediaType),
  },
  media: {
    prepareLive: (url: string, startAt = 0, resolution = 0) =>
      invoke<PreparedLiveStream>("media:prepareLive", url, startAt, resolution),
    preview: (url: string, position: number, resolution = 0) =>
      invoke<string | null>("media:preview", url, position, resolution),
    /** Stores a rewritten DASH manifest and returns a URL dash.js can load. */
    stageManifest: (xml: string) => invoke<string>("media:stageManifest", xml),
    /** Reports the codecs this renderer can decode, so main can skip transcoding. */
    reportDecodable: (codecs: string[]) => invoke<boolean>("media:decodable", codecs),
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
  favorites: {
    list: () => invoke<FavoriteItem[]>("favorites:list"),
    toggle: (item: CatalogItem) => invoke<FavoriteItem[]>("favorites:toggle", item),
  },
  watchLater: {
    list: () => invoke<WatchLaterItem[]>("watchLater:list"),
    toggle: (item: CatalogItem) => invoke<WatchLaterItem[]>("watchLater:toggle", item),
    clear: () => invoke<WatchLaterItem[]>("watchLater:clear"),
  },
  downloads: {
    start: (request: DownloadRequest) => invoke<DownloadRecord>("download:start", request),
    /** Queues a whole season; resolves with the number of episodes queued. */
    startSeason: (request: SeasonDownloadRequest) =>
      invoke<number>("download:startSeason", request),
    /** Drops queued season episodes; the one in flight keeps going. */
    clearQueue: () => invoke<number>("download:clearQueue"),
    queueSize: () => invoke<number>("download:queueSize"),
    queueStatus: () => invoke<DownloadQueueStatus>("download:queueStatus"),
    pauseQueue: () => invoke<boolean>("download:pauseQueue"),
    resumeQueue: () => invoke<boolean>("download:resumeQueue"),
    removeQueued: (id: string) => invoke<boolean>("download:removeQueued", id),
    list: () => invoke<DownloadRecord[]>("download:list"),
    pause: (id: string) => invoke<DownloadControlResult>("download:pause", id),
    resume: (id: string) => invoke<DownloadControlResult>("download:resume", id),
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
    // Cast lives beside updates: both are long-running main-process concerns the UI observes.
    status: () => invoke<UpdateStatus>("update:status"),
    check: () => invoke<UpdateStatus>("update:check"),
    download: () => invoke<boolean>("update:download"),
    pause: () => invoke<boolean>("update:pause"),
    decline: () => invoke<boolean>("update:decline"),
    install: () => invoke<boolean>("update:install"),
    onStatus: (listener: (status: UpdateStatus) => void) => {
      const wrapped = (_event: unknown, status: UpdateStatus) => listener(status);
      ipcRenderer.on("update:status", wrapped);
      return () => {
        ipcRenderer.removeListener("update:status", wrapped);
      };
    },
  },
  cast: {
    /** Sweeps the network for Chromecast receivers and DLNA renderers. Takes a few seconds. */
    discover: () => invoke<CastDevice[]>("cast:discover"),
    start: (request: CastRequest) => invoke<CastSession>("cast:start", request),
    play: () => invoke<boolean>("cast:play"),
    pause: () => invoke<boolean>("cast:pause"),
    seek: (seconds: number) => invoke<boolean>("cast:seek", seconds),
    setVolume: (level: number) => invoke<boolean>("cast:volume", level),
    stop: () => invoke<boolean>("cast:stop"),
    session: () => invoke<CastSession | null>("cast:session"),
    onSession: (listener: (session: CastSession | null) => void) => {
      const wrapped = (_event: unknown, session: CastSession | null) => listener(session);
      ipcRenderer.on("cast:session", wrapped);
      return () => {
        ipcRenderer.removeListener("cast:session", wrapped);
      };
    },
  },
  system: {
    openExternal: (url: string) => invoke<void>("shell:openExternal", url),
    setFullScreen: (value: boolean) => invoke<boolean>("window:toggleFullScreen", value),
    pickPlaylistFile: () => invoke<string | null>("dialog:pickPlaylistFile"),
    pickDirectory: (title?: string) => invoke<string | null>("dialog:pickDirectory", title),
    restart: () => invoke<boolean>("app:restart"),
  },
  discord: {
    setActivity: (params: {
      details: string;
      state?: string;
      startTimestamp?: number;
      endTimestamp?: number;
      largeImageKey?: string;
      largeImageText?: string;
    }) => invoke<void>("discord:setActivity", params),
    clearActivity: () => invoke<void>("discord:clearActivity"),
  },
};

export type InfinityPlayApi = typeof api;

contextBridge.exposeInMainWorld("infinityplay", api);
