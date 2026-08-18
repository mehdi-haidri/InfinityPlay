import { Preferences } from "@capacitor/preferences";
import { Browser } from "@capacitor/browser";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { App as CapApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import {
  androidCastPause,
  androidCastPlay,
  androidCastSeek,
  androidCastSession,
  androidCastStop,
  androidCastVolume,
  androidDiscover,
  androidOnCastSession,
  androidStartCast,
} from "./androidCast";
import type {
  AppConfig,
  AppInfo,
  AudioVariant,
  CatalogItem,
  FavoriteItem,
  WatchLaterItem,
  FreeMediaProvider,
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
import { DEFAULT_CONFIG, preferredAudioLanguage } from "@shared/types";
import { MovieBoxService } from "@/../../main/providers/moviebox";
import { fetchPlaylist } from "@/../../main/providers/m3u";
import { fetchEpg } from "@/../../main/providers/epg";
import { fetchXtreamChannels, fetchXtreamEpg } from "@/../../main/providers/xtream";
import { browseFreeMedia, freeMediaDetails, searchFreeMedia } from "@/../../main/providers/free-media";
import { findWatchAvailability } from "@/../../main/providers/watch";
import { fetchSubtitleAsVttDataUrl } from "@/../../main/providers/subtitles";

const STORAGE_KEYS = {
  CONFIG: "infinityplay_config",
  HISTORY: "infinityplay_history",
  DOWNLOADS: "infinityplay_downloads",
  FAVORITES: "infinityplay_favorites",
  WATCH_LATER: "infinityplay_watch_later",
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
  pause(options: { id: string }): Promise<{ ok: boolean }>;
  resume(options: { id: string }): Promise<{ ok: boolean }>;
  cancel(options: { id: string }): Promise<void>;
  open(options: { id: string }): Promise<void>;
}

const nativeDownloads = registerPlugin<InfinityDownloadsPlugin>("InfinityDownloads");

interface NativeUpdaterStatus {
  state: "idle" | "progressing" | "paused" | "completed" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
  percent: number;
  filePath: string;
  failureReason: string;
}

interface InfinityUpdaterPlugin {
  start(options: { url: string; version?: string; filename?: string }): Promise<{ id: string }>;
  status(options?: { id?: string }): Promise<NativeUpdaterStatus>;
  pause(options?: { id?: string }): Promise<{ ok: boolean }>;
  resume(options?: { id?: string }): Promise<{ ok: boolean }>;
  cancel(options?: { id?: string }): Promise<{ ok: boolean }>;
  install(options?: { filePath?: string }): Promise<{ ok: boolean }>;
}

const nativeUpdater = registerPlugin<InfinityUpdaterPlugin>("InfinityUpdater");

export interface NativePlayerResult {
  positionMs: number;
  durationMs: number;
  ended: boolean;
  error: string;
  cancelled: boolean;
  castRequested: boolean;
  subtitleUrl: string;
  subtitleName: string;
  subtitleLanguage: string;
  /** True only when the viewer explicitly changed the native subtitle picker. */
  subtitleChanged: boolean;
  /** -1/1 when the native player asks the shared layer to change episode. */
  episodeStep: number;
}

interface InfinityPlayerPlugin {
  open(options: {
    url: string;
    title: string;
    posterUrl: string;
    positionMs: number;
    subtitlesJson: string;
    releasesJson: string;
    headersJson: string;
    preferredAudioLanguage: string;
    preferredSubtitleLanguage: string;
    hasPreviousEpisode: boolean;
    hasNextEpisode: boolean;
    autoplayNext: boolean;
    live: boolean;
  }): Promise<NativePlayerResult>;
}

/** Android Media3 bridge for VOD plus header-protected HLS/IPTV streams. */
export const nativePlayer = registerPlugin<InfinityPlayerPlugin>("InfinityPlayer");

let cachedConfig: AppConfig | null = null;

async function getStoredConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEYS.CONFIG });
    if (value) {
      const stored = JSON.parse(value) as Partial<AppConfig>;
      cachedConfig = {
        ...DEFAULT_CONFIG,
        ...stored,
        preferredAudio: preferredAudioLanguage(stored.preferredAudio) ?? "English",
      };
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
  cachedConfig.preferredAudio = preferredAudioLanguage(cachedConfig.preferredAudio) ?? "English";
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

async function getStoredWatchLater(): Promise<WatchLaterItem[]> {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEYS.WATCH_LATER });
    if (value) return JSON.parse(value);
  } catch {
    // An unreadable queue should not stop the rest of the library loading.
  }
  return [];
}

async function saveStoredWatchLater(items: WatchLaterItem[]): Promise<WatchLaterItem[]> {
  await Preferences.set({ key: STORAGE_KEYS.WATCH_LATER, value: JSON.stringify(items) });
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

/** Where a newer build is published. Matches `publish.owner`/`publish.repo` in electron-builder.yml. */
const RELEASES_URL = "https://github.com/ELhadratiOth/InfinityPlay/releases";

/** `v0.3.5` and `0.3.5-beta.1` both compare as [0, 3, 5]. */
function versionParts(value: string): number[] {
  return value
    .replace(/^v/i, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `candidate` is a later version than `current`. */
function isNewer(candidate: string, current: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

interface DiscoveredRelease {
  version: string;
  notes?: string;
  apkUrl?: string;
  releaseUrl: string;
}

let currentUpdateStatus: UpdateStatus = { state: "idle" };
const updateListeners = new Set<(status: UpdateStatus) => void>();
let latestDiscoveredRelease: DiscoveredRelease | null = null;
let activeUpdateJobId: string | null = null;
let updateProgressTimer: number | undefined;

function publishUpdateStatus(next: UpdateStatus): void {
  currentUpdateStatus = next;
  for (const listener of updateListeners) {
    try {
      listener(next);
    } catch {
      // Listener error
    }
  }
}

function stopUpdateProgressPoll(): void {
  if (updateProgressTimer !== undefined) {
    window.clearInterval(updateProgressTimer);
    updateProgressTimer = undefined;
  }
}

function startUpdateProgressPoll(version: string, notes?: string): void {
  stopUpdateProgressPoll();
  updateProgressTimer = window.setInterval(async () => {
    try {
      const status = await nativeUpdater.status({ id: activeUpdateJobId ?? undefined });
      if (status.state === "progressing") {
        publishUpdateStatus({
          state: "downloading",
          version,
          notes,
          percent: status.percent,
          transferred: status.receivedBytes,
          total: status.totalBytes,
        });
      } else if (status.state === "completed") {
        stopUpdateProgressPoll();
        publishUpdateStatus({
          state: "downloaded",
          version,
          notes,
        });
      } else if (status.state === "paused") {
        stopUpdateProgressPoll();
        publishUpdateStatus({
          state: "paused",
          version,
          notes,
          percent: status.percent,
          transferred: status.receivedBytes,
          total: status.totalBytes,
        });
      } else if (status.state === "interrupted") {
        stopUpdateProgressPoll();
        publishUpdateStatus({
          state: "error",
          message: status.failureReason || "The update download stopped unexpectedly.",
        });
      }
    } catch (error) {
      stopUpdateProgressPoll();
      publishUpdateStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Could not query update download status.",
      });
    }
  }, 350);
}

/**
 * Checks GitHub Releases for updates and discovers any attached APK asset.
 */
async function checkForAndroidUpdates(): Promise<UpdateStatus> {
  publishUpdateStatus({ state: "checking" });

  let current = "";
  try {
    current = (await CapApp.getInfo()).version;
  } catch {
    const fallback: UpdateStatus = {
      state: "unsupported",
      message: "Open the releases page to see whether a newer version is available.",
      releaseUrl: RELEASES_URL,
    };
    publishUpdateStatus(fallback);
    return fallback;
  }

  try {
    const response = await fetch("https://api.github.com/repos/ELhadratiOth/InfinityPlay/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

    const release = (await response.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      body?: string;
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    };
    const latestRaw = (release.tag_name || release.name || "").trim();
    if (!latestRaw) {
      const fallback: UpdateStatus = {
        state: "unsupported",
        message: "The latest release could not be identified. Open the releases page to check.",
        releaseUrl: RELEASES_URL,
      };
      publishUpdateStatus(fallback);
      return fallback;
    }

    const latestClean = latestRaw.replace(/^v/i, "");
    const releaseUrl = release.html_url || RELEASES_URL;
    const notes = release.body?.trim() || undefined;
    const apkAsset = release.assets?.find((asset) => asset.name.toLowerCase().endsWith(".apk"));

    latestDiscoveredRelease = {
      version: latestClean,
      notes,
      apkUrl: apkAsset?.browser_download_url,
      releaseUrl,
    };

    if (isNewer(latestClean, current)) {
      if (apkAsset) {
        // Check if an existing APK was already downloaded for this version
        try {
          const nativeStatus = await nativeUpdater.status();
          if (nativeStatus.state === "completed" && nativeStatus.filePath.includes(latestClean)) {
            const downloadedStatus: UpdateStatus = {
              state: "downloaded",
              version: latestClean,
              notes,
            };
            publishUpdateStatus(downloadedStatus);
            return downloadedStatus;
          }
        } catch {
          // Status check fallback
        }

        const availableStatus: UpdateStatus = {
          state: "available",
          version: latestClean,
          notes,
        };
        publishUpdateStatus(availableStatus);
        return availableStatus;
      }

      const unsupportedStatus: UpdateStatus = {
        state: "unsupported",
        version: latestClean,
        message: `Version ${latestClean} is available. Open the release page to download and install it.`,
        releaseUrl,
      };
      publishUpdateStatus(unsupportedStatus);
      return unsupportedStatus;
    }

    const upToDateStatus: UpdateStatus = {
      state: "up-to-date",
      version: current,
    };
    publishUpdateStatus(upToDateStatus);
    return upToDateStatus;
  } catch (error) {
    const errorStatus: UpdateStatus = {
      state: "error",
      message: `Could not reach GitHub Releases (${error instanceof Error ? error.message : "network error"}).`,
    };
    publishUpdateStatus(errorStatus);
    return errorStatus;
  }
}

async function startAndroidUpdateDownload(): Promise<boolean> {
  if (!latestDiscoveredRelease?.apkUrl) {
    await checkForAndroidUpdates();
    if (!latestDiscoveredRelease?.apkUrl) return false;
  }

  const { version, notes, apkUrl } = latestDiscoveredRelease;

  if (currentUpdateStatus.state === "paused" && activeUpdateJobId) {
    try {
      const { ok } = await nativeUpdater.resume({ id: activeUpdateJobId });
      if (ok) {
        publishUpdateStatus({
          state: "downloading",
          version,
          notes,
          percent: ("percent" in currentUpdateStatus ? currentUpdateStatus.percent : 0),
          transferred: ("transferred" in currentUpdateStatus ? currentUpdateStatus.transferred : 0),
          total: ("total" in currentUpdateStatus ? currentUpdateStatus.total : 0),
        });
        startUpdateProgressPoll(version, notes);
        return true;
      }
    } catch {
      // Fall through to start fresh
    }
  }

  try {
    const { id } = await nativeUpdater.start({
      url: apkUrl,
      version,
      filename: `InfinityPlay-${version}.apk`,
    });
    activeUpdateJobId = id;
    publishUpdateStatus({
      state: "downloading",
      version,
      notes,
      percent: 0,
      transferred: 0,
      total: 0,
    });
    startUpdateProgressPoll(version, notes);
    return true;
  } catch (error) {
    publishUpdateStatus({
      state: "error",
      message: error instanceof Error ? error.message : "Failed to start update download.",
    });
    return false;
  }
}

async function pauseAndroidUpdateDownload(): Promise<boolean> {
  if (currentUpdateStatus.state !== "downloading") return false;
  stopUpdateProgressPoll();
  try {
    const { ok } = await nativeUpdater.pause({ id: activeUpdateJobId ?? undefined });
    const version = latestDiscoveredRelease?.version ?? "";
    const notes = latestDiscoveredRelease?.notes;
    const previous = currentUpdateStatus.state === "downloading" ? currentUpdateStatus : null;
    publishUpdateStatus({
      state: "paused",
      version,
      notes,
      percent: previous?.percent ?? 0,
      transferred: previous?.transferred ?? 0,
      total: previous?.total ?? 0,
    });
    return ok;
  } catch {
    return false;
  }
}

async function declineAndroidUpdate(): Promise<boolean> {
  if (currentUpdateStatus.state === "downloading") {
    await pauseAndroidUpdateDownload();
  }
  const version =
    latestDiscoveredRelease?.version ||
    ("version" in currentUpdateStatus && currentUpdateStatus.version ? currentUpdateStatus.version : "");
  const notes = latestDiscoveredRelease?.notes;
  publishUpdateStatus({ state: "declined", version, notes });
  return true;
}

async function installAndroidUpdate(): Promise<boolean> {
  stopUpdateProgressPoll();
  try {
    const { ok } = await nativeUpdater.install();
    return ok;
  } catch (error) {
    publishUpdateStatus({
      state: "error",
      message: error instanceof Error ? error.message : "Failed to launch package installer.",
    });
    return false;
  }
}

/**
 * The address to actually fetch for an offline copy.
 *
 * An adaptive quality is a DASH manifest, not a file. The desktop app muxes one into an MP4 with
 * FFmpeg; Android has no FFmpeg, so saving the manifest produced a few kilobytes of XML named
 * `.mp4` that no player would open. A progressive release of the same title is a real file, so the
 * download quietly uses that instead — and says so plainly when the title has none.
 */
async function downloadableUrl(request: DownloadRequest): Promise<string> {
  if (request.sourceKind !== "dash") return request.url;
  // Free-media and IPTV downloads have no catalog subject to look a substitute up against.
  if (!request.subjectId) return request.url;

  const releases = await moviebox.releases(request.subjectId, request.season, request.episode);
  const progressive =
    releases.find((release) => release.kind !== "dash" && release.resolution === request.resolution)
    ?? releases.find((release) => release.kind !== "dash");

  if (!progressive) {
    throw new Error("This title is only offered as an adaptive stream, which this device cannot save as a file.");
  }
  return progressive.url;
}

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
      /*
       * Transfers live in the app process, so a record saved before a restart has no job behind it
       * any more and the plugin answers "not found". Left alone it would sit at its old percentage
       * for ever with no control that does anything, so it is marked interrupted and the title page
       * can start it again — the partial file is still on disk and will be resumed from.
       */
      const orphaned: DownloadRecord = {
        ...record,
        state: "interrupted",
        failureReason: "This download stopped when the app closed. Start it again to continue.",
      };
      anyChanged = true;
      notifyDownloadProgress(orphaned);
      return orphaned;
    }
  }));
  if (anyChanged) await saveStoredDownloads(updated);
  return updated;
}

/** Reflects a pause or resume immediately, rather than waiting for the next poll to notice. */
async function markDownloadState(id: string, state: DownloadRecord["state"]): Promise<void> {
  const records = await getStoredDownloads();
  const updated = records.map((record) => (record.id === id ? { ...record, state } : record));
  await saveStoredDownloads(updated);
  const changed = updated.find((record) => record.id === id);
  if (changed) notifyDownloadProgress(changed);
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

  // Check for updates shortly after launch, matching desktop behavior
  setTimeout(() => {
    void checkForAndroidUpdates().catch(() => undefined);
  }, 8_000);

  return {
    catalog: {
      homeSections: () => wrapResult(async () => moviebox.homeSections()),
      homeSection: (index: number) => wrapResult(() => moviebox.homeSection(index)),
      anime: (page = 1) => wrapResult(() => moviebox.anime(page)),
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
      playlist: (source, forceRefresh = false) =>
        wrapResult(() => fetchPlaylist(source, forceRefresh)),
      epg: (url, channelIds) => wrapResult(() => fetchEpg(url, channelIds)),
      xtream: (source) => wrapResult(() => fetchXtreamChannels(source)),
      xtreamEpg: (source, channelIds) => wrapResult(() => fetchXtreamEpg(source, channelIds)),
    },
    freeMedia: {
      browse: (provider: FreeMediaProvider, page = 1) =>
        wrapResult(() => browseFreeMedia(provider, page)),
      search: (provider: FreeMediaProvider, query: string, page = 1) =>
        wrapResult(() => searchFreeMedia(provider, query, page)),
      details: (provider: FreeMediaProvider, id: string) =>
        wrapResult(() => freeMediaDetails(provider, id)),
    },
    availability: {
      title: (title, mediaType) => wrapResult(async () => {
        const config = await getStoredConfig();
        return findWatchAvailability(title, mediaType, config.tmdbReadToken, config.watchRegion);
      }),
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
    watchLater: {
      list: () => wrapResult(() => getStoredWatchLater()),
      toggle: (item: CatalogItem) =>
        wrapResult(async () => {
          const queue = await getStoredWatchLater();
          const exists = queue.some((entry) => entry.id === item.id);
          return saveStoredWatchLater(
            exists
              ? queue.filter((entry) => entry.id !== item.id)
              : [{ ...item, addedAt: Date.now() }, ...queue],
          );
        }),
      clear: () => wrapResult(() => saveStoredWatchLater([])),
    },
    downloads: {
      start: (request: DownloadRequest) =>
        wrapResult(async () => {
          const downloads = await getStoredDownloads();
          const episodeSuffix = request.season > 0
            ? `-S${String(request.season).padStart(2, "0")}E${String(request.episode).padStart(2, "0")}`
            : "";
          const filename = `${request.title}${episodeSuffix}-${request.resolution || "auto"}p.mp4`;
          const url = await downloadableUrl(request);
          const { id } = await nativeDownloads.start({ url, title: filename });
          const record: DownloadRecord = {
            ...request,
            url,
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
      pause: (id: string) =>
        wrapResult(async () => {
          const { ok } = await nativeDownloads.pause({ id });
          if (ok) await markDownloadState(id, "paused");
          return ok
            ? { ok: true }
            : { ok: false, reason: "This download has already finished or stopped." };
        }),
      resume: (id: string) =>
        wrapResult(async () => {
          const { ok } = await nativeDownloads.resume({ id });
          if (ok) await markDownloadState(id, "progressing");
          return ok
            ? { ok: true }
            : { ok: false, reason: "This download is not paused." };
        }),
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
            runtime: "android",
            buildNumber: nativeInfo.build,
            electron: "",
            chrome: "",
            node: "",
            platform: "Android",
            packageType: "Android APK / App Bundle",
            updatable: true,
            ffmpeg: false,
            ffmpegVersion: "",
            gpu: "",
          };
        }),
    },
    cast: {
      discover: () => wrapResult(androidDiscover),
      start: (request) => wrapResult(() => androidStartCast(request)),
      play: () => wrapResult(androidCastPlay),
      pause: () => wrapResult(androidCastPause),
      seek: (seconds) => wrapResult(() => androidCastSeek(seconds)),
      setVolume: (level) => wrapResult(() => androidCastVolume(level)),
      stop: () => wrapResult(androidCastStop),
      session: () => wrapResult(async () => androidCastSession()),
      onSession: androidOnCastSession,
    },
    updates: {
      status: () => wrapResult(async (): Promise<UpdateStatus> => currentUpdateStatus),
      check: () => wrapResult(checkForAndroidUpdates),
      download: () => wrapResult(startAndroidUpdateDownload),
      pause: () => wrapResult(pauseAndroidUpdateDownload),
      decline: () => wrapResult(declineAndroidUpdate),
      install: () => wrapResult(installAndroidUpdate),
      onStatus: (listener: (status: UpdateStatus) => void) => {
        updateListeners.add(listener);
        listener(currentUpdateStatus);
        return () => {
          updateListeners.delete(listener);
        };
      },
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
