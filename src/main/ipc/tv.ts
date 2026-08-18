import type { PlaylistSource, XtreamSource } from "@shared/types";
import { fetchPlaylist } from "../providers/m3u";
import { fetchEpg } from "../providers/epg";
import { fetchXtreamChannels, fetchXtreamEpg } from "../providers/xtream";
import { handle } from "./handle";

export function registerTvIpc(): void {
  handle("tv:playlist", (source: PlaylistSource, forceRefresh: boolean) =>
    fetchPlaylist(source, forceRefresh ?? false),
  );
  handle("tv:epg", (url: string, channelIds: string[]) => fetchEpg(url, channelIds));
  handle("tv:xtream", (source: XtreamSource) => fetchXtreamChannels(source));
  handle("tv:xtreamEpg", (source: XtreamSource, channelIds: string[]) =>
    fetchXtreamEpg(source, channelIds),
  );
}
