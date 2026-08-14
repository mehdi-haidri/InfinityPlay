/**
 * Casting on Android.
 *
 * DLNA only, and deliberately so: the Chromecast sender SDK requires Google Play Services, which
 * de-Googled phones and many TV boxes do not ship, and the brief was that this works on any
 * machine. Discovery is the sole native piece — everything after it reuses the same shared control
 * code the desktop runs, driven by the WebView's own `fetch`.
 */
import { registerPlugin } from "@capacitor/core";
import type { CastDevice, CastRequest, CastSession } from "@shared/types";
import {
  dlnaLoad,
  dlnaPause,
  dlnaPlay,
  dlnaPosition,
  dlnaSeek,
  dlnaSetVolume,
  dlnaStop,
  dlnaTransportState,
  parseDescription,
  type DlnaDescription,
  type SoapFetch,
} from "@shared/dlna";

interface CastDiscoveryPlugin {
  discover: () => Promise<{ locations: string[] }>;
  /** Returns a URL the TV can fetch, republishing it locally when the host would refuse the TV. */
  publish: (options: { url: string }) => Promise<{ url: string }>;
  unpublish: () => Promise<void>;
}

const discovery = registerPlugin<CastDiscoveryPlugin>("CastDiscovery");

const soapFetch: SoapFetch = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body });

const known = new Map<string, DlnaDescription>();
let session: CastSession | null = null;
let listeners: ((session: CastSession | null) => void)[] = [];
let poll: number | undefined;

function publish(next: CastSession | null): void {
  session = next;
  for (const listener of listeners) listener(next);
}

function patch(changes: Partial<CastSession>): void {
  if (session) publish({ ...session, ...changes });
}

export async function androidDiscover(): Promise<CastDevice[]> {
  const { locations } = await discovery.discover();
  known.clear();

  const devices = await Promise.all(
    locations.map(async (location) => {
      try {
        const response = await fetch(location, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) return null;
        const description = parseDescription(await response.text(), location);
        if (!description.transport) return null;

        const id = `dlna:${location}`;
        known.set(id, description);
        const device: CastDevice = {
          id,
          name: description.name,
          protocol: "dlna",
          detail: description.model,
        };
        return device;
      } catch {
        return null;
      }
    }),
  );

  return devices.filter((device): device is CastDevice => device !== null);
}

function stopPolling(): void {
  if (poll !== undefined) window.clearInterval(poll);
  poll = undefined;
}

export async function androidStartCast(request: CastRequest): Promise<CastSession> {
  const description = known.get(request.deviceId);
  const transport = description?.transport;
  if (!description || !transport) throw new Error("That device is no longer on the network.");

  // The CDN answers 428 to any client but this app, so those streams are relayed by the phone
  // rather than handed to the TV. Everything else is returned unchanged.
  const { url } = await discovery.publish({ url: request.url });

  await dlnaLoad(soapFetch, transport, {
    url,
    title: request.title,
    mimeType: request.mimeType ?? "video/mp4",
    subtitleUrl: request.subtitleUrl,
    posterUrl: request.posterUrl,
    durationSeconds: request.durationSeconds,
  });

  if (request.startSeconds && request.startSeconds > 1) {
    // The renderer has to open the stream before it will accept a seek.
    window.setTimeout(() => {
      void dlnaSeek(soapFetch, transport, request.startSeconds ?? 0).catch(() => undefined);
    }, 1_500);
  }

  publish({
    device: { id: request.deviceId, name: description.name, protocol: "dlna", detail: description.model },
    state: "playing",
    title: request.title,
    position: request.startSeconds ?? 0,
    duration: request.durationSeconds ?? 0,
    volume: 1,
    muted: false,
  });

  stopPolling();
  poll = window.setInterval(() => {
    if (!session) return;
    void (async () => {
      try {
        const [{ position, duration }, state] = await Promise.all([
          dlnaPosition(soapFetch, transport),
          dlnaTransportState(soapFetch, transport),
        ]);
        patch({
          position,
          duration: duration || session?.duration || 0,
          state: state === "PLAYING" ? "playing" : state === "PAUSED_PLAYBACK" ? "paused" : session?.state ?? "playing",
        });
      } catch {
        // A dropped poll recovers on the next tick.
      }
    })();
  }, 2_000);

  return session!;
}

function transport() {
  const description = session ? known.get(session.device.id) : null;
  return description?.transport ?? null;
}

export async function androidCastPlay(): Promise<boolean> {
  const service = transport();
  if (!service) return false;
  await dlnaPlay(soapFetch, service);
  patch({ state: "playing" });
  return true;
}

export async function androidCastPause(): Promise<boolean> {
  const service = transport();
  if (!service) return false;
  await dlnaPause(soapFetch, service);
  patch({ state: "paused" });
  return true;
}

export async function androidCastSeek(seconds: number): Promise<boolean> {
  const service = transport();
  if (!service) return false;
  await dlnaSeek(soapFetch, service, seconds);
  patch({ position: seconds });
  return true;
}

export async function androidCastVolume(level: number): Promise<boolean> {
  const description = session ? known.get(session.device.id) : null;
  if (!description?.rendering) return false;
  const clamped = Math.min(1, Math.max(0, level));
  await dlnaSetVolume(soapFetch, description.rendering, clamped * 100);
  patch({ volume: clamped });
  return true;
}

export async function androidCastStop(): Promise<boolean> {
  const service = transport();
  stopPolling();
  if (service) await dlnaStop(soapFetch, service).catch(() => undefined);
  // Nothing should stay reachable on the network once the TV has stopped playing it.
  await discovery.unpublish().catch(() => undefined);
  const had = session !== null;
  publish(null);
  return had;
}

export function androidCastSession(): CastSession | null {
  return session;
}

export function androidOnCastSession(listener: (session: CastSession | null) => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}
