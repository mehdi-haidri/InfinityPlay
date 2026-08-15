import { useCallback, useEffect, useRef, useState } from "react";
import { Cast, Loader2, Pause, Play, RefreshCw, Square, Tv } from "lucide-react";
import type { CastDevice, CastRequest, CastSession } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useApp } from "../store";

/** Seconds the receiver is nudged by, matching the local player's skip controls. */
const SKIP = 10;

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
}: {
  /** Everything the receiver needs; null while nothing is playable yet. */
  media: Omit<CastRequest, "deviceId"> | null;
  onCastingChange?: (casting: boolean) => void;
  /** Opens the picker after Android's native player hands off to its DLNA controller. */
  autoOpen?: boolean;
}) {
  const notify = useApp((state) => state.notify);
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [session, setSession] = useState<CastSession | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);

  useEffect(() => {
    unwrap(api.cast.session()).then(setSession).catch(() => undefined);
    return api.cast.onSession(setSession);
  }, []);

  useEffect(() => {
    onCastingChange?.(session !== null);
  }, [session, onCastingChange]);

  // Clicking away closes the picker, matching the other player menus.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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

  const castTo = async (device: CastDevice) => {
    if (!media) return;
    setOpen(false);
    try {
      setSession(await unwrap(api.cast.start({ ...media, deviceId: device.id })));
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

  if (session) {
    const playing = session.state === "playing";
    const busy = session.state === "loading" || session.state === "buffering";

    return (
      <div className="cast-bar" role="group" aria-label={`Casting to ${session.device.name}`}>
        <span className="cast-bar-target">
          <Tv size={16} />
          <span className="cast-bar-name">{session.device.name}</span>
        </span>

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
  }

  return (
    <div className="cast-wrap" ref={panelRef}>
      <button
        className="icon-button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-label="Cast to a device"
        title="Cast to a device"
        aria-expanded={open}
        disabled={!media}
      >
        <Cast size={19} />
      </button>

      {open && (
        <div className="player-menu cast-menu" role="dialog" aria-label="Cast to a device">
          <div className="player-menu-head">
            <span className="player-menu-label">Cast to</span>
            <button
              className="player-menu-more"
              onClick={() => void scan()}
              disabled={scanning}
              aria-label="Search again"
              title="Search again"
            >
              <RefreshCw size={13} /> {scanning ? "Searching…" : "Refresh"}
            </button>
          </div>

          {scanning && devices.length === 0 && (
            <div className="player-menu-empty">Looking for TVs on your network…</div>
          )}

          {!scanning && devices.length === 0 && (
            <div className="player-menu-empty">
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
        </div>
      )}
    </div>
  );
}
