import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cast, Loader2, Pause, Play, RefreshCw, SkipBack, SkipForward, Square, Tv, X } from "lucide-react";
import type { CastDevice, CastRequest, CastSession, SubtitleOption } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { loadVttText } from "../lib/castMedia";
import { pickCastRelease } from "../lib/castMedia";
import { useApp } from "../store";

/** Seconds the receiver is nudged by, matching the local player's skip controls. */
const SKIP = 10;

/** Sentinel for "no captions", so it is distinguishable from a track whose URL is empty. */
const OFF = "__off__";

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The cast button and its device list, plus the transport controls shown once a receiver has the
 * stream. Casting is main-process work, so this component only issues commands and reflects the
 * session it is told about.
 */
export function CastControl({
  media,
  onCastingChange,
  autoOpen = false,
  triggerClassName = "icon-button",
  controllerOnly = false,
  subtitles = [],
}: {
  /** Everything the receiver needs; null while nothing is playable yet. */
  media: Omit<CastRequest, "deviceId"> | null;
  onCastingChange?: (casting: boolean) => void;
  /** Caption tracks offered for this title, so the TV's subtitles are chosen per cast. */
  subtitles?: SubtitleOption[];
  /** Opens the picker after Android's native player hands off to its DLNA controller. */
  autoOpen?: boolean;
  /**
   * Class for the button that opens the picker. The player's controls are bare icon buttons, while
   * the details page sits this beside bordered pills — the trigger takes whichever shape its
   * neighbours have so it does not read as a stray control.
  */
  triggerClassName?: string;
  /** Keeps a single transport controller mounted at the app level while routes change. */
  controllerOnly?: boolean;
}) {
  const notify = useApp((state) => state.notify);
  const autoplayNext = useApp((state) => state.config.autoplayNext);
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [session, setSession] = useState<CastSession | null>(null);
  const [changingEpisode, setChangingEpisode] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);
  const autoAdvancedEpisode = useRef("");
  /** The track URL to send, or `OFF`. Starts from whatever the media already carried. */
  const [subtitleChoice, setSubtitleChoice] = useState<string>(
    () => subtitles.find((entry) => entry.name === media?.subtitleName)?.url ?? OFF,
  );

  useEffect(() => {
    unwrap(api.cast.session()).then(setSession).catch(() => undefined);
    return api.cast.onSession(setSession);
  }, []);

  useEffect(() => {
    onCastingChange?.(session !== null);
  }, [session, onCastingChange]);

  /*
   * Escape closes the dialog. Clicking away is handled by the backdrop itself — a document-level
   * listener would fire for the dialog's own content too, since it is portalled outside this tree.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The player also closes on Escape; this dialog is on top, so it consumes the key.
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      setDevices(await unwrap(api.cast.discover()));
    } catch (error) {
      notify({
        kind: "error",
        title: "Could not search for devices",
        body: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setScanning(false);
    }
  }, [notify]);

  const openPicker = useCallback(() => {
    setOpen(true);
    // Devices come and go, so every opening re-scans rather than trusting a stale list.
    void scan();
  }, [scan]);

  useEffect(() => {
    if (!autoOpen || autoOpened.current || session || !media) return;
    autoOpened.current = true;
    openPicker();
  }, [autoOpen, media, openPicker, session]);

  /**
   * Resolves the caption track for this cast.
   *
   * The chosen track wins over whatever the app's language preference produced, so sending a film
   * to a television does not force the same subtitles the phone happens to be set to.
   */
  const castSubtitleFields = async (): Promise<Partial<CastRequest>> => {
    if (subtitleChoice === OFF) {
      return { subtitleVtt: undefined, subtitleUrl: undefined, subtitleName: undefined, subtitleLanguage: undefined };
    }
    const option = subtitles.find((entry) => entry.url === subtitleChoice);
    if (!option) return {};
    const vtt = await loadVttText(option.url).catch(() => "");
    return {
      subtitleVtt: vtt || undefined,
      subtitleUrl: option.url,
      subtitleName: option.name,
      subtitleLanguage: option.lang,
    };
  };

  const castTo = async (device: CastDevice) => {
    if (!media) return;
    setOpen(false);
    try {
      const captions = subtitles.length > 0 ? await castSubtitleFields() : {};
      const context = media.episodeContext
        ? {
            ...media.episodeContext,
            subtitle: subtitleChoice === OFF
              ? { off: true }
              : {
                  off: false,
                  name: captions.subtitleName ?? media.episodeContext.subtitle?.name,
                  language: captions.subtitleLanguage ?? media.episodeContext.subtitle?.language,
                },
          }
        : undefined;
      setSession(await unwrap(api.cast.start({ ...media, ...captions, episodeContext: context, deviceId: device.id })));
      notify({ kind: "info", title: `Casting to ${device.name}`, body: media.title });
    } catch (error) {
      notify({
        kind: "error",
        title: `${device.name} could not play this`,
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const stop = async () => {
    try {
      await unwrap(api.cast.stop());
    } catch {
      // The session is torn down locally regardless; a receiver that has gone away cannot reply.
    }
    setSession(null);
  };

  /** Resolves a fresh, direct stream for the neighbour; signed stream URLs cannot be reused. */
  const changeEpisode = useCallback(async (step: -1 | 1, automatic = false): Promise<boolean> => {
    const context = session?.episodeContext;
    if (!session || !context || (automatic && !autoplayNext)) return false;
    const index = context.episodes.findIndex(
      (entry) => entry.season === context.season && entry.number === context.episode,
    );
    const target = index < 0 ? undefined : context.episodes[index + step];
    if (!target) return false;

    try {
      setChangingEpisode(true);
      const releases = await unwrap(api.catalog.releases(context.subjectId, target.season, target.number));
      const release = pickCastRelease(releases, context.resolution);
      if (!release) throw new Error("The next episode has no direct stream for a TV.");

      let subtitleUrl: string | undefined;
      let subtitleVtt: string | undefined;
      let subtitleName: string | undefined;
      let subtitleLanguage: string | undefined;
      if (!context.subtitle?.off && release.resourceId) {
        const options = await unwrap(api.catalog.subtitles(context.subjectId, release.resourceId)).catch(() => []);
        const chosen = options.find(
          (option) =>
            option.lang.toLowerCase() === context.subtitle?.language?.toLowerCase()
            || option.name.toLowerCase() === context.subtitle?.name?.toLowerCase(),
        );
        if (chosen) {
          subtitleUrl = chosen.url;
          subtitleVtt = (await loadVttText(chosen.url).catch(() => "")) || undefined;
          subtitleName = chosen.name;
          subtitleLanguage = chosen.lang;
        }
      }

      const nextContext = {
        ...context,
        season: target.season,
        episode: target.number,
        resolution: release.resolution,
        subtitle: context.subtitle?.off
          ? { off: true }
          : { off: false, name: subtitleName ?? context.subtitle?.name, language: subtitleLanguage ?? context.subtitle?.language },
      };
      setSession(await unwrap(api.cast.start({
        deviceId: session.device.id,
        url: release.url,
        title: session.title,
        subtitleLine: `Season ${target.season} · Episode ${target.number}`,
        subtitleUrl,
        subtitleVtt,
        subtitleName,
        subtitleLanguage,
        live: false,
        episodeContext: nextContext,
      })));
      return true;
    } catch (error) {
      if (!automatic) {
        notify({
          kind: "error",
          title: `Could not start the ${step > 0 ? "next" : "previous"} episode`,
          body: error instanceof Error ? error.message : undefined,
        });
      }
      return false;
    } finally {
      setChangingEpisode(false);
    }
  }, [session, autoplayNext, notify]);

  const episodeContext = session?.episodeContext;
  const episodeIndex = episodeContext
    ? episodeContext.episodes.findIndex(
        (entry) => entry.season === episodeContext.season && entry.number === episodeContext.episode,
      )
    : -1;
  const hasPreviousEpisode = episodeIndex > 0;
  const hasNextEpisode = episodeContext !== undefined && episodeIndex >= 0 && episodeIndex < episodeContext.episodes.length - 1;

  useEffect(() => {
    if (!session || session.state !== "ended" || !autoplayNext || !hasNextEpisode) return;
    const key = `${session.device.id}:${episodeContext?.season}:${episodeContext?.episode}`;
    if (autoAdvancedEpisode.current === key) return;
    autoAdvancedEpisode.current = key;
    void changeEpisode(1, true);
  }, [session, autoplayNext, hasNextEpisode, episodeContext?.season, episodeContext?.episode, changeEpisode]);

  if (session) {
    const playing = session.state === "playing";
    const busy = session.state === "loading" || session.state === "buffering";

    const controls = (
      <div
        className={controllerOnly ? "cast-bar cast-bar-floating" : "cast-bar"}
        role="group"
        aria-label={`Casting to ${session.device.name}`}
      >
        <span className="cast-bar-target">
          <Tv size={16} />
          <span className="cast-bar-name">{session.device.name}</span>
        </span>

        {hasPreviousEpisode && (
          <button
            className="icon-button"
            onClick={() => void changeEpisode(-1)}
            aria-label="Previous episode on device"
            title="Previous episode"
            disabled={busy || changingEpisode}
          >
            <SkipBack size={18} />
          </button>
        )}

        {hasNextEpisode && (
          <button
            className="icon-button"
            onClick={() => void changeEpisode(1)}
            aria-label="Next episode on device"
            title="Next episode"
            disabled={busy || changingEpisode}
          >
            {changingEpisode ? <Loader2 className="cast-spin" size={18} /> : <SkipForward size={18} />}
          </button>
        )}

        <button
          className="icon-button"
          onClick={() => void api.cast.seek(Math.max(0, session.position - SKIP))}
          aria-label={`Back ${SKIP} seconds`}
          title={`Back ${SKIP} seconds`}
        >
          <span className="cast-skip">-{SKIP}</span>
        </button>

        <button
          className="icon-button cast-bar-primary"
          onClick={() => void (playing ? api.cast.pause() : api.cast.play())}
          aria-label={playing ? "Pause on device" : "Play on device"}
          title={playing ? "Pause" : "Play"}
          disabled={busy}
        >
          {busy ? <Loader2 className="cast-spin" size={18} /> : playing ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <button
          className="icon-button"
          onClick={() => void api.cast.seek(session.position + SKIP)}
          aria-label={`Forward ${SKIP} seconds`}
          title={`Forward ${SKIP} seconds`}
        >
          <span className="cast-skip">+{SKIP}</span>
        </button>

        <span className="cast-bar-time">
          {formatClock(session.position)}
          {session.duration > 0 ? ` / ${formatClock(session.duration)}` : ""}
        </span>

        <button className="icon-button" onClick={() => void stop()} aria-label="Stop casting" title="Stop casting">
          <Square size={16} />
        </button>

        {session.state === "error" && session.message && (
          <span className="cast-bar-error">{session.message}</span>
        )}
      </div>
    );

    // The picker that started casting can unmount when the user navigates away. The app-level
    // instance is the only one that keeps the transport controls visible across routes.
    return controllerOnly ? createPortal(controls, document.body) : null;
  }

  if (controllerOnly) return null;

  return (
    <div className="cast-wrap" ref={panelRef}>
      <button
        className={triggerClassName}
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-label="Cast to a device"
        title="Cast to a device"
        aria-expanded={open}
        disabled={!media}
      >
        <Cast size={19} />
      </button>

      {/*
        A dialog rather than a dropdown, and rendered into <body>.
        Anchored to its button it was clipped by whatever it hung out of — off the top of the window
        on the film page — so the device list under the language list could not be reached at all.
      */}
      {open
        && createPortal(
          <div
            className="cast-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div className="cast-modal" role="dialog" aria-modal="true" aria-label="Cast to a device">
              <div className="cast-modal-head">
                <div>
                  <div className="cast-modal-title">Cast to a device</div>
                  {media?.title && <div className="cast-modal-sub">{media.title}</div>}
                </div>
                <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close" title="Close">
                  <X size={16} />
                </button>
              </div>

              {/* Devices first. The point of opening this is to pick a television, and a long
                  language list above them pushed the only TV off the bottom of the panel. */}
              <div className="cast-modal-body">
                <section className="cast-section">
                  <div className="cast-section-title">
                    <span>Devices</span>
                    <button
                      className="cast-refresh"
                      onClick={() => void scan()}
                      disabled={scanning}
                      aria-label="Search again"
                    >
                      <RefreshCw size={13} /> {scanning ? "Searching…" : "Refresh"}
                    </button>
                  </div>

                  {scanning && devices.length === 0 && (
                    <div className="cast-empty">Looking for TVs on your network…</div>
                  )}

                  {!scanning && devices.length === 0 && (
                    <div className="cast-empty">
                      No devices found. Make sure the TV is on and on the same Wi-Fi.
                    </div>
                  )}

                  {devices.map((device) => (
                    <button key={device.id} className="cast-device" onClick={() => void castTo(device)}>
                      <Tv size={16} />
                      <span className="cast-device-text">
                        <span className="cast-device-name">{device.name}</span>
                        <span className="cast-device-kind">
                          {device.protocol === "chromecast" ? "Chromecast" : "DLNA"}
                          {device.detail ? ` · ${device.detail}` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </section>

                {subtitles.length > 0 && (
                  /* Chosen here rather than taken from the app's language setting: what you want on
                     a television is often not what you want on the phone in your hand. */
                  <section className="cast-section">
                    <div className="cast-section-title">Subtitles on the TV</div>
                    <div className="cast-subtitle-chips">
                      <button
                        type="button"
                        className="cast-chip"
                        data-active={subtitleChoice === OFF}
                        onClick={() => setSubtitleChoice(OFF)}
                      >
                        Off
                      </button>
                      {subtitles.map((option) => (
                        <button
                          type="button"
                          key={option.url}
                          className="cast-chip"
                          data-active={subtitleChoice === option.url}
                          onClick={() => setSubtitleChoice(option.url)}
                          title={option.nativeName || option.name}
                        >
                          {option.name}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* Choosing a language changes nothing on its own — the cast starts on the device. */}
              <div className="cast-modal-foot">
                {subtitles.length > 0 && (
                  <span>
                    Subtitles:{" "}
                    <strong>
                      {subtitleChoice === OFF
                        ? "Off"
                        : subtitles.find((option) => option.url === subtitleChoice)?.name ?? "Off"}
                    </strong>
                  </span>
                )}
                <span>Pick a device to start.</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
