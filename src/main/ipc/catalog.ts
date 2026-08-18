import type { FreeMediaProvider, MediaType } from "@shared/types";
import { MovieBoxService } from "../providers/moviebox";
import { browseFreeMedia, freeMediaDetails, searchFreeMedia } from "../providers/free-media";
import { fetchSubtitleAsVttDataUrl } from "../providers/subtitles";
import { searchOpenSubtitles } from "../providers/opensubtitles";
import { getConfig } from "../store";
import { handle } from "./handle";

const moviebox = new MovieBoxService(getConfig);

export function registerCatalogIpc(): void {
  handle("catalog:homeSections", () => moviebox.homeSections());
  handle("catalog:homeSection", (index: number) => moviebox.homeSection(index ?? 0));
  handle("catalog:anime", (page: number) => moviebox.anime(page ?? 1));
  handle("catalog:featured", (tabId: string, page: number) =>
    moviebox.featured(tabId ?? "0", page ?? 1),
  );
  handle("catalog:search", (query: string, page: number) => moviebox.search(query, page ?? 1));
  handle("catalog:suggest", (query: string) => moviebox.suggest(query));
  handle("catalog:details", (subjectId: string) => moviebox.details(subjectId));
  handle("catalog:person", (staffId: string, name: string, avatarUrl: string | null) =>
    moviebox.person(staffId, name, avatarUrl),
  );
  handle("catalog:audioVariants", (title: string, mediaType: MediaType) =>
    moviebox.audioVariants(title, mediaType),
  );
  handle("catalog:releases", (subjectId: string, season: number, episode: number) =>
    moviebox.releases(subjectId, season ?? 0, episode ?? 0),
  );
  handle(
    "catalog:subtitles",
    async (
      subjectId: string,
      resourceId: string,
      title?: string,
      year?: string,
      season?: number,
      episode?: number,
    ) => {
      const list = await moviebox.subtitles(subjectId, resourceId);
      if (list.length > 0) return list;
      if (title) {
        const communitySubs = await searchOpenSubtitles({ title, year, season, episode });
        if (communitySubs.length > 0) return communitySubs;
      }
      return list;
    },
  );
  handle(
    "catalog:searchOnlineSubtitles",
    (params: {
      title: string;
      year?: string;
      imdbId?: string;
      season?: number;
      episode?: number;
      languages?: string[];
    }) => searchOpenSubtitles(params),
  );
  handle("catalog:clearCache", () => {
    moviebox.clearCache();
    return true;
  });

  handle("subtitle:load", (url: string) => fetchSubtitleAsVttDataUrl(url));

  handle("free:browse", (provider: FreeMediaProvider, page: number) =>
    browseFreeMedia(provider, page ?? 1),
  );
  handle("free:search", (provider: FreeMediaProvider, query: string, page: number) =>
    searchFreeMedia(provider, query, page ?? 1),
  );
  handle("free:details", (provider: FreeMediaProvider, id: string) =>
    freeMediaDetails(provider, id),
  );
  handle("availability:title", () => ({
    configured: false,
    region: "",
    link: null,
    free: [],
    ads: [],
    subscription: [],
    rent: [],
    buy: [],
  }));
}
