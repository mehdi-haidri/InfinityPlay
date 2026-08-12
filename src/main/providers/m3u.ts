/**
 * M3U playlist loading for live TV, with a 24-hour on-disk cache and a single forced
 * re-download when a cached playlist parses to nothing.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { Channel } from "@shared/types";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

function cacheDir(): string {
  return path.join(app.getPath("userData"), "tv_playlists");
}

const cacheFilename = (url: string): string =>
  `${crypto.createHash("md5").update(url).digest("hex")}.m3u`;

function extractAttribute(line: string, attribute: string): string {
  const start = line.indexOf(attribute);
  if (start === -1) return "";
  const from = start + attribute.length;
  const end = line.indexOf('"', from);
  return end === -1 ? "" : line.slice(from, end);
}

/**
 * ISO country for a channel, as an upper-case two-letter code.
 *
 * Playlists disagree on how they carry it. Free-TV writes an explicit `tvg-country`;
 * iptv-org does not, but its `tvg-id` is `ChannelName.<cc>@<quality>`, so the code sits
 * after the last dot of the part before `@`. Anything else yields "".
 */
export function channelCountry(line: string, tvgId: string): string {
  const explicit = extractAttribute(line, 'tvg-country="').trim();
  // Some playlists list several; the first is the origin.
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

async function readFreshCache(file: string): Promise<string | null> {
  try {
    const stats = await fs.stat(file);
    if (Date.now() - stats.mtimeMs >= CACHE_MAX_AGE_MS) return null;
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

export async function fetchPlaylist(source: string, forceRefresh = false): Promise<Channel[]> {
  const trimmed = source.trim();
  const isRemote = trimmed.startsWith("http://") || trimmed.startsWith("https://");

  if (!isRemote) return parseM3u(await fs.readFile(trimmed, "utf8"));

  const dir = cacheDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, cacheFilename(trimmed));

  let content = forceRefresh ? null : await readFreshCache(file);
  if (content === null) {
    content = await download(trimmed);
    await fs.writeFile(file, content, "utf8").catch(() => undefined);
  }

  const channels = parseM3u(content);
  if (channels.length > 0) return channels;

  // A cached-but-unparsable file is worth exactly one forced re-download.
  await fs.rm(file, { force: true }).catch(() => undefined);
  const fresh = await download(trimmed);
  const freshChannels = parseM3u(fresh);
  if (freshChannels.length > 0) {
    await fs.writeFile(file, fresh, "utf8").catch(() => undefined);
  }
  return freshChannels;
}
