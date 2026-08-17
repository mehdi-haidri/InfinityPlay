/**
 * Casting on Android.
 *
 * DLNA only, and deliberately so: the Chromecast sender SDK requires Google Play Services, which
 * de-Googled phones and many TV boxes do not ship, and the brief was that this works on any
 * machine. The shared control code the desktop runs is reused here; only the transport differs,
 * because a WebView cannot issue UPnP calls at all — see `deviceRequest`.
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
  publishText: (options: { text: string; extension?: string; contentType?: string }) => Promise<{ url: string }>;
  /** HTTP against a device on the local network, issued natively to avoid CORS and preflights. */
  httpRequest: (options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  }) => Promise<{ status: number; body: string }>;
  unpublish: () => Promise<void>;
}

const discovery = registerPlugin<CastDiscoveryPlugin>("CastDiscovery");

/**
 * True once the installed app is known to be missing the native `httpRequest` method.
 *
 * The web layer updates with every sync while the Java side only changes when the APK is rebuilt,
 * so a build can exist where this method is called but not implemented. Falling back to `fetch`
 * keeps such a build working exactly as it did before rather than finding no devices at all.
 */
let nativeRequestMissing = false;

/**
 * Every request to a device on the network goes through the native side.
 *
 * The WebView cannot make these calls. A UPnP control call is a cross-origin POST with a
 * `SOAPAction` header, so the browser preflights it with `OPTIONS`; a television answers UPnP and
 * not CORS, so the preflight is never answered and the call fails as "Failed to fetch" without the
 * TV having seen anything. Java has no origin and sends no preflight.
 */
async function deviceRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  if (!nativeRequestMissing) {
    try {
      return await discovery.httpRequest({ url, method, headers, body });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Capacitor reports an absent method rather than a transport failure; anything else is real.
      if (!/not implemented|unimplemented|does not have|no such method/i.test(message)) throw error;
      nativeRequestMissing = true;
    }
  }

  const response = await fetch(url, { method, headers, body: body || undefined });
  return { status: response.status, body: await response.text() };
}

const soapFetch: SoapFetch = async (url, init) => {
  const { status, body } = await deviceRequest(url, init.method, init.headers, init.body ?? "");
  return { ok: status >= 200 && status < 300, status, text: async () => body };
};

const known = new Map<string, DlnaDescription>();
let session: CastSession | null = null;
let listeners: ((session: CastSession | null) => void)[] = [];
let poll: number | undefined;

/** DLNA renderers, including LG webOS, expect external captions as SRT rather than WebVTT. */
function vttToSrt(vtt: string): string {
  const blocks = vtt
    .replace(/\r/g, "")
    .replace(/^\uFEFF?WEBVTT[^\n]*\n+/i, "")
    .split(/\n{2,}/);
  const cues: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0 || /^(NOTE|STYLE|REGION)\b/i.test(lines[0])) continue;
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0 || timing === lines.length - 1) continue;
    const [start, endWithSettings] = lines[timing].split(/\s+-->\s+/, 2);
    const end = endWithSettings?.trim().split(/\s+/, 1)[0];
    if (!start || !end) continue;
    const srtTime = (time: string) => {
      const normalized = time.trim().replace(".", ",");
      return normalized.split(":").length === 2 ? `00:${normalized}` : normalized;
    };
    cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${lines.slice(timing + 1).join("\n")}`);
  }

  return cues.join("\n\n");
}

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
        // Natively too: the description sits on the same origin-less HTTP as the control calls.
        const response = await deviceRequest(location, "GET", {}, "");
        if (response.status < 200 || response.status >= 300) return null;
        const description = parseDescription(response.body, location);
        if (!description.transport) return null;

        const id = `dlna:${location}`;
        known.set(id, description);
        const device: CastDevice = {
          id,
          name: description.name,
          protocol: "dlna",
          // Naming the transport here makes it visible in the picker whether this build is talking
          // to the TV natively or through the WebView, which decides what a failure means.
          detail: [description.model, nativeRequestMissing ? "browser" : "native"]
            .filter(Boolean)
            .join(" · "),
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

  /*
   * Casting has several steps that fail for unrelated reasons, and a bare message from whichever
   * one broke ("Failed to fetch") named neither the step nor the cause — which cost several rounds
   * of guessing. Each step now says which it was, so a report identifies the stage directly.
   */
  const step = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transport = nativeRequestMissing ? "browser" : "native";
      throw new Error(`${stage} failed (${transport}): ${message}`);
    }
  };

  // The CDN answers 428 to any client but this app, so those streams are relayed by the phone
  // rather than handed to the TV. Everything else is returned unchanged.
  const { url } = await step("Sharing the video", () => discovery.publish({ url: request.url }));

  const srt = request.subtitleVtt ? vttToSrt(request.subtitleVtt) : "";
  const subtitleUrl = srt
    ? (await step("Sharing the subtitles", () => discovery.publishText({
        text: srt,
        extension: ".srt",
        contentType: "application/x-subrip; charset=utf-8",
      }))).url
    : request.subtitleUrl;

  try {
    await step("Telling the TV to play", () =>
      dlnaLoad(soapFetch, transport, {
        url,
        title: request.title,
        mimeType: request.mimeType ?? "video/mp4",
        subtitleUrl,
        subtitleMimeType: srt ? "application/x-subrip" : undefined,
        posterUrl: request.posterUrl,
        durationSeconds: request.durationSeconds,
      }),
    );
  } catch (error) {
    /*
     * "Failed to fetch" here is the WebView refusing to send the request, not the TV refusing to
     * play it: a UPnP control call is a cross-origin POST carrying `SOAPAction`, so the browser
     * preflights it and a television never answers a preflight. The native path avoids that, and
     * it only exists in an app rebuilt since it was added — worth saying rather than repeating a
     * message that points at the television.
     */
    const message = error instanceof Error ? error.message : String(error);
    // The detail is kept: it names the stage and the transport, which is what identifies the cause.
    if (nativeRequestMissing && /failed to fetch|load failed|networkerror/i.test(message)) {
      throw new Error(`${message} — this build cannot reach the TV's controls; reinstall the latest one.`);
    }
    throw error;
  }

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
    episodeContext: request.episodeContext,
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
        const ended = state === "STOPPED"
          && duration > 0
          && Math.max(position, session?.position ?? 0) >= duration - 3;
        patch({
          position,
          duration: duration || session?.duration || 0,
          state: ended
            ? "ended"
            : state === "PLAYING"
              ? "playing"
              : state === "PAUSED_PLAYBACK"
                ? "paused"
                : state === "TRANSITIONING"
                  ? "buffering"
                  : session?.state ?? "playing",
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
