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

/**
 * Audio languages InfinityPlay intentionally offers. English is the default and fallback;
 * Arabic and French remain available when a source publishes them. Catalog detection still
 * recognises every marker above so unsupported dubs can be removed instead of being mistaken
 * for an original release.
 */
export const AUDIO_PREFERENCES = ["English", "Arabic", "French"] as const;

export type PreferredAudioLanguage = (typeof AUDIO_PREFERENCES)[number];

/** Converts manifest codes and human labels to one of the three supported languages. */
export function preferredAudioLanguage(value: string | null | undefined): PreferredAudioLanguage | null {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (/^(en|eng)(-|\s|$)/.test(normalized) || /\benglish\b/.test(normalized)) return "English";
  if (/^(ar|ara)(-|\s|$)/.test(normalized) || /\barabic\b/.test(normalized)) return "Arabic";
  if (/^(fr|fra|fre)(-|\s|$)/.test(normalized) || /\bfrench\b/.test(normalized)) return "French";
  return null;
}

/** Supported language names in selection order, with English as the universal fallback. */
export function preferredAudioOrder(preferred: string | null | undefined): PreferredAudioLanguage[] {
  const names: PreferredAudioLanguage[] = ["English", "Arabic", "French"];
  const selected = preferredAudioLanguage(preferred) ?? "English";
  return [selected, ...names.filter((name) => name !== selected)];
}

/** BCP-47 tags in selection order, for HLS/DASH/Media3 track selectors. */
export function preferredAudioTags(preferred: string | null | undefined): string[] {
  return preferredAudioOrder(preferred).map(
    (name) => ({ English: "en", Arabic: "ar", French: "fr" })[name],
  );
}

/** Original/undubbed entries stay usable; explicit dubs are limited to the supported set. */
export function isAllowedCatalogAudio(language: string): boolean {
  return language === ORIGINAL_AUDIO || preferredAudioLanguage(language) !== null;
}

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
  /** Per-channel HTTP headers declared by EXTINF/EXTVLCOPT (for example Referer). */
  headers?: Record<string, string>;
  /** Provenance inherited from the selected source; never inferred from a channel name. */
  trust?: SourceTrust;
  /** Human-readable reason the source received its trust level. */
  trustNote?: string;
}

export type SourceTrust = "official" | "community" | "user";

export interface ChannelProgramme {
  channelId: string;
  title: string;
  description: string;
  start: number;
  stop: number;
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
  /** An HLS URL can represent one verified channel instead of an M3U channel directory. */
  type?: "m3u" | "direct";
  trust?: SourceTrust;
  trustNote?: string;
  /** Optional user-supplied XMLTV document matched through each channel's `tvg-id`. */
  epgUrl?: string;
  directChannel?: Omit<Channel, "streamUrl" | "trust" | "trustNote">;
}

export interface XtreamSource {
  id: string;
  name: string;
  serverUrl: string;
  username: string;
  password: string;
}

/**
 * Community-maintained, openly published playlists.
 *
 * Community indexes can change without notice. Their entries are deliberately marked
 * community rather than official: a public URL is not proof that a broadcaster licensed
 * a third-party player to redistribute it.
 */
export const DEFAULT_PLAYLISTS: PlaylistSource[] = [
  {
    name: "Verified — beIN SPORTS XTRA",
    url: "https://bein-xtra-bein.amagi.tv/playlist.m3u8",
    type: "direct",
    trust: "official",
    trustNote: "Free beIN FAST channel delivered by its authorized Amagi distribution feed.",
    directChannel: {
      id: "beINSPORTSXTRA.us",
      name: "beIN SPORTS XTRA",
      logo: "https://i.ibb.co/HT49GPmB/XTRA-2.png",
      group: "Sports",
      country: "US",
    },
  },
  {
    name: "IPTV-org — All channels",
    url: "https://iptv-org.github.io/iptv/index.m3u",
    trust: "community",
  },
  {
    name: "IPTV-org — Arabic",
    url: "https://iptv-org.github.io/iptv/languages/ara.m3u",
    trust: "community",
  },
  {
    name: "IPTV-org — Sports",
    url: "https://iptv-org.github.io/iptv/categories/sports.m3u",
    trust: "community",
  },
  {
    name: "IPTV-org — Movies",
    url: "https://iptv-org.github.io/iptv/categories/movies.m3u",
    trust: "community",
  },
  {
    name: "IPTV-org — Series",
    url: "https://iptv-org.github.io/iptv/categories/series.m3u",
    trust: "community",
  },
  {
    name: "IPTV-org — Morocco",
    url: "https://iptv-org.github.io/iptv/countries/ma.m3u",
    trust: "community",
  },
  {
    name: "IPTV-org — French",
    url: "https://iptv-org.github.io/iptv/languages/fra.m3u",
    trust: "community",
  },
  {
    name: "IPTV-org — News",
    url: "https://iptv-org.github.io/iptv/categories/news.m3u",
    trust: "community",
  },
  {
    name: "Free-TV",
    url: "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",
    trust: "community",
  },
];

export type FreeMediaProvider = "loc" | "wikimedia";

export interface FreeMediaItem {
  id: string;
  provider: FreeMediaProvider;
  title: string;
  description: string;
  year: string;
  posterUrl: string | null;
  detailUrl: string;
  streamUrl: string | null;
  mimeType: string;
  rights: string;
  creator: string;
}

export interface WatchProviderOption {
  id: number;
  name: string;
  logoUrl: string | null;
}

export interface WatchAvailability {
  configured: boolean;
  region: string;
  link: string | null;
  free: WatchProviderOption[];
  ads: WatchProviderOption[];
  subscription: WatchProviderOption[];
  rent: WatchProviderOption[];
  buy: WatchProviderOption[];
}

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

/** A catalog item saved by the viewer, with stable local ordering metadata. */
export interface FavoriteItem extends CatalogItem {
  addedAt: number;
}

/**
 * A title put aside to watch another time.
 *
 * Kept apart from favourites on purpose: a favourite is something you liked and want to keep,
 * while this is a queue you intend to empty. The same title can reasonably be in both.
 */
export interface WatchLaterItem extends CatalogItem {
  addedAt: number;
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
  /** User-owned IPTV subscriptions. Credentials stay in the local app configuration. */
  xtreamSources: XtreamSource[];
  /** ISO 3166-1 region used for legal streaming availability. */
  watchRegion: string;
  /** Whether Discord Rich Presence activity is broadcast during playback. */
  discordRpc: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  theme: "midnight",
  catalogCountry: "United States",
  hideAdultContent: true,
  preferredAudio: "English",
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
  xtreamSources: [],
  watchRegion: "MA",
  discordRpc: true,
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

/**
 * Chromecast reaches Google's own receivers; DLNA reaches most smart TVs and media renderers.
 * Neither alone covers every device, so both are discovered and shown in one list.
 */
export type CastProtocol = "chromecast" | "dlna";

export interface CastDevice {
  id: string;
  name: string;
  protocol: CastProtocol;
  /** Model or room name when the device reports one, purely for telling two TVs apart. */
  detail?: string;
}

export type CastPlaybackState = "idle" | "loading" | "playing" | "paused" | "buffering" | "ended" | "error";

/**
 * The small piece of a series needed to continue a cast without keeping its detail page mounted.
 * Episode releases are signed on demand, so URLs deliberately do not live here.
 */
export interface EpisodeNavigationContext {
  subjectId: string;
  season: number;
  episode: number;
  /** Ordered across every available season, not just the season currently on screen. */
  episodes: Pick<Episode, "season" | "number">[];
  /** Keep the cast at the quality the viewer chose when the next source offers it. */
  resolution?: number;
  /** Caption intent is carried forward; the next episode gets its own caption file. */
  subtitle?: { off: boolean; name?: string; language?: string };
}

export interface CastSession {
  device: CastDevice;
  state: CastPlaybackState;
  title: string;
  /** Seconds; 0 when the receiver has not reported a position yet. */
  position: number;
  duration: number;
  /** 0–1. */
  volume: number;
  muted: boolean;
  message?: string;
  /** Present for series, allowing the persistent floating controller to change episode. */
  episodeContext?: EpisodeNavigationContext;
}

/** What the player hands over when starting a cast. */
export interface CastRequest {
  deviceId: string;
  url: string;
  title: string;
  subtitleLine?: string;
  mimeType?: string;
  posterUrl?: string;
  subtitleUrl?: string;
  /** Selected caption track, already normalized to WebVTT for a receiver. */
  subtitleVtt?: string;
  subtitleName?: string;
  subtitleLanguage?: string;
  /** Resume point, so casting continues from where local playback stopped. */
  startSeconds?: number;
  durationSeconds?: number;
  /** Live streams are told apart so the receiver is not asked to seek in them. */
  live?: boolean;
  /** Series metadata used for previous/next episode controls and auto-advance. */
  episodeContext?: EpisodeNavigationContext;
}

/** Result of pause/resume. `reason` is present only when the UI should explain the refusal. */
export interface DownloadControlResult {
  ok: boolean;
  reason?: string;
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
  runtime: "electron" | "android";
  /** Native Android versionCode. Desktop builds do not expose this field. */
  buildNumber?: string;
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
  /**
   * Found, and waiting for the user to accept or decline. Nothing is fetched until they do.
   * `notes` is that release's description, so About can show what the update contains before
   * the user commits to it.
   */
  | { state: "available"; version: string; notes?: string }
  | { state: "up-to-date"; version: string }
  | {
      state: "downloading";
      version: string;
      notes?: string;
      percent: number;
      transferred: number;
      total: number;
    }
  | {
      state: "paused";
      version: string;
      notes?: string;
      percent: number;
      transferred: number;
      total: number;
    }
  /** Declined for now; the About page still offers it. */
  | { state: "declined"; version: string; notes?: string }
  | { state: "downloaded"; version: string; notes?: string }
  | { state: "error"; message: string }
  /**
   * This build cannot replace itself. `releaseUrl` is where a new version can be fetched by hand —
   * Android has no in-app updater, so checking and installing are the user's to do.
   */
  | { state: "unsupported"; message: string; releaseUrl?: string; version?: string };

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
    /** Row titles for the Home screen. Each row's contents is fetched separately, as it is needed. */
    homeSections: () => Promise<Result<string[]>>;
    homeSection: (index: number) => Promise<Result<HomeRow>>;
    anime: (page?: number) => Promise<Result<CatalogItem[]>>;
    featured: (tabId?: string, page?: number) => Promise<Result<HomePage>>;
    search: (query: string, page?: number) => Promise<Result<CatalogItem[]>>;
    suggest: (query: string) => Promise<Result<CatalogItem[]>>;
    details: (subjectId: string) => Promise<Result<MediaDetails>>;
    person: (staffId: string, name: string, avatarUrl: string | null) => Promise<Result<PersonDetails>>;
    audioVariants: (title: string, mediaType: MediaType) => Promise<Result<AudioVariant[]>>;
    releases: (subjectId: string, season?: number, episode?: number) => Promise<Result<Release[]>>;
    subtitles: (subjectId: string, resourceId: string, title?: string, year?: string, season?: number, episode?: number) => Promise<Result<SubtitleOption[]>>;
    searchOnlineSubtitles: (params: { title: string; year?: string; imdbId?: string; season?: number; episode?: number; languages?: string[] }) => Promise<Result<SubtitleOption[]>>;
    clearCache: () => Promise<Result<boolean>>;
  };
  subtitle: {
    load: (url: string) => Promise<Result<string>>;
  };
  tv: {
    playlist: (source: PlaylistSource, forceRefresh?: boolean) => Promise<Result<Channel[]>>;
    epg: (url: string, channelIds: string[]) => Promise<Result<Record<string, ChannelProgramme[]>>>;
    xtream: (source: XtreamSource) => Promise<Result<Channel[]>>;
    xtreamEpg: (source: XtreamSource, channelIds: string[]) => Promise<Result<Record<string, ChannelProgramme[]>>>;
  };
  freeMedia: {
    browse: (provider: FreeMediaProvider, page?: number) => Promise<Result<FreeMediaItem[]>>;
    search: (provider: FreeMediaProvider, query: string, page?: number) => Promise<Result<FreeMediaItem[]>>;
    details: (provider: FreeMediaProvider, id: string) => Promise<Result<FreeMediaItem>>;
  };
  availability: {
    title: (title: string, mediaType: MediaType) => Promise<Result<WatchAvailability>>;
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
  favorites: {
    list: () => Promise<Result<FavoriteItem[]>>;
    toggle: (item: CatalogItem) => Promise<Result<FavoriteItem[]>>;
  };
  watchLater: {
    list: () => Promise<Result<WatchLaterItem[]>>;
    toggle: (item: CatalogItem) => Promise<Result<WatchLaterItem[]>>;
    clear: () => Promise<Result<WatchLaterItem[]>>;
  };
  downloads: {
    start: (request: DownloadRequest) => Promise<Result<DownloadRecord>>;
    startSeason: (request: SeasonDownloadRequest) => Promise<Result<number>>;
    clearQueue: () => Promise<Result<number>>;
    queueSize: () => Promise<Result<number>>;
    list: () => Promise<Result<DownloadRecord[]>>;
    /** Refusals carry a reason, so a control that cannot act says why instead of doing nothing. */
    pause: (id: string) => Promise<Result<DownloadControlResult>>;
    resume: (id: string) => Promise<Result<DownloadControlResult>>;
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
    /** Accepts the offered update and starts (or restarts) the transfer. */
    download: () => Promise<Result<boolean>>;
    pause: () => Promise<Result<boolean>>;
    /** Keeps the update on offer without fetching it. */
    decline: () => Promise<Result<boolean>>;
    install: () => Promise<Result<boolean>>;
    onStatus: (listener: (status: UpdateStatus) => void) => () => void;
  };
  cast: {
    discover: () => Promise<Result<CastDevice[]>>;
    start: (request: CastRequest) => Promise<Result<CastSession>>;
    play: () => Promise<Result<boolean>>;
    pause: () => Promise<Result<boolean>>;
    seek: (seconds: number) => Promise<Result<boolean>>;
    setVolume: (level: number) => Promise<Result<boolean>>;
    stop: () => Promise<Result<boolean>>;
    session: () => Promise<Result<CastSession | null>>;
    onSession: (listener: (session: CastSession | null) => void) => () => void;
  };
  system: {
    openExternal: (url: string) => Promise<Result<void>>;
    setFullScreen: (value: boolean) => Promise<Result<boolean>>;
    pickPlaylistFile: () => Promise<Result<string | null>>;
    pickDirectory: (title?: string) => Promise<Result<string | null>>;
    restart: () => Promise<Result<boolean>>;
  };
  discord?: {
    setActivity: (params: {
      details: string;
      state?: string;
      startTimestamp?: number;
      endTimestamp?: number;
      largeImageKey?: string;
      largeImageText?: string;
    }) => Promise<Result<void>>;
    clearActivity: () => Promise<Result<void>>;
  };
}
