import { create } from "zustand";
import type {
  AppConfig,
  CatalogItem,
  Channel,
  DownloadRecord,
  DownloadRequest,
  FavoriteItem,
  Release,
  SubtitleOption,
  WatchHistoryItem,
} from "@shared/types";
import { DEFAULT_CONFIG } from "@shared/types";
import { api, unwrap } from "./lib/api";

export type Route =
  | { name: "home" }
  | { name: "search"; query: string }
  /**
   * `season`/`episode` are set when arriving from an audio switch, to keep the place.
   * `audioLocked` marks the track as the user's explicit choice, which stops the page
   * from bouncing straight back to the preferred language.
   */
  | { name: "details"; id: string; season?: number; episode?: number; audioLocked?: boolean }
  | { name: "person"; id: string; personName: string; avatarUrl: string | null }
  | { name: "livetv" }
  | { name: "free-library" }
  | { name: "history" }
  | { name: "favorites" }
  | { name: "settings" }
  | { name: "downloads" }
  /** Phone-only hub for the destinations that do not fit in the bottom bar. */
  | { name: "more" }
  | { name: "about" };

export interface PlayerRequest {
  title: string;
  subtitleLine: string;
  url: string;
  /** Live streams get HLS handling and no resume/history writes. */
  live: boolean;
  posterUrl: string | null;
  subjectId?: string;
  resourceId?: string;
  season?: number;
  episode?: number;
  mediaType?: "movie" | "series";
  year?: string;
  startAt?: number;
  /** Exact selected source height, needed when one DASH URL carries several qualities. */
  resolution?: number;
  releases?: Release[];
  subtitles?: SubtitleOption[];
  /** Episodes in the current season; lets the player advance when one ends. */
  episodeCount?: number;
  /** Subtitle to switch on at start; falls back to `config.preferredSubtitle`. */
  initialSubtitle?: string;
  /** HTTP headers required by protected IPTV manifests and their media segments. */
  headers?: Record<string, string>;
}

export interface ToastAction {
  label: string;
  /** Draws the filled treatment; use it for the action the toast is really asking for. */
  primary?: boolean;
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "progress";
  title: string;
  body?: string;
  /** Present on download toasts: the bar reads live progress from `downloads`. */
  downloadId?: string;
  /** Sticky toasts stay until the work finishes or the user dismisses them. */
  sticky?: boolean;
  /** Buttons rendered under the body. Choosing one dismisses the toast. */
  actions?: ToastAction[];
  /**
   * Identity across re-notifications. A second toast with the same tag replaces the first
   * instead of stacking — an update that changes state should not leave a trail of cards.
   */
  tag?: string;
}

interface AppState {
  route: Route;
  history: Route[];
  future: Route[];
  /** `replace` swaps the current entry instead of pushing, keeping Back meaningful. */
  navigate: (route: Route, replace?: boolean) => void;
  goBack: () => void;
  goForward: () => void;

  config: AppConfig;
  /**
   * FFmpeg on PATH. Adaptive (DASH) qualities are remuxed with it, so without it 720p and
   * 1080p cannot be saved. Assumed present until proven otherwise, so the UI does not
   * flash a warning during startup.
   */
  ffmpeg: boolean;
  loadCapabilities: () => Promise<void>;
  loadConfig: () => Promise<void>;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;

  watchHistory: WatchHistoryItem[];
  loadWatchHistory: () => Promise<void>;
  saveProgress: (entry: WatchHistoryItem) => Promise<void>;
  forgetTitle: (subjectId: string) => Promise<void>;
  clearWatchHistory: () => Promise<void>;

  favorites: FavoriteItem[];
  loadFavorites: () => Promise<void>;
  toggleFavorite: (item: CatalogItem) => Promise<void>;

  player: PlayerRequest | null;
  openPlayer: (request: PlayerRequest) => void;
  closePlayer: () => void;

  channels: Channel[];
  setChannels: (channels: Channel[]) => void;

  downloads: DownloadRecord[];
  loadDownloads: () => Promise<void>;
  watchDownloads: () => () => void;
  beginDownload: (request: DownloadRequest) => Promise<void>;
  removeDownload: (id: string, deleteFile: boolean) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;

  toasts: Toast[];
  notify: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  route: { name: "home" },
  history: [],
  future: [],

  navigate: (route, replace = false) => {
    const current = get().route;
    if (JSON.stringify(current) === JSON.stringify(route)) return;
    if (replace) {
      set({ route, future: [] });
      return;
    }
    set({ route, history: [...get().history, current], future: [] });
  },

  goBack: () => {
    const history = get().history;
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    set({
      route: previous,
      history: history.slice(0, -1),
      future: [get().route, ...get().future],
    });
  },

  goForward: () => {
    const future = get().future;
    if (future.length === 0) return;
    set({
      route: future[0],
      future: future.slice(1),
      history: [...get().history, get().route],
    });
  },

  config: DEFAULT_CONFIG,
  ffmpeg: true,

  loadCapabilities: async () => {
    // What Chromium will decode is only knowable here, and the main process needs it to
    // decide whether a file has to be transcoded. HEVC is the one that matters: it is the
    // catalog's usual codec, and support depends on the platform and GPU.
    try {
      const probe = document.createElement("video");
      const playable = (type: string) => probe.canPlayType(type) !== "";
      const decodable: string[] = [];
      if (
        playable('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
        playable('video/mp4; codecs="hev1.1.6.L93.B0"')
      ) {
        // ffprobe names the codec `hevc`; `h265` is accepted by some tools.
        decodable.push("hevc", "h265");
      }
      if (playable('video/mp4; codecs="av01.0.05M.08"')) decodable.push("av1");
      if (playable('video/webm; codecs="vp9"')) decodable.push("vp9");
      await unwrap(api.media.reportDecodable(decodable));
    } catch {
      // Main keeps its conservative defaults, which only costs an unnecessary transcode.
    }

    try {
      const info = await unwrap(api.app.info());
      set({ ffmpeg: info.ffmpeg });
    } catch {
      // Leave the optimistic default; a wrong "missing" warning is worse than none.
    }
  },

  loadConfig: async () => {
    try {
      const config = await unwrap(api.config.get());
      set({ config });
      document.documentElement.dataset.theme = config.theme;
      document.documentElement.dataset.reducedMotion = String(config.reducedMotion);
    } catch {
      // Fall back to the built-in defaults; the app stays usable without a config file.
    }
  },

  patchConfig: async (patch) => {
    // Optimistic: the UI reflects the change before the disk write settles.
    const next = { ...get().config, ...patch };
    set({ config: next });
    if (patch.theme) document.documentElement.dataset.theme = patch.theme;
    if (patch.reducedMotion !== undefined) {
      document.documentElement.dataset.reducedMotion = String(patch.reducedMotion);
    }
    try {
      set({ config: await unwrap(api.config.update(patch)) });
    } catch (error) {
      get().notify({
        kind: "error",
        title: "Could not save settings",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  },

  watchHistory: [],

  loadWatchHistory: async () => {
    try {
      set({ watchHistory: await unwrap(api.history.list()) });
    } catch {
      set({ watchHistory: [] });
    }
  },

  saveProgress: async (entry) => {
    try {
      // Metadata already known for this title is kept when a later save cannot supply it
      // — offline playback, for instance, knows less than the details page did.
      const known = get().watchHistory.find((item) => item.subjectId === entry.subjectId);
      const merged = {
        ...entry,
        year: entry.year || known?.year || "",
        posterUrl: entry.posterUrl ?? known?.posterUrl ?? null,
      };
      set({ watchHistory: await unwrap(api.history.record(merged)) });
    } catch {
      // Losing a progress write is not worth interrupting playback for.
    }
  },

  forgetTitle: async (subjectId) => {
    try {
      set({ watchHistory: await unwrap(api.history.remove(subjectId)) });
    } catch {
      /* ignored */
    }
  },

  clearWatchHistory: async () => {
    try {
      set({ watchHistory: await unwrap(api.history.clear()) });
    } catch {
      /* ignored */
    }
  },

  favorites: [],

  loadFavorites: async () => {
    try {
      set({ favorites: await unwrap(api.favorites.list()) });
    } catch {
      set({ favorites: [] });
    }
  },

  toggleFavorite: async (item) => {
    const previous = get().favorites;
    const exists = previous.some((entry) => entry.id === item.id);
    set({
      favorites: exists
        ? previous.filter((entry) => entry.id !== item.id)
        : [{ ...item, addedAt: Date.now() }, ...previous],
    });
    try {
      set({ favorites: await unwrap(api.favorites.toggle(item)) });
    } catch {
      set({ favorites: previous });
      get().notify({ kind: "error", title: "Could not update favorites" });
    }
  },

  player: null,
  openPlayer: (request) => set({ player: request }),
  closePlayer: () => set({ player: null }),

  channels: [],
  setChannels: (channels) => set({ channels }),

  downloads: [],

  loadDownloads: async () => {
    try {
      set({ downloads: await unwrap(api.downloads.list()) });
    } catch {
      set({ downloads: [] });
    }
  },

  /**
   * Streams progress from the main process into both the Downloads page and any open
   * toast. A finished download turns its toast into a short-lived success message.
   */
  watchDownloads: () =>
    api.downloads.onProgress((record) => {
      const downloads = get().downloads.some((entry) => entry.id === record.id)
        ? get().downloads.map((entry) => (entry.id === record.id ? record : entry))
        : [record, ...get().downloads];
      set({ downloads });

      const toast = get().toasts.find((entry) => entry.downloadId === record.id);
      if (!toast) return;

      if (record.state === "completed") {
        set({
          toasts: get().toasts.map((entry) =>
            entry.id === toast.id
              ? { ...entry, kind: "info", title: "Download complete", body: record.filename, sticky: false }
              : entry,
          ),
        });
        setTimeout(() => get().dismissToast(toast.id), 6000);
        return;
      }

      if (record.state === "cancelled" || record.state === "interrupted") {
        set({
          toasts: get().toasts.map((entry) =>
            entry.id === toast.id
              ? {
                  ...entry,
                  kind: "error",
                  title: record.state === "cancelled" ? "Download cancelled" : "Download interrupted",
                  // The reason is the useful part — "interrupted" alone leaves the user
                  // with no idea that, say, FFmpeg is missing.
                  body: record.failureReason ?? record.filename,
                  sticky: false,
                }
              : entry,
          ),
        });
        setTimeout(() => get().dismissToast(toast.id), 6000);
      }
    }),

  beginDownload: async (request) => {
    try {
      const record = await unwrap(api.downloads.start(request));
      set({ downloads: [record, ...get().downloads.filter((entry) => entry.id !== record.id)] });
      const id = ++toastSeq;
      set({
        toasts: [
          ...get().toasts,
          {
            id,
            kind: "progress",
            title: "Download started",
            body: record.filename,
            downloadId: record.id,
            sticky: true,
          },
        ],
      });
    } catch (error) {
      get().notify({
        kind: "error",
        title: "Download failed to start",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  },

  removeDownload: async (id, deleteFile) => {
    try {
      set({ downloads: await unwrap(api.downloads.remove(id, deleteFile)) });
    } catch (error) {
      get().notify({
        kind: "error",
        title: "Could not remove the download",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  },

  cancelDownload: async (id) => {
    try {
      await unwrap(api.downloads.cancel(id));
      await get().loadDownloads();
    } catch {
      /* the progress stream will correct the state */
    }
  },

  toasts: [],

  notify: (toast) => {
    const id = ++toastSeq;
    const existing = toast.tag
      ? get().toasts.filter((entry) => entry.tag !== toast.tag)
      : get().toasts;
    set({ toasts: [...existing, { ...toast, id }] });
    if (!toast.sticky) {
      setTimeout(() => get().dismissToast(id), toast.kind === "error" ? 6000 : 3500);
    }
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}));

/** Resume point for a title, or `undefined` when it was never started. */
export function findProgress(
  history: WatchHistoryItem[],
  subjectId: string,
  season = 0,
  episode = 0,
): WatchHistoryItem | undefined {
  return history.find(
    (entry) =>
      entry.subjectId === subjectId && entry.season === season && entry.episode === episode,
  );
}

export const toHistoryEntry = (
  item: CatalogItem,
  season: number,
  episode: number,
  position: number,
  duration: number,
): WatchHistoryItem => ({
  provider: "moviebox",
  subjectId: item.id,
  title: item.title,
  posterUrl: item.posterUrl,
  mediaType: item.mediaType,
  year: item.year,
  season,
  episode,
  position,
  duration,
  timestamp: Date.now(),
});
