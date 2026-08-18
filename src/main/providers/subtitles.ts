/**
 * The catalog serves `.srt`. A `<track>` element only accepts WebVTT, so the main
 * process or Capacitor renderer fetches the file and converts it.
 *
 * Downloaded titles pass a `local:` URL instead, which is read from disk so offline
 * playback keeps its subtitles.
 */

const FETCH_TIMEOUT_MS = 15_000;
const NODE_FS_MODULE = "node:fs/promises";

export const LOCAL_SUBTITLE_PREFIX = "local:";

/** `00:01:02,500` (SRT) -> `00:01:02.500` (VTT); also pads bare `MM:SS.mmm`. */
function normalizeTimestamp(value: string): string {
  const withDot = value.trim().replace(",", ".");
  return withDot.split(":").length === 2 ? `00:${withDot}` : withDot;
}

/**
 * Cleans dialogue cue text: strips ASS/SSA tags, converts escaped newlines
 * (\N, \n, /n, /N, \\n, \\N) common in Arabic and machine-translated subtitles to real newlines.
 */
export function cleanSubtitleCueText(text: string): string {
  if (!text) return "";
  return text
    // Strip ASS/SSA tags like {\an8}, {\pos(100,200)}, {\c&H0000FF&}
    .replace(/\{[^}]*\}/g, "")
    // Convert HTML break tags to real newlines
    .replace(/<br\s*\/?>/gi, "\n")
    // Remove other HTML formatting tags (<i>, <b>, <font>, etc.)
    .replace(/<[^>]+>/g, "")
    // Convert literal escaped newlines common in Arabic and machine-translated subs:
    // \N (ASS hard break), \n, /n, /N, \\n, \\N, \r\n, etc.
    .replace(/(?:\\+r\\+n|\\+n|\\+N|\/[nN])/g, "\n")
    // Collapse multiple consecutive newlines into one
    .replace(/[ \t]*\n(?:[ \t]*\n)+/g, "\n")
    // Clean up spaces around newlines
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

export function srtToVtt(source: string): string {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const isWebvtt = text.trimStart().startsWith("WEBVTT");

  const lines = text.split("\n");
  const output: string[] = ["WEBVTT", ""];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip WEBVTT header line if present in source
    if (isWebvtt && (trimmed.startsWith("WEBVTT") || trimmed.startsWith("NOTE") || trimmed.startsWith("STYLE"))) {
      if (trimmed.startsWith("WEBVTT")) continue;
    }

    // Drop the numeric cue counter; VTT does not need it and it confuses some parsers.
    if (/^\d+$/.test(trimmed)) continue;

    const timing = line.match(/^(.+?)\s*-->\s*(.+?)$/);
    if (timing) {
      output.push(`${normalizeTimestamp(timing[1])} --> ${normalizeTimestamp(timing[2])}`);
      continue;
    }

    if (!trimmed) {
      output.push("");
      continue;
    }

    // Clean dialogue text line (fixes /n, \n, \N, {\...}, etc.)
    const cleaned = cleanSubtitleCueText(line);
    if (cleaned) {
      output.push(cleaned);
    }
  }

  return output.join("\n");
}

/** Returns a WebVTT `data:` URL that a `<track src>` can consume directly. */
export const toDataUrl = (vtt: string): string => {
  const base64 = typeof Buffer !== "undefined"
    ? Buffer.from(vtt, "utf8").toString("base64")
    : btoa(unescape(encodeURIComponent(vtt)));
  return `data:text/vtt;charset=utf-8;base64,${base64}`;
};

export async function fetchSubtitleVtt(url: string): Promise<{ dataUrl: string; vttText: string }> {
  let rawText = "";
  if (url.startsWith(LOCAL_SUBTITLE_PREFIX)) {
    const filePath = url.slice(LOCAL_SUBTITLE_PREFIX.length);
    try {
      const fs = await import(/* @vite-ignore */ NODE_FS_MODULE);
      rawText = await fs.readFile(filePath, "utf8");
    } catch {
      throw new Error("Local subtitle files are not supported on this platform.");
    }
  } else {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Subtitle download failed with status ${response.status}.`);
    rawText = await response.text();
  }

  const vttText = srtToVtt(rawText);
  return { dataUrl: toDataUrl(vttText), vttText };
}

export async function fetchSubtitleAsVttDataUrl(url: string): Promise<string> {
  const { dataUrl } = await fetchSubtitleVtt(url);
  return dataUrl;
}

/**
 * Saves a caption file next to its video, in its original SRT form.
 */
export async function saveSubtitleFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Subtitle download failed with status ${response.status}.`);
  try {
    const fs = await import(/* @vite-ignore */ NODE_FS_MODULE);
    await fs.writeFile(destination, await response.text(), "utf8");
  } catch {
    // Non-electron environment
  }
}
