import type { ChannelProgramme } from "@shared/types";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_XMLTV_BYTES = 30 * 1024 * 1024;
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; xml: string }>();

function decodeXml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(value: string, name: string): string {
  return value.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "";
}

function xmltvTime(value: string): number {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!match) return 0;
  const utc = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]),
    Number(match[5]), Number(match[6]),
  );
  if (!match[7]) return utc;
  const offset = (Number(match[8]) * 60 + Number(match[9])) * 60_000;
  return match[7] === "+" ? utc - offset : utc + offset;
}

export function parseXmlTv(xml: string, requestedIds: string[]): Record<string, ChannelProgramme[]> {
  const wanted = new Set(requestedIds.filter(Boolean));
  const programmes: Record<string, ChannelProgramme[]> = {};
  const now = Date.now();
  const earliest = now - 6 * 60 * 60 * 1000;
  const latest = now + 48 * 60 * 60 * 1000;

  for (const match of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi)) {
    const channelId = decodeXml(attribute(match[1], "channel"));
    if (!wanted.has(channelId)) continue;
    const start = xmltvTime(attribute(match[1], "start"));
    const stop = xmltvTime(attribute(match[1], "stop"));
    if (!start || stop < earliest || start > latest) continue;
    const body = match[2];
    const title = decodeXml(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Untitled");
    const description = decodeXml(body.match(/<desc\b[^>]*>([\s\S]*?)<\/desc>/i)?.[1] ?? "");
    (programmes[channelId] ??= []).push({ channelId, title, description, start, stop });
  }

  for (const entries of Object.values(programmes)) entries.sort((a, b) => a.start - b.start);
  return programmes;
}

async function downloadXml(url: string): Promise<string> {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("EPG sources must use HTTP or HTTPS.");
  const hit = cache.get(parsed.toString());
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit.xml;

  const response = await fetch(parsed, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`EPG download failed with status ${response.status}.`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_XMLTV_BYTES) throw new Error("This XMLTV guide is too large to load safely.");
  const xml = await response.text();
  if (xml.length > MAX_XMLTV_BYTES) throw new Error("This XMLTV guide is too large to load safely.");
  cache.set(parsed.toString(), { fetchedAt: Date.now(), xml });
  return xml;
}

export async function fetchEpg(url: string, channelIds: string[]): Promise<Record<string, ChannelProgramme[]>> {
  return parseXmlTv(await downloadXml(url), channelIds);
}
