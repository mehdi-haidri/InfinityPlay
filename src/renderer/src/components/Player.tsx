import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { MediaPlayer, type MediaPlayerClass } from "dashjs";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  Captions,
  Check,
  ChevronLeft,
  Maximize,
  Minimize,
  Minus,
  Pause,
  PictureInPicture,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Settings2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  SUBTITLE_COLORS,
  SUBTITLE_FONT_FAMILIES,
  SUBTITLE_EDGE_STYLES,
  SUBTITLE_OFF,
  type Release,
  type PreparedLiveStream,
  type SubtitleOption,
  type SubtitleFontFamily,
  type SubtitleEdgeStyle,
} from "@shared/types";
import { api, unwrap } from "../lib/api";
import { nativePlayer } from "../lib/capacitorApi";
import { formatTime, qualityLabel } from "../lib/format";
import { registerStreamSignature } from "../lib/streamSigner";
import { useApp } from "../store";

interface VttCue {
  start: number;
  end: number;
  text: string;
}

function parseVttTime(timeStr: string): number {
  const parts = timeStr.trim().replace(",", ".").split(":");
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(timeStr) || 0;
}

function parseVttCues(vttText: string): VttCue[] {
  if (!vttText) return [];
  const cues: VttCue[] = [];
  const blocks = vttText.replace(/^WEBVTT[^\n]*\n/i, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^([\d:.ms,]+)\s*-->\s*([\d:.ms,]+)/);
      if (match) {
        const start = parseVttTime(match[1]);
        const end = parseVttTime(match[2]);
        const text = lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").trim();
        if (text && end > start) {
          cues.push({ start, end, text });
        }
        break;
      }
    }
  }
  return cues;
}

function decodeBase64Utf8(dataUrl: string): string {
  try {
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

const IDLE_MS = 2600;
const SEEK_STEP = 10;
const PROGRESS_SAVE_MS = 5000;

type MenuTab = "quality" | "subtitles" | "subtitle-style" | null;
type VideoFit = "contain" | "cover" | "fill";

/**
 * Full HEVC codec strings to try, widest first. Chromium answers `isTypeSupported` on the
 * exact string, so the level has to be one this machine's decoder accepts.
 */
const HEVC_CODEC_CANDIDATES = ["1.6.L153.B0", "1.6.L150.90", "1.6.L120.90", "1.6.L93.B0"];

/**
 * Repairs a DASH manifest that declares an incomplete video codec.
 *
 * Some of the catalog's `index.mpd` files carry `codecs="hev1"` with no profile or level.
 * Chromium rejects that exact string — `MediaSource.isTypeSupported('…codecs="hev1"')` is
 * false while `hev1.1.6.L120.90` is true — so dash.js discards every video representation
 * and reports the whole stream as unavailable. The titles that play declare the full
 * string in an `index_web.mpd`, which these assets do not have.
 *
 * The manifest is rewritten with a codec string this machine accepts and an absolute
 * `BaseURL`, then staged by the main process. It cannot be handed over as a blob or data
 * URL: this window is a `file://` page, and Chromium refuses those as opaque-origin reads
 * — dash.js's XHR fails before it parses anything. Segments still resolve to the CDN,
 * where the main process re-attaches the CloudFront signature.
 *
 * Returns a URL for the repaired manifest, or null when none is needed.
 */
async function repairDashManifest(manifestUrl: string): Promise<string | null> {
  const incomplete = /codecs="(hev1|hvc1)"/;
  // Bounded: this probe sits in front of playback, so a manifest request that stalls must
  // not leave the player waiting with no picture and no error. On timeout the original
  // URL is used and dash.js reports anything genuinely wrong.
  let xml = "";
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url: manifestUrl, readTimeout: 6000, connectTimeout: 6000 });
    if (response.status < 200 || response.status >= 300) return null;
    xml = typeof response.data === "string" ? response.data : String(response.data ?? "");
  } else {
    const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    xml = await response.text();
  }
  const match = xml.match(incomplete);
  if (!match) return null;

  const family = match[1];
  const codec = HEVC_CODEC_CANDIDATES.map((suffix) => `${family}.${suffix}`).find((candidate) =>
    MediaSource.isTypeSupported(`video/mp4; codecs="${candidate}"`),
  );
  if (!codec) return null;

  let patched = xml.replace(new RegExp(`codecs="${family}"`, "g"), `codecs="${codec}"`);

  // Relative segment paths would otherwise resolve against the blob URL or local proxy.
  if (!/<BaseURL>/i.test(patched)) {
    const url = new URL(manifestUrl);
    const directory = `${url.origin}${url.pathname.replace(/[^/]+$/, "")}`;
    patched = patched.replace(/(<MPD\b[^>]*>)/i, `$1<BaseURL>${directory}</BaseURL>`);
  }

  // Ensure segment templates inherit the CloudFront signature parameters
  const parsed = new URL(manifestUrl);
  const query = parsed.search.slice(1).replace(/&/g, "&amp;");
  if (query) {
    patched = patched.replace(
      /\b(initialization|sourceURL|media|url)="([^"]+)"/gi,
      (_match, name: string, value: string) =>
        `${name}="${value}${value.includes("?") ? "&amp;" : "?"}${query}"`,
    );
  }

  // On Capacitor Android, we are on http://localhost or https://localhost, NOT file://.
  // We use a Data URL because CapacitorHttp (which we need for CORS) intercepts and breaks Blob URLs.
  if (typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.()) {
    return `data:application/dash+xml;charset=utf-8,${encodeURIComponent(patched)}`;
  }

  return unwrap(api.media.stageManifest(patched));
}

export function Player() {
  const request = useApp((state) => state.player);
  const closePlayer = useApp((state) => state.closePlayer);
  const openPlayer = useApp((state) => state.openPlayer);
  const notify = useApp((state) => state.notify);
  const config = useApp((state) => state.config);
  const patchConfig = useApp((state) => state.patchConfig);
  const saveProgress = useApp((state) => state.saveProgress);

  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsRetryTimer = useRef<number | undefined>(undefined);
  const dashRef = useRef<MediaPlayerClass | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const lastSaved = useRef(0);
  const draggingScrub = useRef(false);
  const previewRequest = useRef(0);
  const previewCache = useRef(new Map<string, string | null>());
  const androidFallbackTried = useRef(false);
  const nativeLaunch = useRef("");

  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedSourceUrl, setSelectedSourceUrl] = useState("");
  const [selectedResolution, setSelectedResolution] = useState(0);
  const [activeRelease, setActiveRelease] = useState<Release | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(config.volume);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [idle, setIdle] = useState(false);
  const [menu, setMenu] = useState<MenuTab>(null);
  const [subtitle, setSubtitle] = useState<{
    name: string;
    lang: string;
    dataUrl: string;
    vttText?: string;
  } | null>(null);
  const subPosition = config.subtitlePosition === "top" ? 28 : config.subtitlePosition === "middle" ? 54 : 86;
  const [videoFit, setVideoFit] = useState<VideoFit>("contain");
  const [sleepMinutes, setSleepMinutes] = useState(0);

  const cues = useMemo(() => {
    if (!subtitle?.vttText) return [];
    return parseVttCues(subtitle.vttText);
  }, [subtitle?.vttText]);

  const activeCueText = useMemo(() => {
    if (cues.length === 0) return null;
    const match = cues.find((cue) => current >= cue.start && current <= cue.end);
    return match ? match.text : null;
  }, [cues, current]);

  const [trackCueText, setTrackCueText] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !subtitle) {
      setTrackCueText(null);
      return;
    }

    const onCueChange = () => {
      let activeText: string | null = null;
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.activeCues && track.activeCues.length > 0) {
          activeText = Array.from(track.activeCues)
            .map((c: any) => c.text)
            .join("\n")
            .replace(/<[^>]+>/g, "")
            .trim();
          break;
        }
      }
      setTrackCueText(activeText);
    };

    const interval = setInterval(onCueChange, 200);
    return () => clearInterval(interval);
  }, [subtitle, sourceUrl]);

  const displayCueText = trackCueText || activeCueText;
  const [fullscreen, setFullscreen] = useState(false);
  const [hint, setHint] = useState<{ id: number; icon: "play" | "pause" } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [prepared, setPrepared] = useState<PreparedLiveStream | null>(null);
  const [playbackOffset, setPlaybackOffset] = useState(0);
  const [startPosition, setStartPosition] = useState<number | null>(0);
  const [scrubPreview, setScrubPreview] = useState<number | null>(null);
  const [scrubHover, setScrubHover] = useState<{ position: number; left: number } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewBucket = scrubHover
    ? Math.max(0, Math.round(scrubHover.position / 5) * 5)
    : null;

  const releases = useMemo(() => request?.releases ?? [], [request]);
  const isNativeAndroidVod = Capacitor.getPlatform() === "android" && Boolean(request && !request.live);

  /**
   * `::cue` cannot be styled inline and does not read CSS custom properties in Chromium,
   * so the rule is generated with literal values whenever the settings change.
   */
  const cueCss = useMemo(() => {
    return `.player-root video::cue {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      font-size: 0 !important;
      color: transparent !important;
      background: transparent !important;
      text-shadow: none !important;
    }`;
  }, []);
  const subtitles = useMemo(() => request?.subtitles ?? [], [request]);

  // Reset the player before resolving a source. A saved position is handled inside the
  // player, so the user can choose without a browser-style alert interrupting the app.
  useEffect(() => {
    if (!request) return;
    setSourceUrl("");
    setSelectedSourceUrl(request.url);
    setSelectedResolution(request.resolution ?? 0);
    setPrepared(null);
    setPlaybackOffset(0);
    const saved = request.startAt ?? 0;
    setStartPosition(
      saved > 30 && config.resumeBehavior === "ask"
        ? null
        : config.resumeBehavior === "restart"
          ? 0
          : saved,
    );
    setWaiting(false);
    setPlaybackError(null);
    setActiveRelease(
      releases.find(
        (release) => release.url === request.url && (!request.resolution || release.resolution === request.resolution),
      ) ?? null,
    );
    setSubtitle(null);
    setCurrent(saved > 30 && config.resumeBehavior !== "restart" ? saved : 0);
    setDuration(0);
    setScrubPreview(null);
    setScrubHover(null);
    setPreviewImage(null);
    previewCache.current.clear();
    lastSaved.current = 0;
    androidFallbackTried.current = false;
    // Request identity is intentionally the media URL; metadata updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.url]);

  // Android WebView rejects some HEVC/H.265 catalog MP4s with a format error even
  // though the device has a native decoder. Keep IPTV in the web player, but hand
  // on-demand Movies and Series to Media3 and write its final position to history.
  useEffect(() => {
    if (!request || !isNativeAndroidVod || nativeLaunch.current === request.url) return;
    nativeLaunch.current = request.url;
    let cancelled = false;
    const savedPosition = config.resumeBehavior === "restart" ? 0 : Math.max(0, request.startAt ?? 0);

    void nativePlayer.open({
      url: request.url,
      title: request.subtitleLine ? `${request.title} · ${request.subtitleLine}` : request.title,
      positionMs: Math.round(savedPosition * 1000),
      subtitlesJson: JSON.stringify(
        (request.subtitles ?? []).map(({ name, lang, url }) => ({ name, lang, url })),
      ),
    }).then((result) => {
      if (cancelled) return;
      const position = Math.max(0, result.positionMs / 1000);
      const total = Math.max(0, result.durationMs / 1000);
      if (request.subjectId && total > 0) {
        void saveProgress({
          provider: "moviebox",
          subjectId: request.subjectId,
          title: request.title,
          posterUrl: request.posterUrl,
          mediaType: request.mediaType ?? "movie",
          year: request.year ?? "",
          season: request.season ?? 0,
          episode: request.episode ?? 0,
          position: result.ended ? total : position,
          duration: total,
          timestamp: Date.now(),
        });
      }
      if (result.error) {
        notify({
          kind: "error",
          title: "Android playback stopped",
          body: result.error,
        });
      }
      closePlayer();
    }).catch((error) => {
      if (cancelled) return;
      nativeLaunch.current = "";
      notify({
        kind: "error",
        title: "Could not open Android player",
        body: error instanceof Error ? error.message : String(error),
      });
      closePlayer();
    });

    return () => {
      cancelled = true;
    };
  }, [request, isNativeAndroidVod, config.resumeBehavior, saveProgress, notify, closePlayer]);

  // Netflix-style hover frames are generated lazily and bucketed every five seconds.
  // The debounce prevents pointer movement from starting an FFmpeg process per pixel.
  useEffect(() => {
    if (!scrubHover || !selectedSourceUrl || request?.live) {
      setPreviewImage(null);
      setPreviewLoading(false);
      return;
    }
    const bucket = previewBucket ?? 0;
    const key = `${selectedSourceUrl}|${selectedResolution}|${bucket}`;
    if (previewCache.current.has(key)) {
      setPreviewImage(previewCache.current.get(key) ?? null);
      setPreviewLoading(false);
      return;
    }

    setPreviewImage(null);
    
    if (typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.()) {
      setPreviewLoading(false);
      return;
    }

    const sequence = ++previewRequest.current;
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      unwrap(api.media.preview(selectedSourceUrl, bucket, selectedResolution))
        .then((image) => {
          if (previewRequest.current !== sequence) return;
          previewCache.current.set(key, image);
          while (previewCache.current.size > 48) {
            const oldest = previewCache.current.keys().next().value;
            if (oldest === undefined) break;
            previewCache.current.delete(oldest);
          }
          setPreviewImage(image);
        })
        .catch(() => {
          if (previewRequest.current === sequence) setPreviewImage(null);
        })
        .finally(() => {
          if (previewRequest.current === sequence) setPreviewLoading(false);
        });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      previewRequest.current += 1;
    };
  }, [previewBucket, selectedSourceUrl, selectedResolution, request?.live]);

  // Probe the selected source. Unsupported x265/MPEG-2 streams become a private H.264
  // compatibility stream; its start offset makes that stream seekable from the UI.
  useEffect(() => {
    if (!request || isNativeAndroidVod || !selectedSourceUrl || startPosition === null) return;
    let cancelled = false;
    setWaiting(true);
    unwrap(api.media.prepareLive(selectedSourceUrl, startPosition, selectedResolution))
      .then((prepared) => {
        if (cancelled) return;
        setPrepared(prepared);
        setPlaybackOffset(prepared.transcoded ? startPosition : 0);
        setDuration(prepared.duration ?? 0);
        setCurrent(startPosition);
        setSourceUrl(prepared.url);
        if (prepared.warning) {
          notify({
            kind: "info",
            title: prepared.transcoded ? "Compatibility playback" : "Video codec warning",
            body: prepared.warning,
          });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setPrepared({ url: selectedSourceUrl, transcoded: false });
        setPlaybackOffset(0);
        setSourceUrl(selectedSourceUrl);
        notify({
          kind: "error",
          title: "Could not inspect the video codec",
          body: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        if (!cancelled) setWaiting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request, isNativeAndroidVod, selectedSourceUrl, selectedResolution, startPosition, notify, retryNonce]);

  /**
   * Turns on the requested subtitle once a new source is up. Declared after the reset
   * effect on purpose — effects run in order, so this lands on top of the clean slate.
   * Silent when the wanted language is not among this episode's captions.
   */
  useEffect(() => {
    if (!request) return;
    const wanted = request.initialSubtitle ?? config.preferredSubtitle;
    if (!wanted || wanted === SUBTITLE_OFF) return;

    const target = wanted.toLowerCase();
    const match = (request.subtitles ?? []).find(
      (option) =>
        option.lang.toLowerCase() === target ||
        option.name.toLowerCase() === target ||
        option.nativeName.toLowerCase() === target,
    );
    if (!match) return;

    let cancelled = false;
    unwrap(api.subtitle.load(match.url))
      .then((dataUrl) => {
        if (cancelled) return;
        let vttText = "";
        try {
          if (dataUrl.startsWith("data:text/vtt;charset=utf-8;base64,")) {
            vttText = decodeURIComponent(escape(atob(dataUrl.split(",")[1])));
          }
        } catch {
          /* ignore */
        }
        setSubtitle({ name: match.name, lang: match.lang, dataUrl, vttText });
      })
      .catch(() => {
        // A missing caption file is not worth interrupting playback for.
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.url]);

  /**
   * Three source shapes: HLS for live channels, DASH for the adaptive catalog stream
   * (the only place 720p/1080p still exist), and a plain progressive file for everything
   * else. Segment signing for DASH is handled in the main process.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isNativeAndroidVod || !sourceUrl) return;

    hlsRef.current?.destroy();
    hlsRef.current = null;
    window.clearTimeout(hlsRetryTimer.current);
    dashRef.current?.destroy();
    dashRef.current = null;

    let cancelled = false;

    const isHls = /\.m3u8(\?|$)/i.test(sourceUrl);
    const isDash = /\.mpd(\?|$)/i.test(sourceUrl);

    if (isHls && Capacitor.isNativePlatform()) {
      // Android's media stack can fetch HLS without WebView XHR/CORS restrictions.
      // Feeding the same URL to hls.js causes manifestLoadError on many public CDNs.
      video.src = sourceUrl;
      video.play().catch(() => setPlaying(false));
    } else if (isHls && Hls.isSupported()) {
      let networkRetries = 0;
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: request?.live === true,
        backBufferLength: request?.live ? 30 : 90,
        maxBufferLength: request?.live ? 30 : 60,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 800,
        manifestLoadingMaxRetryTimeout: 8000,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 5,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.loadSource(sourceUrl);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 2) {
          networkRetries += 1;
          window.clearTimeout(hlsRetryTimer.current);
          hlsRetryTimer.current = window.setTimeout(() => {
            if (cancelled) return;
            hls.loadSource(sourceUrl);
            hls.startLoad();
          }, networkRetries * 1200);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        setWaiting(false);
        setPlaybackError(
          data.details === "manifestLoadError"
            ? "This channel's playlist could not be reached. It may be offline, expired, or blocking this network."
            : `The live stream stopped: ${data.details}.`,
        );
      });
    } else if (isDash) {
      void startDash(video);
    } else {
      video.src = sourceUrl;
      video.play().catch(() => setPlaying(false));
    }

    /**
     * DASH start-up is async because a manifest may need repairing first. `cancelled`
     * guards the gap: the effect can be torn down while that fetch is in flight.
     */
    async function startDash(media: HTMLVideoElement) {
      let manifestUrl = sourceUrl;
      try {
        const repaired = await repairDashManifest(sourceUrl);
        if (repaired) manifestUrl = repaired;
      } catch {
        // Fall back to the original manifest; dash.js reports the failure if it is fatal.
      }
      if (cancelled) return;

      const player = MediaPlayer().create();
      dashRef.current = player;

      try {
        const parsed = new URL(sourceUrl);
        const query = parsed.search.slice(1);
        if (query && query.includes("Policy=")) {
          registerStreamSignature(sourceUrl, query);
          player.extend(
            "RequestModifier",
            function () {
              return {
                modifyRequestHeader: (xhr: any) => xhr,
                modifyRequestURL: (url: string) => {
                  if (!url || url.startsWith("data:") || url.includes("Policy=")) return url;
                  const separator = url.includes("?") ? "&" : "?";
                  return `${url}${separator}${query}`;
                },
              };
            },
            true,
          );
        }
      } catch {
        // Invalid URL ignore
      }

      const requestedHeight = activeRelease?.kind === "dash" ? activeRelease.resolution : 0;
      player.updateSettings({
        streaming: {
          // A selected quality is the preferred start, not a permanent bandwidth trap.
          // Keeping ABR available lets desktop playback step down before it stalls.
          abr: { autoSwitchBitrate: { video: true } },
          buffer: {
            fastSwitchEnabled: false,
            bufferTimeDefault: 24,
            bufferTimeAtTopQuality: 36,
            bufferTimeAtTopQualityLongForm: 48,
          },
        },
      });
      if (requestedHeight > 0) {
        // Applied once. `setRepresentationForTypeById` re-fires STREAM_INITIALIZED, so a
        // handler that pins the quality every time it runs restarts the stream forever —
        // playback drops out and comes back every few seconds. `forceReplace` is off for
        // the same reason: it discards the buffer, which is the visible stall.
        let pinned = false;
        const pinQuality = () => {
          if (pinned) return;
          const choices = player.getRepresentationsByType("video");
          const exact = choices.find((choice) => choice.height === requestedHeight);
          if (!exact) return;
          pinned = true;
          player.off(MediaPlayer.events.STREAM_INITIALIZED, pinQuality);
          player.setRepresentationForTypeById("video", exact.id, false);
        };
        player.on(MediaPlayer.events.STREAM_INITIALIZED, pinQuality);
      }
      player.on(MediaPlayer.events.ERROR, (event: any) => {
        // dash.js reports recoverable problems here too — a segment it retried, a
        // representation it dropped. Reporting those interrupts a stream that is still
        // playing, so the toast is kept for failures the viewer can actually see.
        if (media.readyState >= 3 && !media.error) return;
        notify({
          kind: "error",
          title: "Stream error",
          body: event?.error?.message ?? "The adaptive stream could not be played.",
        });
      });
      player.initialize(media, manifestUrl, true);
      media.play().catch(() => setPlaying(false));
    }

    return () => {
      cancelled = true;
      window.clearTimeout(hlsRetryTimer.current);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      dashRef.current?.destroy();
      dashRef.current = null;
    };
  }, [sourceUrl, request?.live, isNativeAndroidVod, notify]);

  useEffect(() => {
    if (sleepMinutes <= 0 || !request) return;
    const timer = window.setTimeout(() => {
      videoRef.current?.pause();
      setSleepMinutes(0);
      notify({ kind: "info", title: "Sleep timer", body: "Playback paused." });
    }, sleepMinutes * 60_000);
    return () => window.clearTimeout(timer);
  }, [sleepMinutes, request, notify]);

  const persistProgress = useCallback(
    (position: number, total: number, force = false) => {
      if (!request || request.live || !request.subjectId) return;
      if (!force && Date.now() - lastSaved.current < PROGRESS_SAVE_MS) return;
      lastSaved.current = Date.now();
      void saveProgress({
        provider: "moviebox",
        subjectId: request.subjectId,
        title: request.title,
        posterUrl: request.posterUrl,
        mediaType: request.mediaType ?? "movie",
        year: request.year ?? "",
        season: request.season ?? 0,
        episode: request.episode ?? 0,
        position,
        duration: total,
        timestamp: Date.now(),
      });
    },
    [request, saveProgress],
  );

  const seekTo = useCallback(async (position: number) => {
    const video = videoRef.current;
    if (!video || !request || duration <= 0) return;
    const target = Math.min(Math.max(position, 0), duration);
    setCurrent(target);
    setScrubPreview(null);

    if (!prepared?.transcoded) {
      video.currentTime = target;
      return;
    }

    setWaiting(true);
    setStartPosition(target);
  }, [duration, prepared?.transcoded, request]);

  /**
   * Rolls the player straight into the next episode of the same season when the
   * `autoplayNext` setting is on. Silent when there is no next episode or no source.
   */
  const playAdjacentEpisode = useCallback(async (step: -1 | 1, autoplay = false) => {
    if (!request || request.live || (autoplay && !config.autoplayNext)) return;
    const { subjectId, season: currentSeason, episode: currentEpisode, episodeCount } = request;
    if (!subjectId || !currentSeason || !currentEpisode || !episodeCount) return;
    const targetEpisode = currentEpisode + step;
    if (targetEpisode < 1 || targetEpisode > episodeCount) return;

    try {
      setWaiting(true);
      const nextReleases = await unwrap(api.catalog.releases(subjectId, currentSeason, targetEpisode));
      if (nextReleases.length === 0) return;

      const chosen =
        nextReleases.find((release) => release.resolution === activeRelease?.resolution) ??
        nextReleases[0];
      const nextSubtitles = chosen.resourceId
        ? await unwrap(api.catalog.subtitles(subjectId, chosen.resourceId)).catch(() => [])
        : [];

      openPlayer({
        ...request,
        subtitleLine: `Season ${currentSeason} · Episode ${targetEpisode} · ${qualityLabel(chosen.resolution)}`,
        url: chosen.url,
        resolution: chosen.resolution,
        resourceId: chosen.resourceId,
        episode: targetEpisode,
        startAt: 0,
        releases: nextReleases,
        subtitles: nextSubtitles,
      });
    } catch (error) {
      notify({
        kind: "error",
        title: `Could not start the ${step > 0 ? "next" : "previous"} episode`,
        body: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setWaiting(false);
    }
  }, [request, config.autoplayNext, activeRelease?.resolution, openPlayer, notify]);

  const playNextEpisode = useCallback(
    () => playAdjacentEpisode(1, true),
    [playAdjacentEpisode],
  );

  const close = useCallback(() => {
    const video = videoRef.current;
    if (video && duration > 0) persistProgress(playbackOffset + video.currentTime, duration, true);
    if (document.fullscreenElement) void document.exitFullscreen();
    closePlayer();
  }, [closePlayer, duration, persistProgress, playbackOffset]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setHint({ id: Date.now(), icon: "play" });
    } else {
      video.pause();
      setHint({ id: Date.now(), icon: "pause" });
    }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || duration <= 0) return;
    void seekTo((prepared?.transcoded ? playbackOffset + video.currentTime : video.currentTime) + delta);
  }, [duration, playbackOffset, prepared?.transcoded, seekTo]);

  const [orientationMode, setOrientationMode] = useState<"landscape" | "portrait" | "auto">("auto");

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setFullscreen(false);
    } else {
      await surfaceRef.current?.parentElement?.requestFullscreen().catch(() => undefined);
      setFullscreen(Boolean(document.fullscreenElement));
    }
  }, []);

  const toggleMobileOrientation = useCallback(async () => {
    const screenObj = window.screen as any;
    const isLandscape = orientationMode === "landscape";

    try {
      if (isLandscape) {
        setOrientationMode("portrait");
        if (screenObj?.orientation?.unlock) {
          try { screenObj.orientation.unlock(); } catch {}
        }
        if (document.fullscreenElement) {
          await document.exitFullscreen().catch(() => undefined);
          setFullscreen(false);
        }
      } else {
        setOrientationMode("landscape");
        if (!document.fullscreenElement && surfaceRef.current?.parentElement) {
          await surfaceRef.current.parentElement.requestFullscreen().catch(() => undefined);
          setFullscreen(true);
        }
        if (screenObj?.orientation?.lock) {
          await screenObj.orientation.lock("landscape").catch(() => undefined);
        }
      }
    } catch {
      void toggleFullscreen();
    }
  }, [orientationMode, toggleFullscreen]);

  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  useEffect(() => {
    if (!request) return;
    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [request, wake]);

  useEffect(() => {
    if (!request) return;
    const onBack = (event: Event) => {
      event.preventDefault();
      if (menu) setMenu(null);
      else close();
      wake();
    };
    window.addEventListener("infinityplay:back", onBack);
    return () => window.removeEventListener("infinityplay:back", onBack);
  }, [request, menu, close, wake]);

  // Keyboard shortcuts follow the usual video-player conventions.
  useEffect(() => {
    if (!request) return;

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(target.tagName)) return;

      switch (event.key) {
        case " ":
        case "k":
        case "MediaPlayPause":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          seekBy(SEEK_STEP);
          break;
        case "ArrowLeft":
          seekBy(-SEEK_STEP);
          break;
        case "ArrowUp":
          event.preventDefault();
          setVolume((value) => Math.min(1, value + 0.05));
          break;
        case "ArrowDown":
          event.preventDefault();
          setVolume((value) => Math.max(0, value - 0.05));
          break;
        case "m":
          setMuted((value) => !value);
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "Escape":
          if (document.fullscreenElement) void document.exitFullscreen();
          else close();
          break;
        default:
          return;
      }
      wake();
    };

    const isMobileTouch = window.matchMedia("(pointer: coarse)").matches && window.innerWidth <= 768;
    if (isMobileTouch) return;

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, togglePlay, seekBy, toggleFullscreen, close, wake]);

  useEffect(() => {
    if (!menu) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }, [menu]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    video.playbackRate = rate;
  }, [volume, muted, rate]);

  // Volume is a preference; persist it, but not on every drag frame.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (Math.abs(volume - config.volume) > 0.001) void patchConfig({ volume });
    }, 600);
    return () => clearTimeout(timer);
  }, [volume, config.volume, patchConfig]);

  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(null), 480);
    return () => clearTimeout(timer);
  }, [hint]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!request) return null;

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const fullDuration = prepared?.duration || video.duration || 0;
    setDuration(fullDuration);
    if (!prepared?.transcoded && (startPosition ?? 0) > 0 && fullDuration - (startPosition ?? 0) > 30) {
      video.currentTime = startPosition ?? 0;
    }
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrent(playbackOffset + video.currentTime);
    if (video.buffered.length > 0) {
      setBuffered(playbackOffset + video.buffered.end(video.buffered.length - 1));
    }
    persistProgress(playbackOffset + video.currentTime, duration || prepared?.duration || video.duration || 0);
  };

  const scrubPosition = (clientX: number, element: HTMLDivElement): number => {
    if (duration <= 0) return 0;
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return ratio * duration;
  };

  const scrubPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    draggingScrub.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const position = scrubPosition(event.clientX, event.currentTarget);
    const rect = event.currentTarget.getBoundingClientRect();
    setScrubPreview(position);
    setScrubHover({ position, left: Math.min(Math.max(event.clientX - rect.left, 0), rect.width) });
  };

  const scrubPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const position = scrubPosition(event.clientX, event.currentTarget);
    const rect = event.currentTarget.getBoundingClientRect();
    setScrubHover({ position, left: Math.min(Math.max(event.clientX - rect.left, 0), rect.width) });
    if (draggingScrub.current) setScrubPreview(position);
  };

  const scrubPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingScrub.current) return;
    draggingScrub.current = false;
    const position = scrubPosition(event.clientX, event.currentTarget);
    event.currentTarget.releasePointerCapture(event.pointerId);
    void seekTo(position);
  };

  const scrubKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next = current;
    switch (event.key) {
      case "ArrowLeft": next -= 5; break;
      case "ArrowRight": next += 5; break;
      case "PageDown": next -= 30; break;
      case "PageUp": next += 30; break;
      case "Home": next = 0; break;
      case "End": next = duration; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    void seekTo(next);
  };

  const menuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let target = index;
    if (event.key === "ArrowDown") target = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp") target = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = buttons.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    buttons[target]?.focus();
  };

  const playerRemoteKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (document.documentElement.dataset.device !== "tv" || menu) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(".player-chrome button:not(:disabled)"),
    ).filter((button) => button.offsetWidth > 0 && button.offsetHeight > 0);
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    event.preventDefault();
    event.stopPropagation();
    controls[(index + step + controls.length) % controls.length]?.focus();
  };

  const chooseRelease = async (release: Release) => {
    const video = videoRef.current;
    const resumeAt = prepared?.transcoded
      ? playbackOffset + (video?.currentTime ?? 0)
      : video?.currentTime ?? current;
    if (duration > 0) persistProgress(resumeAt, duration, true);
    setActiveRelease(release);
    setSelectedResolution(release.resolution);
    setMenu(null);
    setWaiting(true);
    setPlaybackError(null);
    if (release.kind === "dash" && release.url === selectedSourceUrl && dashRef.current) {
      const choices = dashRef.current.getRepresentationsByType("video");
      const exact = choices.find((choice) => choice.height === release.resolution);
      dashRef.current.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
      if (exact) dashRef.current.setRepresentationForTypeById("video", exact.id, false);
      setWaiting(false);
      return;
    }
    setSelectedSourceUrl(release.url);
    setStartPosition(resumeAt);
  };

  const chooseSubtitle = async (option: SubtitleOption | null) => {
    setMenu(null);
    if (!option) {
      setSubtitle(null);
      return;
    }
    try {
      const dataUrl = await unwrap(api.subtitle.load(option.url));
      let vttText = "";
      try {
        if (dataUrl.startsWith("data:text/vtt;charset=utf-8;base64,")) {
          vttText = decodeURIComponent(escape(atob(dataUrl.split(",")[1])));
        }
      } catch {
        /* ignore */
      }
      setSubtitle({ name: option.name, lang: option.lang, dataUrl, vttText });
    } catch (error) {
      notify({
        kind: "error",
        title: "Subtitle failed to load",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const handlePlaybackError = () => {
    setWaiting(false);
    const fallback = Capacitor.isNativePlatform() && !request.live && !androidFallbackTried.current
      ? releases.find(
          (release) =>
            release.kind !== "dash" &&
            (release.url !== activeRelease?.url || release.resolution !== activeRelease?.resolution),
        )
      : undefined;
    if (fallback) {
      androidFallbackTried.current = true;
      notify({
        kind: "info",
        title: "Trying an Android-compatible source",
        body: `${qualityLabel(fallback.resolution)} progressive playback`,
      });
      void chooseRelease(fallback);
      return;
    }
    setPlaybackError("The source rejected the request or this device cannot decode it.");
  };

  const displayedCurrent = scrubPreview ?? current;
  const playedRatio = duration > 0 ? displayedCurrent / duration : 0;
  const bufferedRatio = duration > 0 ? buffered / duration : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const alternateRelease = releases.find(
    (release) => release.url !== activeRelease?.url || release.resolution !== activeRelease?.resolution,
  );
  const isTouchInput = document.documentElement.dataset.input === "touch";
  const isTv = document.documentElement.dataset.device === "tv";
  const isPhone = document.documentElement.dataset.device === "phone";
  const pipAvailable = !isTv && !isPhone && Boolean(document.pictureInPictureEnabled && videoRef.current?.requestPictureInPicture);
  const subtitleScale = (config.subtitleSize ?? 100) / 100;

  return (
    <div className="player-root" data-device={document.documentElement.dataset.device} onKeyDownCapture={playerRemoteKeyDown}>
      <style>{cueCss}</style>
      <div
        className="player-surface"
        ref={surfaceRef}
        data-idle={idle && playing}
        onPointerMove={wake}
        onPointerDown={wake}
        onFocusCapture={wake}
        onClick={(event) => {
          if (event.target === event.currentTarget || (event.target as HTMLElement).tagName === "VIDEO") {
            if (isTouchInput) wake();
            else togglePlay();
          }
        }}
        onDoubleClick={(event) => {
          if (!isTouchInput) {
            void toggleFullscreen();
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          if (ratio < 0.4) seekBy(-SEEK_STEP);
          else if (ratio > 0.6) seekBy(SEEK_STEP);
          else togglePlay();
        }}
      >
        <video
          ref={videoRef}
          style={{ objectFit: videoFit }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onEnded={() => {
            persistProgress(duration, duration, true);
            setPlaying(false);
            void playNextEpisode();
          }}
          onError={handlePlaybackError}
          playsInline
        >
          {subtitle && (
            <track
              key={subtitle.dataUrl}
              kind="subtitles"
              src={subtitle.dataUrl}
              label={subtitle.name}
              srcLang={subtitle.lang || "und"}
              default
            />
          )}
        </video>

        {/* A fixed overlay avoids pointer movement changing a chosen subtitle position. */}
        {displayCueText && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: `${subPosition}%`,
              transform: "translate(-50%, -50%)",
              zIndex: 35,
              userSelect: "none",
              pointerEvents: "none",
            }}
            aria-live="off"
          >
            <div
              style={{
                fontSize: `clamp(${Math.round(16 * subtitleScale)}px, ${2.25 * subtitleScale}vmin, ${Math.round(40 * subtitleScale)}px)`,
                color: config.subtitleColor ?? "#ffffff",
                backgroundColor:
                  config.subtitleBackground === "box"
                    ? "rgba(0, 0, 0, 0.85)"
                    : config.subtitleBackground === "window"
                      ? "rgba(16, 18, 25, 0.95)"
                      : config.subtitleBackground === "semi-transparent"
                        ? "rgba(0, 0, 0, 0.45)"
                        : "transparent",
                padding: config.subtitleBackground !== "none" ? "4px 14px" : "0",
                borderRadius: 6,
                textAlign: "center",
                fontFamily:
                  config.subtitleFontFamily === "serif"
                    ? "Georgia, serif"
                    : config.subtitleFontFamily === "monospace"
                      ? "'Courier New', monospace"
                      : config.subtitleFontFamily === "casual"
                        ? "'Comic Sans MS', sans-serif"
                        : config.subtitleFontFamily === "cursive"
                          ? "'Brush Script MT', cursive"
                          : "sans-serif",
                fontVariant: config.subtitleFontFamily === "small-caps" ? "small-caps" : "normal",
                textShadow:
                  config.subtitleEdgeStyle === "outline"
                    ? "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000"
                    : config.subtitleEdgeStyle === "raised"
                      ? "1px 1px 2px #000"
                      : config.subtitleEdgeStyle === "depressed"
                        ? "-1px -1px 2px #000"
                        : config.subtitleEdgeStyle === "none"
                          ? "none"
                          : "0 2px 4px rgba(0,0,0,0.95)",
                whiteSpace: "pre-wrap",
                lineHeight: 1.35,
                maxWidth: isTv ? "78vw" : "88vw",
                border: "1px solid transparent",
              }}
            >
              {displayCueText}
            </div>
          </div>
        )}

        {startPosition === null && !request.live && (
          <div className="resume-prompt" role="dialog" aria-modal="true" aria-label="Resume playback">
            <div className="resume-prompt-card">
              <span className="resume-eyebrow">Continue watching</span>
              <h3>Pick up where you stopped?</h3>
              <p>Resume at {formatTime(request.startAt ?? 0)}, or start this title over.</p>
              <div className="resume-actions">
                <button autoFocus className="btn btn-primary" onClick={() => setStartPosition(request.startAt ?? 0)}>
                  <Play size={16} fill="currentColor" /> Continue
                </button>
                <button className="btn" onClick={() => setStartPosition(0)}>
                  <RotateCcw size={16} /> Start over
                </button>
              </div>
            </div>
          </div>
        )}

        {waiting && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <div className="spinner" />
          </div>
        )}

        {playbackError && (
          <div className="player-error" role="alert">
            <div className="player-error-card">
              <h3>Playback stopped</h3>
              <p>{playbackError}</p>
              <div className="resume-actions">
                <button className="btn btn-primary" onClick={() => { setPlaybackError(null); setSourceUrl(""); setRetryNonce((value) => value + 1); }}>
                  <RotateCw size={16} /> Retry
                </button>
                {alternateRelease && (
                  <button className="btn" onClick={() => { setPlaybackError(null); void chooseRelease(alternateRelease); }}>
                    Try {qualityLabel(alternateRelease.resolution)}
                  </button>
                )}
                <button className="btn" onClick={close}>Close</button>
              </div>
            </div>
          </div>
        )}

        {hint && (
          <div className="player-center-hint" key={hint.id}>
            {hint.icon === "play" ? (
              <Play size={30} fill="#fff" color="#fff" />
            ) : (
              <Pause size={30} fill="#fff" color="#fff" />
            )}
          </div>
        )}

        <div className="player-chrome">
          <div className="player-top">
            <button className="icon-button" onClick={close} aria-label="Close player">
              <X size={20} />
            </button>
            <div className="player-heading">
              <h2>{request.title}</h2>
              <p>{request.subtitleLine}</p>
            </div>
          </div>

          <div className="player-bottom" onClick={(event) => event.stopPropagation()}>
            {!request.live && (
              <div className="scrub" onPointerDown={scrubPointerDown}
                   onPointerMove={scrubPointerMove} onPointerUp={scrubPointerUp}
                   onPointerLeave={() => { if (!draggingScrub.current) setScrubHover(null); }}
                   onPointerCancel={() => { draggingScrub.current = false; setScrubPreview(null); setScrubHover(null); }}
                   onKeyDown={scrubKeyDown} role="slider" tabIndex={0} aria-label="Seek"
                   aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(displayedCurrent)}
                   aria-valuetext={formatTime(displayedCurrent)}>
                {scrubHover && (
                  <div
                    className="scrub-thumbnail"
                    style={{ left: `clamp(90px, ${scrubHover.left}px, calc(100% - 90px))` }}
                    aria-hidden="true"
                  >
                    <div className="scrub-thumbnail-frame">
                      {previewImage ? (
                        <img src={previewImage} alt="" />
                      ) : (
                        <div className="scrub-thumbnail-placeholder">
                          {previewLoading && <span className="spinner" />}
                        </div>
                      )}
                    </div>
                    <span>{formatTime(scrubHover.position)}</span>
                  </div>
                )}
                <div className="scrub-track">
                  <div className="scrub-buffered" style={{ width: `${bufferedRatio * 100}%` }} />
                  <div className="scrub-played" style={{ width: `${playedRatio * 100}%` }} />
                </div>
                <div className="scrub-knob" style={{ left: `${playedRatio * 100}%` }} />
              </div>
            )}

            <div className="player-controls">
              <button className="icon-button player-primary" data-focus-initial onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (K)" : "Play (K)"}>
                {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>

              {!request.live && (
                <>
                  <button className="icon-button" onClick={() => seekBy(-SEEK_STEP)} aria-label="Back 10 seconds" title="Back 10 seconds (Left arrow)">
                    <RotateCcw size={18} />
                  </button>
                  <button className="icon-button" onClick={() => seekBy(SEEK_STEP)} aria-label="Forward 10 seconds" title="Forward 10 seconds (Right arrow)">
                    <RotateCw size={18} />
                  </button>
                </>
              )}

              <div className="volume">
                <button className="icon-button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute (M)" : "Mute (M)"}>
                  <VolumeIcon size={19} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    setVolume(Number(event.target.value));
                    setMuted(false);
                  }}
                  aria-label="Volume"
                />
              </div>

              <span className="player-time">
                {request.live ? "LIVE" : `${formatTime(displayedCurrent)} / ${formatTime(duration)}`}
              </span>

              <div className="player-secondary-controls">
                {request.mediaType === "series" && (request.episode ?? 0) > 1 && (
                  <button
                    className="icon-button player-episode-control"
                    onClick={() => void playAdjacentEpisode(-1)}
                    aria-label="Previous Episode"
                    title="Previous Episode"
                  >
                    <SkipBack size={19} />
                  </button>
                )}

                {request.mediaType === "series" && (
                  <button
                    className="icon-button player-episode-control"
                    onClick={() => void playAdjacentEpisode(1)}
                    aria-label="Next Episode"
                    title="Next Episode"
                  >
                    <SkipForward size={19} />
                  </button>
                )}

                {(
                  <button
                    className="icon-button"
                    onClick={() => setMenu((value) => (value === "subtitles" ? null : "subtitles"))}
                    aria-label="Subtitles"
                    title="Subtitles"
                    style={{ color: subtitle ? "var(--accent)" : undefined }}
                  >
                    <Captions size={19} />
                  </button>
                )}
                <button
                  className="icon-button"
                  onClick={() => setMenu((value) => (value === "quality" ? null : "quality"))}
                  aria-label="Quality and speed"
                  title="Quality and speed"
                >
                  <Settings2 size={19} />
                </button>

                {pipAvailable && <button
                  className="icon-button"
                  onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    if (document.pictureInPictureElement) {
                      void document.exitPictureInPicture();
                    } else if (document.pictureInPictureEnabled) {
                      void video.requestPictureInPicture();
                    }
                  }}
                  aria-label="Picture in Picture"
                  title="Picture in Picture (PiP)"
                >
                  <PictureInPicture size={19} />
                </button>}

                <button
                  className="icon-button mobile-only-inline player-orientation"
                  onClick={() => void toggleMobileOrientation()}
                  aria-label="Switch orientation / Laptop view"
                  title="Switch to Horizontal View"
                  style={{ color: orientationMode === "landscape" ? "var(--accent)" : undefined }}
                >
                  <RotateCw size={19} />
                </button>

                <button className="icon-button player-fullscreen" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}>
                  {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
                </button>
              </div>
            </div>
          </div>

          {menu === "quality" && (
            <div ref={menuRef} className="player-menu" role="dialog" aria-label="Quality and playback speed" onKeyDown={menuKeyDown}>
              {releases.length > 0 && (
                <>
                  <div className="player-menu-label">Quality</div>
                  {releases.map((release) => (
                    <button
                      key={`${release.url}-${release.resolution}`}
                      data-active={release.url === activeRelease?.url && release.resolution === activeRelease.resolution}
                      onClick={() => void chooseRelease(release)}
                    >
                      {release.url === activeRelease?.url && release.resolution === activeRelease.resolution ? <Check size={14} /> : <span style={{ width: 14 }} />}
                      {release.kind === "dash"
                        ? `${qualityLabel(release.resolution)} · adaptive`
                        : qualityLabel(release.resolution)}
                      <span style={{ marginLeft: "auto", color: "var(--text-faint)", fontSize: 12 }}>
                        {release.kind === "dash"
                          ? (release.ladder ?? []).map((h) => `${h}p`).join(" / ")
                          : release.format.toUpperCase()}
                      </span>
                    </button>
                  ))}
                </>
              )}

              <div className="player-menu-label">Speed</div>
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
                <button key={value} data-active={rate === value} onClick={() => { setRate(value); setMenu(null); }}>
                  {rate === value ? <Check size={14} /> : <span style={{ width: 14 }} />}
                  {value}×
                </button>
              ))}

              <div className="player-menu-label">Picture</div>
              {(["contain", "cover", "fill"] as VideoFit[]).map((value) => (
                <button key={value} data-active={videoFit === value} onClick={() => { setVideoFit(value); setMenu(null); }}>
                  {videoFit === value ? <Check size={14} /> : <span style={{ width: 14 }} />}
                  {value === "contain" ? "Fit screen" : value === "cover" ? "Fill and crop" : "Stretch"}
                </button>
              ))}

              {!request.live && (
                <>
                  <div className="player-menu-label">Sleep timer</div>
                  {[0, 15, 30, 60].map((value) => (
                    <button key={value} data-active={sleepMinutes === value} onClick={() => { setSleepMinutes(value); setMenu(null); }}>
                      {sleepMinutes === value ? <Check size={14} /> : <span style={{ width: 14 }} />}
                      {value === 0 ? "Off" : `${value} minutes`}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {menu === "subtitle-style" && (
            <div ref={menuRef} className="player-menu player-menu-wide" role="dialog" aria-label="Subtitle appearance" onKeyDown={menuKeyDown}>
              <button className="player-menu-back" onClick={() => setMenu("subtitles")}>
                <ChevronLeft size={15} />
                Subtitle appearance
              </button>

              <div
                className="cue-preview"
                style={{
                  fontSize: `${Math.round(15 * ((config.subtitleSize ?? 100) / 100))}px`,
                  color: config.subtitleColor ?? "#ffffff",
                  background:
                    config.subtitleBackground === "box"
                      ? "rgba(0,0,0,0.85)"
                      : config.subtitleBackground === "window"
                        ? "rgba(16,18,25,0.95)"
                        : config.subtitleBackground === "semi-transparent"
                          ? "rgba(0,0,0,0.45)"
                          : "transparent",
                  fontFamily:
                    config.subtitleFontFamily === "serif"
                      ? "Georgia, serif"
                      : config.subtitleFontFamily === "monospace"
                        ? "'Courier New', monospace"
                        : config.subtitleFontFamily === "casual"
                          ? "'Comic Sans MS', sans-serif"
                          : config.subtitleFontFamily === "cursive"
                            ? "'Brush Script MT', cursive"
                            : "sans-serif",
                  fontVariant: config.subtitleFontFamily === "small-caps" ? "small-caps" : "normal",
                  textShadow:
                    config.subtitleEdgeStyle === "outline"
                      ? "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000"
                      : config.subtitleEdgeStyle === "raised"
                        ? "1px 1px 2px #000"
                        : config.subtitleEdgeStyle === "depressed"
                          ? "-1px -1px 2px #000"
                          : config.subtitleEdgeStyle === "none"
                            ? "none"
                            : "0 2px 4px rgba(0,0,0,0.95)",
                }}
              >
                Sample Subtitle Text
              </div>

              <div className="cue-control">
                <span>Text size</span>
                <div className="cue-stepper">
                  <button
                    onClick={() =>
                      void patchConfig({ subtitleSize: Math.max(60, config.subtitleSize - 10) })
                    }
                    aria-label="Smaller subtitles"
                  >
                    <Minus size={13} />
                  </button>
                  <b>{config.subtitleSize}%</b>
                  <button
                    onClick={() =>
                      void patchConfig({ subtitleSize: Math.min(220, config.subtitleSize + 10) })
                    }
                    aria-label="Larger subtitles"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>

              <div className="cue-control">
                <span>Font style</span>
                <select
                  className="input"
                  style={{ width: 140, padding: "3px 8px", fontSize: 12 }}
                  value={config.subtitleFontFamily ?? "sans-serif"}
                  onChange={(event) =>
                    void patchConfig({ subtitleFontFamily: event.target.value as SubtitleFontFamily })
                  }
                >
                  {SUBTITLE_FONT_FAMILIES.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cue-control">
                <span>Colour</span>
                <div className="cue-swatches">
                  {SUBTITLE_COLORS.map((option) => (
                    <button
                      key={option.value}
                      className="cue-swatch"
                      style={{ background: option.value }}
                      data-active={config.subtitleColor === option.value}
                      title={option.label}
                      aria-label={option.label}
                      onClick={() => void patchConfig({ subtitleColor: option.value })}
                    />
                  ))}
                </div>
              </div>

              <div className="cue-control">
                <span>Background</span>
                <div className="cue-segments">
                  {(["box", "window", "semi-transparent", "none"] as const).map((option) => (
                    <button
                      key={option}
                      data-active={config.subtitleBackground === option}
                      onClick={() => void patchConfig({ subtitleBackground: option })}
                    >
                      {option === "box" ? "Solid" : option === "window" ? "Window" : option === "semi-transparent" ? "Translucent" : "None"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cue-control">
                <span>Edge style</span>
                <select
                  className="input"
                  style={{ width: 140, padding: "3px 8px", fontSize: 12 }}
                  value={config.subtitleEdgeStyle ?? "drop-shadow"}
                  onChange={(event) =>
                    void patchConfig({ subtitleEdgeStyle: event.target.value as SubtitleEdgeStyle })
                  }
                >
                  {SUBTITLE_EDGE_STYLES.map((edge) => (
                    <option key={edge.value} value={edge.value}>
                      {edge.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cue-control">
                <span>Position</span>
                <div className="cue-segments">
                  {(["top", "middle", "bottom"] as const).map((position) => (
                    <button
                      key={position}
                      data-active={config.subtitlePosition === position}
                      onClick={() => void patchConfig({ subtitlePosition: position })}
                    >
                      {position[0].toUpperCase() + position.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="player-menu-reset"
                onClick={() => {
                  void patchConfig({
                    subtitleSize: 100,
                    subtitleColor: "#ffffff",
                    subtitleBackground: "box",
                    subtitleFontFamily: "sans-serif",
                    subtitleEdgeStyle: "drop-shadow",
                    subtitlePosition: "bottom",
                  });
                }}
              >
                Reset default appearance
              </button>
            </div>
          )}

          {menu === "subtitles" && (
            <div ref={menuRef} className="player-menu" role="dialog" aria-label="Subtitles" onKeyDown={menuKeyDown}>
              <div className="player-menu-head">
                <span className="player-menu-label">Subtitles</span>
                <button
                  className="player-menu-more"
                  onClick={() => setMenu("subtitle-style")}
                  title="Subtitle appearance"
                >
                  <SlidersHorizontal size={13} />
                  Advanced
                </button>
              </div>
              <button
                data-active={!subtitle}
                onClick={() => void chooseSubtitle(null)}
              >
                {!subtitle ? <Check size={14} /> : <span style={{ width: 14 }} />}
                {SUBTITLE_OFF}
              </button>
              {subtitles.length === 0 && (
                <div className="player-menu-empty">No subtitle tracks for this title</div>
              )}
              {subtitles.map((option) => (
                <button
                  key={option.url}
                  data-active={subtitle?.name === option.name}
                  onClick={() => void chooseSubtitle(option)}
                  title={option.nativeName !== option.name ? option.nativeName : undefined}
                >
                  {subtitle?.name === option.name ? <Check size={14} /> : <span style={{ width: 14 }} />}
                  {option.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
