/**
 * Shared model types, used by the main process, the preload bridge and the renderer.
 */

export type ProviderKind = "moviebox";

/** MovieBox `subjectType`: 1 = movie, 2 = series. */
export type MediaType = "movie" | "series";

/**
 * Audio track of a subject. MovieBox publishes each dub as its own subject with the
 * language bracketed in the title (`Stranger Things [Hindi]`); the API's own `language`
 * field describes the production, not the audio, so it cannot be used here.
 * `ORIGINAL_AUDIO` is the undubbed release.
 */
export const ORIGINAL_AUDIO = "Original";

/**
 * Every dub marker the catalog uses. This drives **detection** — the bracket in a raw
 * title — so it must stay complete: dropping a language here would make those subjects
 * read as originals and defeat the de-duplication and auto-switch entirely.
 */
export const AUDIO_LANGUAGES = [
  ORIGINAL_AUDIO,
  "Hindi",
  "Tamil",
  "Telugu",
  "English",
  "Malayalam",
  "Kannada",
  "Bengali",
  "Marathi",
  "Punjabi",
  "Urdu",
  "Arabic",
  "Spanish",
  "French",
  "Dubbed",
] as const;

/** Tracks offered as a preference. Detection still recognises the rest. */
export const AUDIO_PREFERENCES = [ORIGINAL_AUDIO, "English", "French", "Spanish", "Arabic"] as const;

/**
 * Dubs kept out of the per-title switcher. They are still detected, still de-duplicated
 * against, and still shown when a title exists in no other track — hiding the only
 * available audio would make the title unplayable.
 */
export const HIDDEN_AUDIO_LANGUAGES = [
  "Hindi",
  "Tamil",
  "Telugu",
  "Malayalam",
  "Kannada",
  "Bengali",
  "Marathi",
  "Punjabi",
  "Urdu",
] as const;

/**
 * Countries the catalog can be scoped to. MovieBox's default operating feed is heavily
 * India-weighted; picking a country here swaps Home over to a filtered browse instead.
 * `"All"` is the unfiltered catalog — genuinely universal, but noisier.
 */
export const CATALOG_COUNTRIES = [
  "United States",
  "United Kingdom",
  "All",
  "Canada",
  "Australia",
  "France",
  "Germany",
  "Spain",
  "Italy",
  "Japan",
  "Korea",
  "China",
  "India",
  "Turkey",
  "Nigeria",
  "Philippines",
  "South Africa",
] as const;

export interface CatalogItem {
  id: string;
  provider: ProviderKind;
  title: string;
  /** Title as returned by the API, before `cleanMovieBoxTitle`. */
  rawTitle: string;
  mediaType: MediaType;
  year: string;
  posterUrl: string | null;
  /** Highest season number seen for this subject, 0 when unknown. */
  season: number;
  /** One of `AUDIO_LANGUAGES`; `ORIGINAL_AUDIO` when the title carries no dub marker. */
  audioLanguage: string;
  /** Camcorder rip of a still-in-cinemas release — watchable, but poor quality. */
  isCam: boolean;
  /** Pornographic or explicitly erotic; hidden unless the user opts in. */
  isAdult: boolean;
  description?: string;
  imdbRating?: string;
  genres?: string[];
}

/** A sibling subject carrying the same title in a different audio language. */
export interface AudioVariant {
  language: string;
  subjectId: string;
  rawTitle: string;
}

export interface Episode {
  season: number;
  number: number;
  title: string | null;
  /** Subject id to query for this episode's resources; falls back to the parent id. */
  subjectId: string;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface MediaDetails extends CatalogItem {
  description: string;
  imdbRating: string;
  genres: string[];
  releaseDate: string;
  duration: string;
  country: string;
  cast: CastMember[];
  seasons: Season[];
  backdropUrl: string | null;
  trailerUrl: string | null;
}

export interface CastMember {
  id: string;
  name: string;
  character: string;
  avatarUrl: string | null;
}

export interface PersonDetails {
  id: string;
  name: string;
  avatarUrl: string | null;
  biography: string;
  biographySourceUrl: string | null;
  movies: CatalogItem[];
  series: CatalogItem[];
}

export interface Release {
  /** Direct playable URL: a signed `.mp4`, or a `.mpd` manifest for the adaptive stream. */
  url: string;
  resourceId: string;
  filename: string;
  resolution: number;
  sizeBytes: number;
  format: string;
  /** Extra request headers the stream needs; empty for MovieBox. */
  headers: Record<string, string>;
  dubbed: boolean;
  language: string;
  /** `dash` streams are adaptive and carry every quality in one manifest. */
  kind?: "mp4" | "dash";
  /** Heights available inside a DASH manifest, best first. */
  ladder?: number[];
}

export interface SubtitleOption {
  /** English name, normalised from `lang` (`हिन्दी` -> `Hindi`). What the UI shows. */
  name: string;
  /** Name exactly as MovieBox returned it, in its own script. */
  nativeName: string;
  /** BCP-47-ish code from the API (`en`, `pt`, `in_id`), used for the track's srcLang. */
  lang: string;
  url: string;
}

export type SubtitleBackground = "box" | "shadow" | "none" | "window" | "semi-transparent";

export type SubtitleFontFamily = "sans-serif" | "serif" | "monospace" | "casual" | "cursive" | "small-caps";

export type SubtitleEdgeStyle = "none" | "drop-shadow" | "outline" | "raised" | "depressed";

export type SubtitlePosition = "bottom" | "middle" | "top";

export const SUBTITLE_FONT_FAMILIES: { value: SubtitleFontFamily; label: string; fontFamily: string }[] = [
  { value: "sans-serif", label: "Sans-Serif", fontFamily: "system-ui, -apple-system, sans-serif" },
  { value: "serif", label: "Serif", fontFamily: "Georgia, 'Times New Roman', serif" },
  { value: "monospace", label: "Monospace", fontFamily: "'Courier New', Courier, monospace" },
  { value: "casual", label: "Casual", fontFamily: "'Comic Sans MS', 'Trebuchet MS', sans-serif" },
  { value: "cursive", label: "Cursive", fontFamily: "'Brush Script MT', cursive" },
  { value: "small-caps", label: "Small Caps", fontFamily: "sans-serif" },
];

export const SUBTITLE_EDGE_STYLES: { value: SubtitleEdgeStyle; label: string }[] = [
  { value: "drop-shadow", label: "Drop Shadow" },
  { value: "outline", label: "Uniform Outline" },
  { value: "raised", label: "Raised" },
  { value: "depressed", label: "Depressed" },
  { value: "none", label: "None" },
];

export const SUBTITLE_POSITIONS: { value: SubtitlePosition; label: string }[] = [
  { value: "bottom", label: "Bottom" },
  { value: "middle", label: "Middle" },
  { value: "top", label: "Top" },
];

/**
 * Saving every language turns one download into ~16 extra requests and files. `preferred`
 * keeps only the language chosen in settings (falling back to English), which is what
 * most people actually watch with.
 */
export type DownloadSubtitlePolicy = "preferred" | "all" | "none";

export const SUBTITLE_COLORS = [
  { value: "#ffffff", label: "White" },
  { value: "#ffe867", label: "Yellow" },
  { value: "#8ff0a4", label: "Green" },
  { value: "#7fd3ff", label: "Cyan" },
  { value: "#ffb2c8", label: "Pink" },
  { value: "#ff4d4d", label: "Red" },
  { value: "#111111", label: "Black" },
];

/** Sentinel for "no subtitle track", used by the picker and by `preferredSubtitle`. */
export const SUBTITLE_OFF = "Off";

/**
 * Subtitle language table. MovieBox returns each name in its own script (`हिन्दी`,
 * `اَلْعَرَبِيَّةُ`, `tiếng Việt`), which is unreadable unless you know the script, so the
 * UI shows `name` and keeps `native` alongside it. Codes are the API's own, including its
 * non-standard ones (`in_id` for Indonesian). Not every title carries every track.
 */
export const SUBTITLE_LANGUAGES: { code: string; name: string; native: string }[] = [
  { code: "en", name: "English", native: "English" },
  { code: "ar", name: "Arabic", native: "اَلْعَرَبِيَّةُ" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "fil", name: "Filipino", native: "Filipino" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "in_id", name: "Indonesian", native: "Indonesia" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "ms", name: "Malay", native: "Melayu" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "fa", name: "Persian", native: "فارسی" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "ro", name: "Romanian", native: "Română" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "th", name: "Thai", native: "ภาษาไทย" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "ur", name: "Urdu", native: "اُردُو" },
  { code: "vi", name: "Vietnamese", native: "tiếng Việt" },
];

export interface HomeRow {
  title: string;
  items: CatalogItem[];
}

export interface HomeTab {
  id: string;
  name: string;
}

export interface HomePage {
  tabs: HomeTab[];
  hero: CatalogItem[];
  rows: HomeRow[];
}

export interface Channel {
  id: string;
  name: string;
  logo: string;
  group: string;
  /** ISO 3166-1 alpha-2, upper case. Empty when the playlist does not say. */
  country: string;
  streamUrl: string;
}

export interface PreparedLiveStream {
  /** Original HLS URL, or a private local stream when transcoding is required. */
  url: string;
  transcoded: boolean;
  codec?: string;
  /** Full source duration when ffprobe can determine it. */
  duration?: number;
  warning?: string;
}

export interface PlaylistSource {
  name: string;
  url: string;
}

/**
 * Community-maintained, openly published playlists.
 *
 * Both projects index streams their broadcasters put out publicly; neither carries
 * subscription services. Arabic coverage measured against the live lists: 325 channels
 * across 18 Arab countries in the iptv-org index, 356 in its Arabic-language cut, 77 in
 * Free-TV — which also tags every entry with `tvg-country`.
 */
export const DEFAULT_PLAYLISTS: PlaylistSource[] = [
  {
    name: "IPTV-org — All channels",
    url: "https://iptv-org.github.io/iptv/index.m3u",
  },
  {
    name: "IPTV-org — Arabic",
    url: "https://iptv-org.github.io/iptv/languages/ara.m3u",
  },
  {
    name: "IPTV-org — Sports",
    url: "https://iptv-org.github.io/iptv/categories/sports.m3u",
  },
  {
    name: "IPTV-org — News",
    url: "https://iptv-org.github.io/iptv/categories/news.m3u",
  },
  {
    name: "Free-TV",
    url: "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",
  },
];

export interface WatchHistoryItem {
  provider: ProviderKind;
  subjectId: string;
  title: string;
  posterUrl: string | null;
  mediaType: MediaType;
  year: string;
  season: number;
  episode: number;
  /** Playback position in seconds. */
  position: number;
  /** Total media length in seconds, 0 when unknown. */
  duration: number;
  timestamp: number;
}

export interface AppConfig {
  theme: "midnight" | "noir" | "ember" | "ocean" | "forest" | "plum";
  /** Country the Home rows are filtered to; one of `CATALOG_COUNTRIES`. */
  catalogCountry: string;
  /** Keep pornographic and explicitly erotic titles out of every list. */
  hideAdultContent: boolean;
  /** Audio track preferred when a title exists in several dubs. */
  preferredAudio: string;
  /** Subtitle turned on automatically when playback starts; `SUBTITLE_OFF` for none. */
  preferredSubtitle: string;
  defaultResolution: number;
  autoplayNext: boolean;
  /** What to do when a saved playback position exists. */
  resumeBehavior: "ask" | "resume" | "restart";
  /** Uses Electron/GPU decoding and FFmpeg auto hardware acceleration when available. */
  hardwareAcceleration: boolean;
  /** Disables non-essential interface animation independently of the OS preference. */
  reducedMotion: boolean;
  /** Cue text size as a percentage of the player default. */
  subtitleSize: number;
  /** Cue text colour, any CSS colour. */
  subtitleColor: string;
  /** Which caption languages are saved alongside a download. */
  downloadSubtitles: DownloadSubtitlePolicy;
  /** How cue text is separated from the picture behind it. */
  subtitleBackground: SubtitleBackground;
  subtitleFontFamily: SubtitleFontFamily;
  subtitleEdgeStyle: SubtitleEdgeStyle;
  subtitlePosition: SubtitlePosition;
  volume: number;
  playlists: PlaylistSource[];
}

export const DEFAULT_CONFIG: AppConfig = {
  theme: "midnight",
  catalogCountry: "United States",
  hideAdultContent: true,
  preferredAudio: ORIGINAL_AUDIO,
  preferredSubtitle: SUBTITLE_OFF,
  defaultResolution: 0,
  autoplayNext: true,
  resumeBehavior: "ask",
  hardwareAcceleration: true,
  reducedMotion: false,
  subtitleSize: 100,
  subtitleColor: "#ffffff",
  downloadSubtitles: "preferred",
  subtitleBackground: "box",
  subtitleFontFamily: "sans-serif",
  subtitleEdgeStyle: "drop-shadow",
  subtitlePosition: "bottom",
  volume: 1,
  playlists: [...DEFAULT_PLAYLISTS],
};

/** Uniform IPC envelope so renderer code never has to catch across the bridge. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type DownloadState =
  | "progressing"
  | "paused"
  | "completed"
  | "cancelled"
  | "interrupted";

/** What the UI must supply to start a download; everything else is derived. */
export interface DownloadRequest {
  url: string;
  /** Needed to look the title's captions up so they can be stored for offline use. */
  resourceId: string;
  title: string;
  /** Release year, so offline playback records the same metadata as streaming. */
  year: string;
  posterUrl: string | null;
  subjectId: string;
  mediaType: MediaType;
  /** 0 for a movie. */
  season: number;
  episode: number;
  resolution: number;
  /** DASH downloads are remuxed to a standalone MP4 at the requested resolution. */
  sourceKind?: "mp4" | "dash";
}

/**
 * A whole season queued at once. The episode list is resolved to concrete releases one at
 * a time in the main process, because the signed URLs expire before a long queue drains.
 */
export interface SeasonDownloadRequest {
  subjectId: string;
  title: string;
  year: string;
  posterUrl: string | null;
  season: number;
  episodes: number[];
  /** Preferred height; 0 takes the best available for each episode. */
  resolution: number;
}

export interface DownloadRecord extends DownloadRequest {
  id: string;
  filename: string;
  savePath: string;
  /** `file://` form of `savePath`, so the player can load it directly. */
  fileUrl: string;
  receivedBytes: number;
  totalBytes: number;
  state: DownloadState;
  startedAt: number;
  completedAt: number | null;
  /** False once the file has been moved or deleted outside the app. */
  fileExists: boolean;
  /** Human-readable reason when a transfer did not produce playable media. */
  failureReason?: string;
  /** Captions saved next to the video, as WebVTT, for offline playback. */
  subtitles: { name: string; nativeName: string; lang: string; path: string }[];
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  /** Installer/runtime format used to give package-specific update guidance. */
  packageType: string;
  /** False in dev, unpacked builds, and intentionally unsigned macOS builds. */
  updatable: boolean;
  /** FFmpeg on PATH. Without it, adaptive (DASH) qualities cannot be saved. */
  ffmpeg: boolean;
  /** Human-readable FFmpeg version string, or empty when unavailable. */
  ffmpegVersion: string;
  /** Detected graphics vendor and Chromium video-decode status. */
  gpu: string;
}

/** Progress of the GitHub-release update flow, pushed to the renderer as it changes. */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "up-to-date"; version: string }
  | { state: "downloading"; percent: number; transferred: number; total: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string }
  | { state: "unsupported"; message: string };

export const AUTHORS = [
  {
    name: "EL HADRATI Othman",
    email: "othmanelhadrati@gmail.com",
    github: "https://github.com/ELhadratiOth",
    githubHandle: "ELhadratiOth",
    role: "Lead Developer",
  },
  {
    name: "Tajeddine Bourhim",
    email: "bourhimtajeddine@gmail.com",
    github: "https://github.com/Scorpiontaj",
    githubHandle: "Scorpiontaj",
    role: "Co-Author & Core Developer",
  },
] as const;

export const AUTHOR = AUTHORS[0];

export interface InfinityPlayApi {
  catalog: {
    home: () => Promise<Result<HomePage>>;
    featured: (tabId?: string, page?: number) => Promise<Result<HomePage>>;
    search: (query: string, page?: number) => Promise<Result<CatalogItem[]>>;
    suggest: (query: string) => Promise<Result<CatalogItem[]>>;
    details: (subjectId: string) => Promise<Result<MediaDetails>>;
    person: (staffId: string, name: string, avatarUrl: string | null) => Promise<Result<PersonDetails>>;
    audioVariants: (title: string, mediaType: MediaType) => Promise<Result<AudioVariant[]>>;
    releases: (subjectId: string, season?: number, episode?: number) => Promise<Result<Release[]>>;
    subtitles: (subjectId: string, resourceId: string) => Promise<Result<SubtitleOption[]>>;
    clearCache: () => Promise<Result<boolean>>;
  };
  subtitle: {
    load: (url: string) => Promise<Result<string>>;
  };
  tv: {
    playlist: (url: string, forceRefresh?: boolean) => Promise<Result<Channel[]>>;
  };
  media: {
    prepareLive: (url: string, startAt?: number, resolution?: number) => Promise<Result<PreparedLiveStream>>;
    preview: (url: string, position: number, resolution?: number) => Promise<Result<string | null>>;
    stageManifest: (xml: string) => Promise<Result<string>>;
    reportDecodable: (codecs: string[]) => Promise<Result<boolean>>;
  };
  config: {
    get: () => Promise<Result<AppConfig>>;
    update: (patch: Partial<AppConfig>) => Promise<Result<AppConfig>>;
  };
  history: {
    list: () => Promise<Result<WatchHistoryItem[]>>;
    record: (item: WatchHistoryItem) => Promise<Result<WatchHistoryItem[]>>;
    remove: (subjectId: string) => Promise<Result<WatchHistoryItem[]>>;
    clear: () => Promise<Result<WatchHistoryItem[]>>;
  };
  downloads: {
    start: (request: DownloadRequest) => Promise<Result<DownloadRecord>>;
    startSeason: (request: SeasonDownloadRequest) => Promise<Result<number>>;
    clearQueue: () => Promise<Result<number>>;
    queueSize: () => Promise<Result<number>>;
    list: () => Promise<Result<DownloadRecord[]>>;
    pause: (id: string) => Promise<Result<boolean>>;
    resume: (id: string) => Promise<Result<boolean>>;
    cancel: (id: string) => Promise<Result<boolean>>;
    remove: (id: string, deleteFile: boolean) => Promise<Result<DownloadRecord[]>>;
    clearFinished: () => Promise<Result<DownloadRecord[]>>;
    open: (id: string) => Promise<Result<string>>;
    reveal: (id: string) => Promise<Result<boolean>>;
    onProgress: (listener: (record: DownloadRecord) => void) => () => void;
  };
  app: {
    info: () => Promise<Result<AppInfo>>;
  };
  updates: {
    status: () => Promise<Result<UpdateStatus>>;
    check: () => Promise<Result<UpdateStatus>>;
    install: () => Promise<Result<boolean>>;
    onStatus: (listener: (status: UpdateStatus) => void) => () => void;
  };
  system: {
    openExternal: (url: string) => Promise<Result<void>>;
    setFullScreen: (value: boolean) => Promise<Result<boolean>>;
    pickPlaylistFile: () => Promise<Result<string | null>>;
    restart: () => Promise<Result<boolean>>;
  };
}
