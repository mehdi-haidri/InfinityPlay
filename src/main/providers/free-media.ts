import type { FreeMediaItem, FreeMediaProvider } from "@shared/types";

const PAGE_SIZE = 24;

const LOC_FALLBACK: FreeMediaItem[] = [
  ["2023602008", "Popeye the Sailor Meets Sindbad the Sailor", "1936", "00068306", "Dave Fleischer"],
  ["2023602025", "The Hitch-Hiker", "1953", "00047382", "Ida Lupino"],
  ["2024600507", "Within Our Gates", "1920", "00046435", "Oscar Micheaux"],
  ["00694220", "The Great Train Robbery", "1903", "00000765", "Edwin S. Porter"],
].map(([itemId, title, year, digitalId, creator]) => ({
  id: `https://www.loc.gov/item/${itemId}/`,
  provider: "loc" as const,
  title,
  description: "A curated public-domain selection from the Library of Congress National Film Registry.",
  year,
  posterUrl: null,
  detailUrl: `https://www.loc.gov/item/${itemId}/`,
  streamUrl: `https://tile.loc.gov/streaming-services/iiif/service:mbrs:ntscrm:${digitalId}:${digitalId}/full/full/0/full/default.mp4`,
  mimeType: "video/mp4",
  rights: "Public domain selection",
  creator,
}));

function stripHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function json(url: URL): Promise<any> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "InfinityPlay/0.2.8 (public media browser)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    if (url.hostname === "www.loc.gov" && response.status === 403) {
      throw new Error("The Library of Congress API is temporarily challenging automated requests. Try again later or open the collection website.");
    }
    throw new Error(`${url.hostname} returned status ${response.status}.`);
  }
  return response.json();
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === "string" ? value : "";
}

function collectUrls(value: unknown, result: { url: string; mime: string }[] = []): { url: string; mime: string }[] {
  if (Array.isArray(value)) for (const entry of value) collectUrls(entry, result);
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string" && /^https?:\/\//i.test(child) && (/video|stream|url/i.test(key) || /\.(mp4|m3u8|webm)(?:$|\?)/i.test(child))) {
        const mime = /m3u8/i.test(child) ? "application/vnd.apple.mpegurl" : /webm/i.test(child) ? "video/webm" : /mp4/i.test(child) ? "video/mp4" : "";
        if (mime) result.push({ url: child, mime });
      } else collectUrls(child, result);
    }
  }
  return result;
}

function locItem(raw: any): FreeMediaItem {
  const candidates = collectUrls(raw.resources ?? raw.resource ?? []);
  const playable = candidates.find((entry) => entry.mime === "video/mp4") ?? candidates.find((entry) => entry.mime.includes("mpegurl")) ?? candidates[0];
  const id = firstString(raw.id || raw.url);
  const date = firstString(raw.date || raw.item?.date || raw.created_published_date);
  const images = raw.image || raw.images || raw.resources?.[0]?.image;
  return {
    id,
    provider: "loc",
    title: firstString(raw.title || raw.item?.title) || "Untitled film",
    description: stripHtml(firstString(raw.description || raw.item?.summary || raw.item?.notes)),
    year: date.match(/\b(18|19|20)\d{2}\b/)?.[0] ?? "",
    posterUrl: firstString(images) || null,
    detailUrl: id,
    streamUrl: playable?.url ?? null,
    mimeType: playable?.mime ?? "",
    rights: firstString(raw.rights || raw.item?.rights_information || raw.item?.rights_advisory),
    creator: firstString(raw.contributor || raw.creator || raw.item?.creator),
  };
}

async function locList(query: string, page: number): Promise<FreeMediaItem[]> {
  const url = new URL("https://www.loc.gov/collections/national-screening-room/");
  url.searchParams.set("fo", "json");
  url.searchParams.set("at", "results");
  url.searchParams.set("c", String(PAGE_SIZE));
  url.searchParams.set("sp", String(Math.max(1, page)));
  if (query.trim()) url.searchParams.set("q", query.trim());
  try {
    const payload = await json(url);
    return (Array.isArray(payload.results) ? payload.results : []).map(locItem).filter((item: FreeMediaItem) => item.id);
  } catch {
    const term = query.trim().toLowerCase();
    return LOC_FALLBACK.filter((item) => !term || `${item.title} ${item.creator}`.toLowerCase().includes(term));
  }
}

function metadata(info: any, key: string): string {
  return stripHtml(info?.extmetadata?.[key]?.value ?? info?.extmetadata?.[key]?.Value);
}

function commonsItem(page: any): FreeMediaItem {
  const info = page.imageinfo?.[0] ?? {};
  const derivatives = Array.isArray(page.videoinfo?.[0]?.derivatives) ? page.videoinfo[0].derivatives : [];
  const rendition = derivatives
    .filter((entry: any) => typeof entry?.src === "string" && Number(entry.height ?? 0) <= 720)
    .sort((a: any, b: any) => Number(b.height ?? 0) - Number(a.height ?? 0))[0];
  const title = String(page.title ?? "").replace(/^File:/, "").replace(/\.[^.]+$/, "");
  return {
    id: String(page.title ?? ""),
    provider: "wikimedia",
    title,
    description: metadata(info, "ImageDescription"),
    year: metadata(info, "DateTimeOriginal").match(/\b(18|19|20)\d{2}\b/)?.[0] ?? "",
    posterUrl: info.thumburl ?? null,
    detailUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title ?? ""))}`,
    streamUrl: rendition?.src ?? info.url ?? null,
    mimeType: String(rendition?.type ?? info.mime ?? "video/webm").split(";")[0],
    rights: metadata(info, "LicenseShortName") || metadata(info, "UsageTerms"),
    creator: metadata(info, "Artist") || metadata(info, "Credit"),
  };
}

async function commonsList(query: string, page: number): Promise<FreeMediaItem[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", String(PAGE_SIZE));
  url.searchParams.set("gsroffset", String((Math.max(1, page) - 1) * PAGE_SIZE));
  url.searchParams.set("gsrsearch", `filetype:video ${query.trim() || "film"}`);
  url.searchParams.set("prop", "imageinfo|videoinfo");
  url.searchParams.set("iiprop", "url|mime|size|extmetadata");
  url.searchParams.set("viprop", "derivatives");
  url.searchParams.set("iiurlwidth", "500");
  url.searchParams.set("origin", "*");
  const payload = await json(url);
  return (Array.isArray(payload.query?.pages) ? payload.query.pages : []).map(commonsItem).filter((item: FreeMediaItem) => item.streamUrl);
}

export async function browseFreeMedia(provider: FreeMediaProvider, page = 1): Promise<FreeMediaItem[]> {
  return provider === "loc" ? locList("", page) : commonsList("", page);
}

export async function searchFreeMedia(provider: FreeMediaProvider, query: string, page = 1): Promise<FreeMediaItem[]> {
  return provider === "loc" ? locList(query, page) : commonsList(query, page);
}

export async function freeMediaDetails(provider: FreeMediaProvider, id: string): Promise<FreeMediaItem> {
  if (provider === "wikimedia") {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("titles", id);
    url.searchParams.set("prop", "imageinfo|videoinfo");
    url.searchParams.set("iiprop", "url|mime|size|extmetadata");
    url.searchParams.set("viprop", "derivatives");
    url.searchParams.set("iiurlwidth", "500");
    url.searchParams.set("origin", "*");
    const page = (await json(url)).query?.pages?.[0];
    if (!page) throw new Error("This Commons video is unavailable.");
    return commonsItem(page);
  }
  const fallback = LOC_FALLBACK.find((item) => item.id === id);
  if (fallback) return fallback;
  const url = new URL(id);
  if (url.hostname !== "www.loc.gov") throw new Error("Invalid Library of Congress item URL.");
  url.searchParams.set("fo", "json");
  url.searchParams.set("at", "item,resources");
  return locItem(await json(url));
}
