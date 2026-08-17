/**
 * DLNA / UPnP AVTransport, written to run in both hosts.
 *
 * Discovery needs a raw UDP socket, so it stays platform-specific: Node's `dgram` on desktop and
 * a small Java plugin on Android. Everything below is plain HTTP and string work, so the control
 * path is written once here and driven with whatever `fetch` the host provides.
 */

export interface DlnaService {
  /** Absolute URL that SOAP actions are posted to. */
  controlUrl: string;
  serviceType: string;
}

export interface DlnaDescription {
  name: string;
  model?: string;
  transport: DlnaService | null;
  rendering: DlnaService | null;
}

/** What `SetAVTransportURI` needs to describe the item being played. */
export interface DlnaMedia {
  url: string;
  title: string;
  /** `video/mp4`, `application/x-mpegURL`, … */
  mimeType: string;
  /** Sidecar captions. Renderer support varies, so this is advisory. */
  subtitleUrl?: string;
  /** MIME type of the sidecar, used by renderers that distinguish SRT from WebVTT. */
  subtitleMimeType?: string;
  posterUrl?: string;
  durationSeconds?: number;
}

export type SoapFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
const RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1";

/** The SSDP search target that matches any renderer able to play media. */
export const SSDP_MEDIA_RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1";

function tag(xml: string, name: string): string | null {
  // Device descriptions are small and machine-generated; a scan beats shipping an XML parser
  // that the renderer bundle would also have to carry.
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return match ? decodeEntities(match[1].trim()) : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absolute(base: string, relative: string): string {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

/** Pulls the LOCATION header out of an SSDP M-SEARCH reply. */
export function ssdpLocation(response: string): string | null {
  const match = /^location:\s*(\S+)\s*$/im.exec(response);
  return match ? match[1] : null;
}

/**
 * Reads a renderer's description document. `baseUrl` is the LOCATION the description came from,
 * used to resolve the relative control URLs most devices publish.
 */
export function parseDescription(xml: string, baseUrl: string): DlnaDescription {
  const services: DlnaService[] = [];

  for (const block of xml.match(/<service>[\s\S]*?<\/service>/gi) ?? []) {
    const serviceType = tag(block, "serviceType");
    const controlUrl = tag(block, "controlURL");
    if (!serviceType || !controlUrl) continue;
    services.push({ serviceType, controlUrl: absolute(baseUrl, controlUrl) });
  }

  const find = (type: string) =>
    services.find((service) => service.serviceType.toLowerCase() === type.toLowerCase()) ?? null;

  return {
    name: tag(xml, "friendlyName") ?? "Media renderer",
    model: tag(xml, "modelName") ?? undefined,
    transport: find(AV_TRANSPORT),
    rendering: find(RENDERING_CONTROL),
  };
}

/**
 * DIDL-Lite metadata. Renderers that ignore it still play the URL, but the ones that honour it
 * show the real title instead of the file name, and some need it before they accept the item.
 */
export function didlMetadata(media: DlnaMedia): string {
  const duration = media.durationSeconds ? ` duration="${hms(media.durationSeconds)}"` : "";
  const poster = media.posterUrl
    ? `<upnp:albumArtURI>${escapeXml(media.posterUrl)}</upnp:albumArtURI>`
    : "";
  const subtitleMimeType = media.subtitleMimeType ?? "text/vtt";
  const subtitleType = subtitleMimeType === "application/x-subrip" ? "srt" : "vtt";
  const captions = media.subtitleUrl
    ? `<sec:CaptionInfo sec:type="${subtitleType}">${escapeXml(media.subtitleUrl)}</sec:CaptionInfo>` +
      `<sec:CaptionInfoEx sec:type="${subtitleType}">${escapeXml(media.subtitleUrl)}</sec:CaptionInfoEx>` +
      `<pv:subtitleFileUri>${escapeXml(media.subtitleUrl)}</pv:subtitleFileUri>` +
      `<res protocolInfo="http-get:*:${escapeXml(subtitleMimeType)}:*">${escapeXml(media.subtitleUrl)}</res>`
    : "";

  return (
    `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ` +
    `xmlns:sec="http://www.sec.co.kr/" ` +
    `xmlns:pv="http://www.pv.com/pvns/">` +
    `<item id="0" parentID="-1" restricted="1">` +
    `<dc:title>${escapeXml(media.title)}</dc:title>` +
    `<upnp:class>object.item.videoItem</upnp:class>` +
    poster +
    `<res protocolInfo="http-get:*:${escapeXml(media.mimeType)}:DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000"${duration}>` +
    `${escapeXml(media.url)}</res>` +
    // A caption is an auxiliary resource, never the item the renderer should open first. LG webOS
    // treats the first compatible <res> as its AVTransport target, so putting SRT ahead of video
    // leaves it with no playable media and it answers Play with "Transition not available".
    captions +
    `</item></DIDL-Lite>`
  );
}

/** UPnP wants `H:MM:SS`, not seconds. */
export function hms(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function secondsFromHms(value: string): number {
  const parts = value.split(":").map((part) => Number.parseFloat(part) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function envelope(serviceType: string, action: string, body: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body>` +
    `</s:Envelope>`
  );
}

/** Posts one SOAP action and returns the raw response body. */
export async function soap(
  request: SoapFetch,
  service: DlnaService,
  action: string,
  body: string,
): Promise<string> {
  const response = await request(service.controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPACTION: `"${service.serviceType}#${action}"`,
    },
    body: envelope(service.serviceType, action, body),
  });

  const text = await response.text();
  if (!response.ok) {
    // The fault string is the only part of a UPnP error worth showing.
    const reason = tag(text, "errorDescription") ?? tag(text, "faultstring") ?? `HTTP ${response.status}`;
    throw new Error(reason);
  }
  return text;
}

const INSTANCE = "<InstanceID>0</InstanceID>";

export async function dlnaLoad(request: SoapFetch, service: DlnaService, media: DlnaMedia): Promise<void> {
  const waitForRenderer = () => new Promise<void>((resolve) => setTimeout(resolve, 350));
  const setAndPlay = async () => {
    await soap(
      request,
      service,
      "SetAVTransportURI",
      `${INSTANCE}<CurrentURI>${escapeXml(media.url)}</CurrentURI>` +
        `<CurrentURIMetaData>${escapeXml(didlMetadata(media))}</CurrentURIMetaData>`,
    );
    // webOS accepts SetAVTransportURI before its player has opened the resource. Sending Play in
    // the same turn can therefore race it into a 701 "Transition not available" fault.
    await waitForRenderer();
    await soap(request, service, "Play", `${INSTANCE}<Speed>1</Speed>`);
  };

  // An LG can retain the previous item's AVTransport state even after its player looks idle.
  // Stop is deliberately best-effort: some receivers reject it while idle, but do reset when it
  // applies. A transient 701 is then retried once from that clean state.
  await soap(request, service, "Stop", INSTANCE).catch(() => undefined);
  try {
    await setAndPlay();
  } catch (error) {
    if (!(error instanceof Error) || !/transition not available/i.test(error.message)) throw error;
    await soap(request, service, "Stop", INSTANCE).catch(() => undefined);
    await waitForRenderer();
    await setAndPlay();
  }
}

export const dlnaPlay = (request: SoapFetch, service: DlnaService) =>
  soap(request, service, "Play", `${INSTANCE}<Speed>1</Speed>`);

export const dlnaPause = (request: SoapFetch, service: DlnaService) =>
  soap(request, service, "Pause", INSTANCE);

export const dlnaStop = (request: SoapFetch, service: DlnaService) =>
  soap(request, service, "Stop", INSTANCE);

export const dlnaSeek = (request: SoapFetch, service: DlnaService, seconds: number) =>
  soap(request, service, "Seek", `${INSTANCE}<Unit>REL_TIME</Unit><Target>${hms(seconds)}</Target>`);

export const dlnaSetVolume = (request: SoapFetch, service: DlnaService, percent: number) =>
  soap(
    request,
    service,
    "SetVolume",
    `${INSTANCE}<Channel>Master</Channel><DesiredVolume>${Math.round(percent)}</DesiredVolume>`,
  );

/** Current position and duration, for driving the local scrub bar while casting. */
export async function dlnaPosition(
  request: SoapFetch,
  service: DlnaService,
): Promise<{ position: number; duration: number }> {
  const xml = await soap(request, service, "GetPositionInfo", INSTANCE);
  return {
    position: secondsFromHms(tag(xml, "RelTime") ?? "0:00:00"),
    duration: secondsFromHms(tag(xml, "TrackDuration") ?? "0:00:00"),
  };
}

/** `PLAYING`, `PAUSED_PLAYBACK`, `STOPPED`, … */
export async function dlnaTransportState(request: SoapFetch, service: DlnaService): Promise<string> {
  const xml = await soap(request, service, "GetTransportInfo", INSTANCE);
  return tag(xml, "CurrentTransportState") ?? "UNKNOWN";
}
