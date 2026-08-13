/**
 * M3U playlist loading for live TV, with a 24-hour cache and forced re-downloading.
 * Portable across Electron main process and Capacitor / Web browser.
 */
import { md5 } from "js-md5";
import type { Channel } from "@shared/types";

const FETCH_TIMEOUT_MS = 30_000;

function extractAttribute(line: string, attribute: string): string {
  const start = line.indexOf(attribute);
  if (start === -1) return "";
  const from = start + attribute.length;
  const end = line.indexOf('"', from);
  return end === -1 ? "" : line.slice(from, end);
}

/**
 * ISO country for a channel, as an upper-case two-letter code.
 */
export function channelCountry(line: string, tvgId: string): string {
  const explicit = extractAttribute(line, 'tvg-country="').trim();
  if (explicit) {
    const first = explicit.split(/[;,]/)[0].trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(first)) return first;
  }

  const base = tvgId.split("@")[0];
  const dot = base.lastIndexOf(".");
  if (dot === -1) return "";
  const code = base.slice(dot + 1).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

export function parseM3u(content: string): Channel[] {
  const channels: Channel[] = [];
  let pending: Omit<Channel, "streamUrl"> | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith("#EXTINF:")) {
      const commaIdx = line.lastIndexOf(",");
      const tvgId = extractAttribute(line, 'tvg-id="');
      pending = {
        id: tvgId,
        logo: extractAttribute(line, 'tvg-logo="'),
        group: extractAttribute(line, 'group-title="') || "Uncategorized",
        country: channelCountry(line, tvgId),
        name: commaIdx === -1 ? "" : line.slice(commaIdx + 1).trim(),
      };
      continue;
    }

    if (line.startsWith("#")) continue;
    if (!pending) continue;

    channels.push({ ...pending, id: pending.id || pending.name, streamUrl: line });
    pending = null;
  }

  return channels;
}

async function download(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Playlist download failed with status ${response.status}.`);
  return response.text();
}

export async function fetchPlaylist(source: string, _forceRefresh = false): Promise<Channel[]> {
  const trimmed = source.trim();
  const isRemote = trimmed.startsWith("http://") || trimmed.startsWith("https://");

  if (!isRemote) {
    try {
      const fs = await import("node:fs/promises");
      return parseM3u(await fs.readFile(trimmed, "utf8"));
    } catch {
      throw new Error("Local playlist files are not supported on this device.");
    }
  }

  const cacheKey = `m3u_cache_${md5(trimmed)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached && !_forceRefresh) {
    try {
      const { timestamp, content } = JSON.parse(cached);
      if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
        const channels = parseM3u(content);
        if (channels.length > 0) return channels;
      }
    } catch {
      // Ignore cache parse error
    }
  }

  const content = await download(trimmed);
  const channels = parseM3u(content);
  if (channels.length > 0) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), content }));
    } catch {
      // Storage full
    }
  }
  return channels;
}
