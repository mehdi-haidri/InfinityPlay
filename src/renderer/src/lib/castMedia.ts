import type { Release, SubtitleOption } from "@shared/types";
import { api, unwrap } from "./api";

/**
 * The release to hand a television.
 *
 * Never an adaptive one. A DASH title plays here from a staged manifest whose segments are signed
 * by the app's own request hook — a receiver has no such hook, so it fetches the segments, is
 * refused, and sits on an idle screen. A progressive release carries its signature in the URL and
 * needs nothing from the app.
 *
 * Shared by the player and the details page so both offer the same source for the same title.
 */
export function pickCastRelease(releases: Release[], preferredResolution?: number): Release | undefined {
  return (
    releases.find((release) => release.kind !== "dash" && release.resolution === preferredResolution)
    ?? releases.find((release) => release.kind !== "dash")
  );
}

/** The caption track a cast should carry, matching the user's language preference. */
export function pickCastSubtitle(
  subtitles: SubtitleOption[],
  preferred: string,
): SubtitleOption | undefined {
  if (!preferred || preferred === "Off") return undefined;
  return subtitles.find((option) => option.name === preferred) ?? subtitles.find((option) => option.lang === preferred);
}

/**
 * Fetches a caption track and returns it as WebVTT text.
 *
 * A receiver is given the text rather than the source URL: the app normalises SRT to VTT, and the
 * original address is often one only this app can fetch.
 */
export async function loadVttText(url: string): Promise<string> {
  const dataUrl = await unwrap(api.subtitle.load(url));
  const marker = "data:text/vtt;charset=utf-8;base64,";
  if (!dataUrl.startsWith(marker)) return "";
  return new TextDecoder().decode(Uint8Array.from(atob(dataUrl.slice(marker.length)), (c) => c.charCodeAt(0)));
}
