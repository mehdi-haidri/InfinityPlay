/**
 * The one place that knows how to talk to the stream CDN.
 *
 * The CDN answers 428 to any Chrome-looking User-Agent, so every fetcher — the renderer's own
 * <video>, and the LAN proxy that lends a stream to a TV — has to send the same substitute UA.
 * Verified: the identical signed URL returns 206 with this UA and 428 with a Chromecast's
 * `CrKey/...`, which is why a receiver was left staring at an error page instead of the film.
 */

export const STREAM_USER_AGENT =
  "com.community.oneroom/50020042 (Linux; U; Android 13; en_US; 2201117TY; " +
  "Build/TQ2A.230405.003; Cronet/135.0.7012.3)";

/** The webRequest filter that rewrites headers in the renderer. */
export const STREAM_HOST_FILTER = ["*://*.hakunaymatata.com/*"];

/** True when a URL points at a host that refuses ordinary clients. */
export function needsStreamHeaders(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("hakunaymatata.com");
  } catch {
    return false;
  }
}
