/**
 * Casting to Chromecast receivers and DLNA renderers.
 *
 * Two protocols because neither reaches everything: Chromecast covers Google's receivers and most
 * Android TVs, DLNA covers Samsung/LG/Sony panels and software renderers. Both are free and need
 * no account, and discovery for both runs from here because a renderer cannot open a UDP socket.
 *
 * A receiver fetches the media itself, so whatever URL is handed over has to be reachable from the
 * TV. Signed CDN URLs already are; downloaded files are not, which is what `media-server` covers.
 */
import dgram from "node:dgram";
import { Bonjour, type Service } from "bonjour-service";
import type {
  CastDevice,
  CastPlaybackState,
  CastRequest,
  CastSession,
} from "@shared/types";
import {
  SSDP_MEDIA_RENDERER,
  dlnaLoad,
  dlnaPause,
  dlnaPlay,
  dlnaPosition,
  dlnaSeek,
  dlnaSetVolume,
  dlnaStop,
  dlnaTransportState,
  parseDescription,
  ssdpLocation,
  type DlnaDescription,
  type DlnaService,
  type SoapFetch,
} from "@shared/dlna";
import { publicMediaUrl, stopMediaServer } from "./media-server";

// castv2-client predates the protocol freezing in place; it ships no types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: CastClient, DefaultMediaReceiver } = require("castv2-client");

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
/** Receivers answer an M-SEARCH within a second or two; anything slower is not worth waiting for. */
const DISCOVERY_MS = 4_000;

interface KnownDevice extends CastDevice {
  /** Chromecast: receiver address. DLNA: resolved AVTransport/RenderingControl endpoints. */
  host?: string;
  port?: number;
  description?: DlnaDescription;
  /** The same panel reached over the other protocol, used when the preferred one refuses. */
  alternateId?: string;
}

const devices = new Map<string, KnownDevice>();
let session: CastSession | null = null;
let broadcastSession: (session: CastSession | null) => void = () => undefined;

/** Live handles for whichever protocol is connected. */
let castClient: any = null;
let castMedia: any = null;
let dlnaTransport: DlnaService | null = null;
let dlnaRendering: DlnaService | null = null;
let poll: NodeJS.Timeout | null = null;

export function initCast(publish: (session: CastSession | null) => void): void {
  broadcastSession = publish;
}

function emit(patch: Partial<CastSession>): void {
  if (!session) return;
  session = { ...session, ...patch };
  broadcastSession(session);
}

/** Node's fetch, shaped for the shared SOAP helper. */
const soapFetch: SoapFetch = (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(8_000),
  });

/* ── Discovery ─────────────────────────────────────────────────────────────── */

function discoverChromecast(): Promise<KnownDevice[]> {
  return new Promise((resolve) => {
    const found: KnownDevice[] = [];
    let bonjour: Bonjour | null = null;

    try {
      bonjour = new Bonjour();
    } catch {
      resolve(found);
      return;
    }

    const browser = bonjour.find({ type: "googlecast", protocol: "tcp" });
    browser.on("up", (service: Service) => {
      const address = service.addresses?.find((entry) => entry.includes(".")) ?? service.host;
      if (!address) return;
      const text = (service.txt ?? {}) as Record<string, string>;
      const id = `chromecast:${text.id ?? `${address}:${service.port}`}`;
      found.push({
        id,
        // `fn` is the friendly name the user set in the Google Home app.
        name: text.fn || service.name || "Chromecast",
        protocol: "chromecast",
        detail: text.md,
        host: address,
        port: service.port ?? 8009,
      });
    });

    setTimeout(() => {
      try {
        browser.stop();
        bonjour?.destroy();
      } catch {
        // The browser is already torn down; nothing to release.
      }
      resolve(found);
    }, DISCOVERY_MS);
  });
}

function discoverDlna(): Promise<KnownDevice[]> {
  return new Promise((resolve) => {
    const locations = new Set<string>();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    socket.on("message", (message) => {
      const location = ssdpLocation(message.toString());
      if (location) locations.add(location);
    });
    socket.on("error", () => {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      resolve([]);
    });

    socket.bind(() => {
      const search =
        `M-SEARCH * HTTP/1.1\r\n` +
        `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
        `MAN: "ssdp:discover"\r\n` +
        `MX: 2\r\n` +
        `ST: ${SSDP_MEDIA_RENDERER}\r\n\r\n`;
      // Sent twice: SSDP is UDP, and a single datagram is routinely dropped on busy Wi-Fi.
      socket.send(search, SSDP_PORT, SSDP_ADDRESS);
      setTimeout(() => socket.send(search, SSDP_PORT, SSDP_ADDRESS), 700);
    });

    setTimeout(async () => {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      resolve(await describeAll([...locations]));
    }, DISCOVERY_MS);
  });
}

async function describeAll(locations: string[]): Promise<KnownDevice[]> {
  const described = await Promise.all(
    locations.map(async (location) => {
      try {
        const response = await fetch(location, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) return null;
        const description = parseDescription(await response.text(), location);
        // A renderer with no AVTransport cannot be told to play anything.
        if (!description.transport) return null;
        const device: KnownDevice = {
          id: `dlna:${location}`,
          name: description.name,
          protocol: "dlna",
          detail: description.model,
          description,
        };
        return device;
      } catch {
        return null;
      }
    }),
  );
  return described.filter((entry): entry is KnownDevice => entry !== null);
}

/** "[LG] webOS TV UR80006LJ" and "[LG] webOS TV  UR80006LJ" are the same panel. */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

export async function discoverCastDevices(): Promise<CastDevice[]> {
  // Both protocols are searched together; a slow one must not hide the other's results.
  const [chromecast, dlna] = await Promise.all([discoverChromecast(), discoverDlna()]);

  devices.clear();
  for (const device of [...chromecast, ...dlna]) devices.set(device.id, device);

  /*
   * Modern TVs answer on both protocols, and listing the same panel twice makes the user guess
   * which entry works. They are folded into one, keeping Chromecast: it negotiates codecs and
   * reports why playback failed, where DLNA renderers tend to accept a stream and stay silent.
   * The DLNA entry is kept as the alternate so a Chromecast refusal still has somewhere to go.
   */
  const byName = new Map<string, KnownDevice>();
  for (const device of devices.values()) {
    const key = nameKey(device.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, device);
      continue;
    }
    if (existing.protocol === "dlna" && device.protocol === "chromecast") {
      byName.set(key, { ...device, alternateId: existing.id });
    } else if (existing.protocol === "chromecast" && device.protocol === "dlna") {
      byName.set(key, { ...existing, alternateId: device.id });
    }
  }

  return [...byName.values()]
    .map(({ id, name, protocol, detail }) => ({ id, name, protocol, detail }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ── Casting ───────────────────────────────────────────────────────────────── */

function stopPolling(): void {
  if (poll) clearInterval(poll);
  poll = null;
}

/** Receivers do not push progress, so it is read back on a timer while something is playing. */
function startPolling(): void {
  stopPolling();
  poll = setInterval(() => {
    void refreshSession();
  }, 2_000);
}

async function refreshSession(): Promise<void> {
  if (!session) return;

  try {
    if (session.device.protocol === "dlna" && dlnaTransport) {
      const [{ position, duration }, transport] = await Promise.all([
        dlnaPosition(soapFetch, dlnaTransport),
        dlnaTransportState(soapFetch, dlnaTransport),
      ]);
      const state: CastPlaybackState =
        transport === "PLAYING"
          ? "playing"
          : transport === "PAUSED_PLAYBACK"
            ? "paused"
            : transport === "TRANSITIONING"
              ? "buffering"
              : session.state;
      emit({ position, duration: duration || session.duration, state });
      return;
    }

    if (castMedia) {
      castMedia.getStatus((error: Error | null, status: any) => {
        if (error || !status) return;
        emit({
          position: status.currentTime ?? session?.position ?? 0,
          duration: status.media?.duration ?? session?.duration ?? 0,
          state:
            status.playerState === "PLAYING"
              ? "playing"
              : status.playerState === "PAUSED"
                ? "paused"
                : status.playerState === "BUFFERING"
                  ? "buffering"
                  : session?.state ?? "idle",
        });
      });
    }
  } catch {
    // A dropped poll is not worth surfacing; the next tick either recovers or the user stops.
  }
}

function guessMimeType(url: string, provided?: string): string {
  if (provided) return provided;
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".mpd")) return "application/dash+xml";
  if (path.endsWith(".m3u8")) return "application/x-mpegURL";
  if (path.endsWith(".mkv")) return "video/x-matroska";
  if (path.endsWith(".webm")) return "video/webm";
  return "video/mp4";
}

async function castToChromecast(device: KnownDevice, request: CastRequest, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const client = new CastClient();
    client.on("error", (error: Error) => {
      try {
        client.close();
      } catch {
        // Already closed.
      }
      reject(error);
    });

    client.connect({ host: device.host, port: device.port ?? 8009 }, () => {
      client.launch(DefaultMediaReceiver, (launchError: Error | null, player: any) => {
        if (launchError) {
          reject(launchError);
          return;
        }

        const media = {
          contentId: url,
          contentType: guessMimeType(url, request.mimeType),
          // A live stream has no end to buffer towards, and asking the receiver to treat one as
          // BUFFERED makes it stall waiting for a duration that never arrives.
          streamType: request.live ? "LIVE" : "BUFFERED",
          metadata: {
            type: 0,
            metadataType: 0,
            title: request.title,
            subtitle: request.subtitleLine,
            images: request.posterUrl ? [{ url: request.posterUrl }] : undefined,
          },
          tracks: request.subtitleUrl
            ? [
                {
                  trackId: 1,
                  type: "TEXT",
                  trackContentId: request.subtitleUrl,
                  trackContentType: "text/vtt",
                  subtype: "SUBTITLES",
                  name: "Subtitles",
                },
              ]
            : undefined,
        };

        player.load(
          media,
          { autoplay: true, currentTime: request.startSeconds ?? 0, activeTrackIds: request.subtitleUrl ? [1] : undefined },
          (loadError: Error | null) => {
            if (loadError) {
              reject(loadError);
              return;
            }
            castClient = client;
            castMedia = player;

            /*
             * `load` succeeding only means the receiver accepted the request, not the stream. A
             * refusal arrives afterwards as IDLE with a reason. Settling here on `load` therefore
             * reported success and left the caller's fallback to the TV's other protocol unable to
             * ever run, so this waits for the receiver to commit before calling the cast started.
             */
            let settled = false;
            const settle = (error?: Error): void => {
              if (settled) return;
              settled = true;
              clearTimeout(verdict);
              if (error) reject(error);
              else resolve();
            };
            // A receiver that has said nothing either way is treated as working: it is playing far
            // more often than not, and a false failure would drop a working cast.
            const verdict = setTimeout(() => settle(), 12_000);

            player.on("status", (status: any) => {
              // A receiver reports a refused stream by going IDLE with a reason rather than by
              // failing the load, which is why a bad URL used to look like a blank receiver screen.
              if (status.playerState === "IDLE" && status.idleReason && status.idleReason !== "FINISHED") {
                const message =
                  status.idleReason === "ERROR"
                    ? "The TV could not play this stream. It may not support the format."
                    : `Playback stopped on the device (${String(status.idleReason).toLowerCase()}).`;
                if (!settled) {
                  settle(new Error(message));
                  return;
                }
                emit({ state: "error", message });
                return;
              }

              if (status.playerState === "PLAYING" || status.playerState === "PAUSED") settle();

              emit({
                position: status.currentTime ?? 0,
                state:
                  status.playerState === "PAUSED"
                    ? "paused"
                    : status.playerState === "BUFFERING"
                      ? "buffering"
                      : "playing",
              });
            });
          },
        );
      });
    });
  });
}

async function castToDlna(device: KnownDevice, request: CastRequest, url: string): Promise<void> {
  const transport = device.description?.transport;
  if (!transport) throw new Error(`${device.name} does not accept media.`);

  await dlnaLoad(soapFetch, transport, {
    url,
    title: request.title,
    mimeType: guessMimeType(url, request.mimeType),
    subtitleUrl: request.subtitleUrl,
    posterUrl: request.posterUrl,
    durationSeconds: request.durationSeconds,
  });

  dlnaTransport = transport;
  dlnaRendering = device.description?.rendering ?? null;

  // Seeking has to wait until the renderer has actually opened the stream.
  if (request.startSeconds && request.startSeconds > 1) {
    setTimeout(() => {
      if (dlnaTransport) void dlnaSeek(soapFetch, dlnaTransport, request.startSeconds ?? 0).catch(() => undefined);
    }, 1_500);
  }
}

export async function startCast(request: CastRequest): Promise<CastSession> {
  try {
    return await castOnce(request, request.deviceId);
  } catch (error) {
    // The list shows one entry per TV, so a refusal on the preferred protocol should try the
    // other one rather than making the user work out that the panel speaks both.
    const alternate = devices.get(request.deviceId)?.alternateId;
    if (!alternate) throw error;
    return castOnce(request, alternate);
  }
}

async function castOnce(request: CastRequest, deviceId: string): Promise<CastSession> {
  const device = devices.get(deviceId);
  if (!device) throw new Error("That device is no longer on the network.");

  await stopCast();

  // A receiver cannot read `ipmedia://` or a local path, so downloaded files are republished
  // on the LAN for the duration of the cast.
  const url = await publicMediaUrl(request.url);

  session = {
    device: { id: device.id, name: device.name, protocol: device.protocol, detail: device.detail },
    state: "loading",
    title: request.title,
    position: request.startSeconds ?? 0,
    duration: request.durationSeconds ?? 0,
    volume: 1,
    muted: false,
  };
  broadcastSession(session);

  try {
    if (device.protocol === "chromecast") {
      await castToChromecast(device, request, url);
    } else {
      await castToDlna(device, request, url);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The device refused the stream.";
    emit({ state: "error", message });
    throw new Error(message);
  }

  emit({ state: "playing" });
  startPolling();
  return session!;
}

export async function castPlay(): Promise<boolean> {
  if (!session) return false;
  if (dlnaTransport) await dlnaPlay(soapFetch, dlnaTransport);
  else castMedia?.play(() => undefined);
  emit({ state: "playing" });
  return true;
}

export async function castPause(): Promise<boolean> {
  if (!session) return false;
  if (dlnaTransport) await dlnaPause(soapFetch, dlnaTransport);
  else castMedia?.pause(() => undefined);
  emit({ state: "paused" });
  return true;
}

export async function castSeek(seconds: number): Promise<boolean> {
  if (!session) return false;
  if (dlnaTransport) await dlnaSeek(soapFetch, dlnaTransport, seconds);
  else castMedia?.seek(seconds, () => undefined);
  emit({ position: seconds });
  return true;
}

export async function castSetVolume(level: number): Promise<boolean> {
  if (!session) return false;
  const clamped = Math.min(1, Math.max(0, level));
  if (dlnaRendering) await dlnaSetVolume(soapFetch, dlnaRendering, clamped * 100);
  else castClient?.setVolume({ level: clamped }, () => undefined);
  emit({ volume: clamped });
  return true;
}

export async function stopCast(): Promise<boolean> {
  stopPolling();
  const had = session !== null;

  if (dlnaTransport) {
    // Best effort: a TV that has already been switched off cannot acknowledge a Stop.
    await dlnaStop(soapFetch, dlnaTransport).catch(() => undefined);
  }
  if (castClient) {
    try {
      castClient.stop(castMedia, () => undefined);
      castClient.close();
    } catch {
      // The socket is gone; nothing to close.
    }
  }

  dlnaTransport = null;
  dlnaRendering = null;
  castClient = null;
  castMedia = null;
  session = null;
  // Revoke the shared file the moment the cast ends, rather than leaving it reachable.
  stopMediaServer();
  broadcastSession(null);
  return had;
}

export function getCastSession(): CastSession | null {
  return session;
}
