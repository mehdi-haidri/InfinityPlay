import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { MediaPlayer, type MediaPlayerClass } from "dashjs";
import {
  Captions,
  Check,
  ChevronLeft,
  Maximize,
  Minimize,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Settings2,
  SlidersHorizontal,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  SUBTITLE_COLORS,
  SUBTITLE_OFF,
  type Release,
  type PreparedLiveStream,
  type SubtitleOption,
} from "@shared/types";
import { api, unwrap } from "../lib/api";
import { formatTime, qualityLabel } from "../lib/format";
import { useApp } from "../store";

const IDLE_MS = 2600;
const SEEK_STEP = 10;
const PROGRESS_SAVE_MS = 5000;

type MenuTab = "quality" | "subtitles" | "subtitle-style" | "speed" | null;

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
  const dashRef = useRef<MediaPlayerClass | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const lastSaved = useRef(0);
  const draggingScrub = useRef(false);
  const previewRequest = useRef(0);
  const previewCache = useRef(new Map<string, string | null>());

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
  /** One object rather than three strings, so label, srcLang and payload cannot drift. */
  const [subtitle, setSubtitle] = useState<{ name: string; lang: string; dataUrl: string } | null>(
    null,
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [hint, setHint] = useState<{ id: number; icon: "play" | "pause" } | null>(null);
  const [waiting, setWaiting] = useState(false);
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

  /**
   * `::cue` cannot be styled inline and does not read CSS custom properties in Chromium,
   * so the rule is generated with literal values whenever the settings change.
   */
  const cueCss = useMemo(() => {
    const background =
      config.subtitleBackground === "box" ? "rgba(0, 0, 0, 0.72)" : "transparent";
    const shadow =
      config.subtitleBackground === "box"
        ? "none"
        : "0 0 4px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,1)";
    return `.player-root video::cue {
      font-size: ${config.subtitleSize}%;
      color: ${config.subtitleColor};
      background-color: ${background};
      text-shadow: ${shadow};
    }`;
  }, [config.subtitleSize, config.subtitleColor, config.subtitleBackground]);
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
    // Request identity is intentionally the media URL; metadata updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.url]);

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
    if (!request || !selectedSourceUrl || startPosition === null) return;
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
  }, [request, selectedSourceUrl, selectedResolution, startPosition, notify]);

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
        setSubtitle({ name: match.name, lang: match.lang, dataUrl });
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
    if (!video || !sourceUrl) return;

    hlsRef.current?.destroy();
    hlsRef.current = null;
    dashRef.current?.destroy();
    dashRef.current = null;

    const isHls = /\.m3u8(\?|$)/i.test(sourceUrl);
    const isDash = /\.mpd(\?|$)/i.test(sourceUrl);

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.loadSource(sourceUrl);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        notify({ kind: "error", title: "Stream error", body: data.details });
      });
    } else if (isDash) {
      const player = MediaPlayer().create();
      dashRef.current = player;
      const requestedHeight = activeRelease?.kind === "dash" ? activeRelease.resolution : 0;
      player.updateSettings({
        streaming: {
          abr: { autoSwitchBitrate: { video: requestedHeight === 0 } },
          buffer: { fastSwitchEnabled: true },
        },
      });
      if (requestedHeight > 0) {
        player.on(MediaPlayer.events.STREAM_INITIALIZED, () => {
          const choices = player.getRepresentationsByType("video");
          const exact = choices.find((choice) => choice.height === requestedHeight);
          if (exact) player.setRepresentationForTypeById("video", exact.id, true);
        });
      }
      player.on(MediaPlayer.events.ERROR, (event: any) => {
        notify({
          kind: "error",
          title: "Stream error",
          body: event?.error?.message ?? "The adaptive stream could not be played.",
        });
      });
      player.initialize(video, sourceUrl, true);
    } else {
      video.src = sourceUrl;
    }

    video.play().catch(() => setPlaying(false));

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      dashRef.current?.destroy();
      dashRef.current = null;
    };
  }, [sourceUrl, notify, activeRelease?.kind, activeRelease?.resolution]);

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
  const playNextEpisode = useCallback(async () => {
    if (!request || request.live || !config.autoplayNext) return;
    const { subjectId, season: currentSeason, episode: currentEpisode, episodeCount } = request;
    if (!subjectId || !currentSeason || !currentEpisode || !episodeCount) return;
    if (currentEpisode >= episodeCount) return;

    const nextEpisode = currentEpisode + 1;
    try {
      const nextReleases = await unwrap(api.catalog.releases(subjectId, currentSeason, nextEpisode));
      if (nextReleases.length === 0) return;

      const chosen =
        nextReleases.find((release) => release.resolution === activeRelease?.resolution) ??
        nextReleases[0];
      const nextSubtitles = chosen.resourceId
        ? await unwrap(api.catalog.subtitles(subjectId, chosen.resourceId)).catch(() => [])
        : [];

      openPlayer({
        ...request,
        subtitleLine: `Season ${currentSeason} · Episode ${nextEpisode} · ${qualityLabel(chosen.resolution)}`,
        url: chosen.url,
        resolution: chosen.resolution,
        resourceId: chosen.resourceId,
        episode: nextEpisode,
        startAt: 0,
        releases: nextReleases,
        subtitles: nextSubtitles,
      });
    } catch (error) {
      notify({
        kind: "error",
        title: "Could not start the next episode",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  }, [request, config.autoplayNext, activeRelease?.resolution, openPlayer, notify]);

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

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setFullscreen(false);
    } else {
      await surfaceRef.current?.parentElement?.requestFullscreen().catch(() => undefined);
      setFullscreen(Boolean(document.fullscreenElement));
    }
  }, []);

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

  // Keyboard shortcuts follow the usual video-player conventions.
  useEffect(() => {
    if (!request) return;

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(target.tagName)) return;

      switch (event.key) {
        case " ":
        case "k":
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

  const chooseRelease = async (release: Release) => {
    const resumeAt = current;
    setActiveRelease(release);
    setSelectedResolution(release.resolution);
    setMenu(null);
    setWaiting(true);
    if (release.kind === "dash" && release.url === selectedSourceUrl && dashRef.current) {
      const choices = dashRef.current.getRepresentationsByType("video");
      const exact = choices.find((choice) => choice.height === release.resolution);
      dashRef.current.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
      if (exact) dashRef.current.setRepresentationForTypeById("video", exact.id, true);
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
      setSubtitle({ name: option.name, lang: option.lang, dataUrl });
    } catch (error) {
      notify({
        kind: "error",
        title: "Subtitle failed to load",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const displayedCurrent = scrubPreview ?? current;
  const playedRatio = duration > 0 ? displayedCurrent / duration : 0;
  const bufferedRatio = duration > 0 ? buffered / duration : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="player-root">
      <style>{cueCss}</style>
      <div
        className="player-surface"
        ref={surfaceRef}
        data-idle={idle && playing}
        onMouseMove={wake}
        onClick={(event) => {
          if (event.target === event.currentTarget || (event.target as HTMLElement).tagName === "VIDEO") {
            togglePlay();
          }
        }}
        onDoubleClick={() => void toggleFullscreen()}
      >
        <video
          ref={videoRef}
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
          onError={() =>
            notify({
              kind: "error",
              title: "Playback failed",
              body: "The source rejected the request or the codec is unsupported.",
            })
          }
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
              <button className="icon-button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (K)" : "Play (K)"}>
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

              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
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
                <button className="icon-button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}>
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
              {[0.75, 1, 1.25, 1.5, 2].map((value) => (
                <button key={value} data-active={rate === value} onClick={() => setRate(value)}>
                  {rate === value ? <Check size={14} /> : <span style={{ width: 14 }} />}
                  {value}×
                </button>
              ))}
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
                  fontSize: `${Math.round(15 * (config.subtitleSize / 100))}px`,
                  color: config.subtitleColor,
                  background:
                    config.subtitleBackground === "box" ? "rgba(0,0,0,0.72)" : "transparent",
                  textShadow:
                    config.subtitleBackground === "box"
                      ? "none"
                      : "0 0 4px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9)",
                }}
              >
                The quick brown fox
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
                  {(["box", "shadow", "none"] as const).map((option) => (
                    <button
                      key={option}
                      data-active={config.subtitleBackground === option}
                      onClick={() => void patchConfig({ subtitleBackground: option })}
                    >
                      {option === "box" ? "Box" : option === "shadow" ? "Outline" : "None"}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="player-menu-reset"
                onClick={() =>
                  void patchConfig({
                    subtitleSize: 100,
                    subtitleColor: "#ffffff",
                    subtitleBackground: "box",
                  })
                }
              >
                Reset to defaults
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
