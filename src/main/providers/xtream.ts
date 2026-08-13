import type { Channel, ChannelProgramme, XtreamSource } from "@shared/types";
import { fetchEpg } from "./epg";

interface XtreamCategory { category_id?: string | number; category_name?: string }
interface XtreamStream {
  stream_id?: string | number;
  epg_channel_id?: string;
  name?: string;
  stream_icon?: string;
  category_id?: string | number;
}

function baseUrl(source: XtreamSource): URL {
  const parsed = new URL(source.serverUrl.trim());
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Xtream servers must use HTTP or HTTPS.");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function endpoint(source: XtreamSource, path: string, action?: string): URL {
  const url = baseUrl(source);
  url.pathname = `${url.pathname}/${path}`.replace(/\/{2,}/g, "/");
  url.searchParams.set("username", source.username);
  url.searchParams.set("password", source.password);
  if (action) url.searchParams.set("action", action);
  return url;
}

async function json<T>(url: URL): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`IPTV provider returned status ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function fetchXtreamChannels(source: XtreamSource): Promise<Channel[]> {
  if (!source.username || !source.password) throw new Error("Enter the IPTV username and password first.");
  const [categories, streams] = await Promise.all([
    json<XtreamCategory[]>(endpoint(source, "player_api.php", "get_live_categories")),
    json<XtreamStream[]>(endpoint(source, "player_api.php", "get_live_streams")),
  ]);
  if (!Array.isArray(streams)) throw new Error("The IPTV provider returned an invalid live-channel list.");
  const names = new Map((Array.isArray(categories) ? categories : []).map((entry) => [String(entry.category_id), entry.category_name || "Live TV"]));
  const root = baseUrl(source).toString().replace(/\/$/, "");
  return streams.flatMap((stream) => {
    const streamId = String(stream.stream_id ?? "");
    if (!streamId || !stream.name) return [];
    const user = encodeURIComponent(source.username);
    const password = encodeURIComponent(source.password);
    return [{
      id: stream.epg_channel_id || `xtream:${source.id}:${streamId}`,
      name: stream.name,
      logo: stream.stream_icon || "",
      group: names.get(String(stream.category_id)) || "Live TV",
      country: "",
      streamUrl: `${root}/live/${user}/${password}/${encodeURIComponent(streamId)}.m3u8`,
      trust: "user" as const,
      trustNote: "Provided by your configured IPTV subscription.",
    }];
  });
}

export async function fetchXtreamEpg(source: XtreamSource, channelIds: string[]): Promise<Record<string, ChannelProgramme[]>> {
  return fetchEpg(endpoint(source, "xmltv.php").toString(), channelIds);
}
