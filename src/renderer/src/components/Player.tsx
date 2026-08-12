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
  const idleTimer = useRef<number>();
  const lastSaved = useRef(0);

  const [sourceUrl, setSourceUrl] = useState("");
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

  // A new source resets the whole surface. Keyed on the URL rather than the request
  // object so an unrelated re-render can never restart playback mid-episode.
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setSourceUrl("");
    setWaiting(true);
    unwrap(api.media.prepareLive(request.url))
      .then((prepared) => {
        if (cancelled) return;
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
        setSourceUrl(request.url);
        notify({
          kind: "error",
          title: "Could not inspect the video codec",
          body: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        if (!cancelled) setWaiting(false);
      });
    setActiveRelease(releases.find((release) => release.url === request.url) ?? null);
    setSubtitle(null);
    setCurrent(request.startAt ?? 0);
    setDuration(0);
    lastSaved.current = 0;
    return () => {
      cancelled = true;
    };
    // Request identity is intentionally the media URL; metadata updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.url, notify]);

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
      player.updateSettings({
        streaming: {
          abr: { autoSwitchBitrate: { video: true } },
          buffer: { fastSwitchEnabled: true },
        },
      });
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
  }, [sourceUrl, notify]);

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
    if (video && video.duration > 0) persistProgress(video.currentTime, video.duration, true);
    if (document.fullscreenElement) void document.exitFullscreen();
    closePlayer();
  }, [closePlayer, persistProgress]);

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
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), video.duration);
  }, []);

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
    setDuration(video.duration || 0);
    const resumeAt = request.startAt ?? 0;
    // Ignore a resume point that sits in the last 30 s — that title was finished.
    if (resumeAt > 0 && video.duration - resumeAt > 30) video.currentTime = resumeAt;
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrent(video.currentTime);
    if (video.buffered.length > 0) {
      setBuffered(video.buffered.end(video.buffered.length - 1));
    }
    persistProgress(video.currentTime, video.duration || 0);
  };

  const scrub = (event: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    video.currentTime = ratio * video.duration;
    setCurrent(video.currentTime);
  };

  const seekTo = (position: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(position, 0), video.duration);
    setCurrent(video.currentTime);
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
    seekTo(next);
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
    const video = videoRef.current;
    const resumeAt = video?.currentTime ?? 0;
    setActiveRelease(release);
    setMenu(null);
    setWaiting(true);
    try {
      const prepared = await unwrap(api.media.prepareLive(release.url));
      setSourceUrl(prepared.url);
      if (prepared.warning) {
        notify({ kind: "info", title: "Compatibility playback", body: prepared.warning });
      }
    } catch (error) {
      notify({
        kind: "error",
        title: "Could not switch source",
        body: error instanceof Error ? error.message : undefined,
      });
      return;
    } finally {
      setWaiting(false);
    }
    // Restore the position once the new file reports metadata.
    const restore = () => {
      const next = videoRef.current;
      if (next && Number.isFinite(next.duration) && resumeAt > 0) next.currentTime = resumeAt;
      videoRef.current?.removeEventListener("loadedmetadata", restore);
    };
    videoRef.current?.addEventListener("loadedmetadata", restore);
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

  const playedRatio = duration > 0 ? current / duration : 0;
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
              <div className="scrub" onClick={scrub} onKeyDown={scrubKeyDown} role="slider" tabIndex={0} aria-label="Seek"
                   aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(current)}>
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
                {request.live ? "LIVE" : `${formatTime(current)} / ${formatTime(duration)}`}
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
                      key={release.url}
                      data-active={release.url === activeRelease?.url}
                      onClick={() => void chooseRelease(release)}
                    >
                      {release.url === activeRelease?.url ? <Check size={14} /> : <span style={{ width: 14 }} />}
                      {release.kind === "dash"
                        ? `Auto · up to ${qualityLabel(release.resolution)}`
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
