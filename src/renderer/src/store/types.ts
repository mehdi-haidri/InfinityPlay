import type {
  AppConfig,
  CatalogItem,
  Channel,
  DownloadRecord,
  DownloadRequest,
  Episode,
  FavoriteItem,
  WatchLaterItem,
  Release,
  SubtitleOption,
  WatchHistoryItem,
} from "@shared/types";

export type Route =
  | { name: "home" }
  | { name: "search"; query: string }
  | { name: "details"; id: string; season?: number; episode?: number; audioLocked?: boolean }
  | { name: "person"; id: string; personName: string; avatarUrl: string | null }
  | { name: "livetv" }
  | { name: "anime" }
  | { name: "free-library" }
  | { name: "history" }
  | { name: "favorites" }
  | { name: "watch-later" }
  | { name: "settings" }
  | { name: "downloads" }
  | { name: "more" }
  | { name: "about" };

export interface PlayerRequest {
  title: string;
  subtitleLine: string;
  url: string;
  live: boolean;
  posterUrl: string | null;
  subjectId?: string;
  resourceId?: string;
  season?: number;
  episode?: number;
  mediaType?: "movie" | "series";
  year?: string;
  startAt?: number;
  resolution?: number;
  releases?: Release[];
  subtitles?: SubtitleOption[];
  episodeSequence?: Pick<Episode, "season" | "number">[];
  initialSubtitle?: string;
  headers?: Record<string, string>;
}

export interface ToastAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "progress";
  title: string;
  body?: string;
  downloadId?: string;
  sticky?: boolean;
  actions?: ToastAction[];
  tag?: string;
}

export interface AppBackupData {
  version: string;
  exportedAt: string;
  config: AppConfig;
  favorites: FavoriteItem[];
  watchLater: WatchLaterItem[];
  watchHistory: WatchHistoryItem[];
}

export interface NavigationSlice {
  route: Route;
  history: Route[];
  future: Route[];
  navigate: (route: Route, replace?: boolean) => void;
  goBack: () => void;
  goForward: () => void;
}

export interface ConfigSlice {
  config: AppConfig;
  ffmpeg: boolean;
  loadCapabilities: () => Promise<void>;
  loadConfig: () => Promise<void>;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;
}

export interface HistorySlice {
  watchHistory: WatchHistoryItem[];
  loadWatchHistory: () => Promise<void>;
  saveProgress: (entry: WatchHistoryItem) => Promise<void>;
  forgetTitle: (subjectId: string) => Promise<void>;
  clearWatchHistory: () => Promise<void>;
}

export interface FavoritesSlice {
  favorites: FavoriteItem[];
  loadFavorites: () => Promise<void>;
  watchLater: WatchLaterItem[];
  loadWatchLater: () => Promise<void>;
  toggleWatchLater: (item: CatalogItem) => Promise<void>;
  clearWatchLater: () => Promise<void>;
  toggleFavorite: (item: CatalogItem) => Promise<void>;
}

export interface PlayerSlice {
  player: PlayerRequest | null;
  openPlayer: (request: PlayerRequest) => void;
  closePlayer: () => void;
  channels: Channel[];
  setChannels: (channels: Channel[]) => void;
}

export interface DownloadSlice {
  downloads: DownloadRecord[];
  loadDownloads: () => Promise<void>;
  watchDownloads: () => () => void;
  beginDownload: (request: DownloadRequest) => Promise<void>;
  removeDownload: (id: string, deleteFile: boolean) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
}

export interface ToastSlice {
  toasts: Toast[];
  notify: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
}

export interface BackupSlice {
  exportUserData: () => AppBackupData;
  importUserData: (data: AppBackupData) => Promise<boolean>;
}

export type AppState = NavigationSlice &
  ConfigSlice &
  HistorySlice &
  FavoritesSlice &
  PlayerSlice &
  DownloadSlice &
  ToastSlice &
  BackupSlice;
