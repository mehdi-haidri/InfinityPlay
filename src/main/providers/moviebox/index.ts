/**
 * The MovieBox facade the IPC layer talks to: raw client + adapters + a small TTL cache.
 */
import { HIDDEN_AUDIO_LANGUAGES } from "@shared/types";
import type {
  AudioVariant,
  CatalogItem,
  HomePage,
  MediaDetails,
  MediaType,
  PersonDetails,
  Release,
  SubtitleOption,
} from "@shared/types";
import { getConfig } from "../../store";
import { registerSignedStream } from "../../streams";
import { MovieBoxClient } from "./client";
import {
  captionsToSubtitles,
  detailsToMediaDetails,
  homepageToRows,
  listToCatalogItems,
  resourceToRelease,
  searchToAudioVariants,
  searchToCatalogItems,
} from "./adapt";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

class TtlCache {
  private entries = new Map<string, { value: unknown; expires: number }>();

  get<T>(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value as T;
  }

  set(key: string, value: unknown): void {
    if (this.entries.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  }

  clear(): void {
    this.entries.clear();
  }
}

export class MovieBoxService {
  private client = new MovieBoxClient();
  private cache = new TtlCache();

  private async cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
    const hit = this.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await produce();
    this.cache.set(key, value);
    return value;
  }

  clearCache(): void {
    this.cache.clear();
    this.client.reset();
  }

  /** Cache keys carry the audio preference — it changes which subject a row resolves to. */
  private get preferredAudio(): string {
    return getConfig().preferredAudio;
  }

  /**
   * Drops pornographic entries. MovieBox interleaves them with ordinary titles, so this
   * runs on every list the UI can show — rows, search, suggestions and audio variants —
   * rather than at the point of display.
   */
  private screen(items: CatalogItem[]): CatalogItem[] {
    if (!getConfig().hideAdultContent) return items;
    return items.filter((item) => !item.isAdult);
  }

  /**
   * Rows for the Home screen, built from the filtered browse endpoint rather than
   * MovieBox's operating feed. The operating feed ignores the client's region and
   * returns an India-focused lineup ("Indian Drama", "Cricket Viral Shorts", Hindi
   * banners) no matter what identity is sent, so it cannot serve a US or universal
   * audience. Spoofing the client region does not change it either — that was measured.
   */
  private static readonly HOME_ROWS: {
    title: string;
    query: { sort?: string; genre?: string; subjectType?: 1 | 2 };
  }[] = [
    { title: "Trending movies", query: { sort: "Hottest", subjectType: 1 } },
    { title: "Trending series", query: { sort: "Hottest", subjectType: 2 } },
    { title: "New releases", query: { sort: "Latest", subjectType: 1 } },
    { title: "Recommended for you", query: { sort: "ForYou", subjectType: 1 } },
    { title: "Action", query: { sort: "Hottest", genre: "Action", subjectType: 1 } },
    { title: "Comedy", query: { sort: "Hottest", genre: "Comedy", subjectType: 1 } },
    { title: "Sci-Fi", query: { sort: "Hottest", genre: "Sci-Fi", subjectType: 1 } },
    { title: "Thriller", query: { sort: "Hottest", genre: "Thriller", subjectType: 1 } },
    { title: "Horror", query: { sort: "Hottest", genre: "Horror", subjectType: 1 } },
    { title: "Animation", query: { sort: "Hottest", genre: "Animation", subjectType: 1 } },
    { title: "Popular series", query: { sort: "ForYou", subjectType: 2 } },
  ];

  async home(): Promise<HomePage> {
    const audio = this.preferredAudio;
    const { catalogCountry: country, hideAdultContent } = getConfig();

    return this.cached(`home:${country}:${audio}:${hideAdultContent}`, async () => {
      await this.client.init();

      const rows = await Promise.all(
        MovieBoxService.HOME_ROWS.map(async ({ title, query }) => {
          try {
            const payload = await this.client.listSubjects({ ...query, country });
            return { title, items: this.screen(listToCatalogItems(payload, audio)) };
          } catch {
            // One dead row should not take the whole screen down.
            return { title, items: [] };
          }
        }),
      );

      const populated = rows.filter((row) => row.items.length > 0);

      // Camcorder rips are frequently the hottest thing in the catalog, but they make a
      // poor first impression on a full-bleed hero, so they only headline as a last resort.
      const trending = populated[0]?.items ?? [];
      const hero = [
        ...trending.filter((item) => !item.isCam),
        ...trending.filter((item) => item.isCam),
      ].slice(0, 6);

      return { tabs: [], hero, rows: populated };
    });
  }

  /** MovieBox's own curated feed, kept for the "Featured" view. */
  async featured(tabId = "0", page = 1): Promise<HomePage> {
    const audio = this.preferredAudio;
    const screened = getConfig().hideAdultContent;
    return this.cached(`featured:${tabId}:${page}:${audio}:${screened}`, async () => {
      await this.client.init();
      const featured = homepageToRows(await this.client.getHomepage(tabId, page), audio);
      return {
        ...featured,
        hero: this.screen(featured.hero),
        rows: featured.rows
          .map((row) => ({ ...row, items: this.screen(row.items) }))
          .filter((row) => row.items.length > 0),
      };
    });
  }

  async search(query: string, page = 1): Promise<CatalogItem[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const audio = this.preferredAudio;
    const screened = getConfig().hideAdultContent;
    return this.cached(`search:${trimmed.toLowerCase()}:${page}:${audio}:${screened}`, async () => {
      await this.client.init();
      return this.screen(searchToCatalogItems(await this.client.search(trimmed, page), audio));
    });
  }

  /**
   * Every audio track this title exists in. MovieBox publishes each dub as a separate
   * subject, so this is a title search filtered back down to exact matches.
   */
  async audioVariants(title: string, mediaType: MediaType): Promise<AudioVariant[]> {
    const trimmed = title.trim();
    if (trimmed.length === 0) return [];
    return this.cached(`variants:${trimmed.toLowerCase()}:${mediaType}`, async () => {
      await this.client.init();
      const payload = await this.client.search(trimmed, 1);
      const all = searchToAudioVariants(payload, trimmed, mediaType).map(
        ({ language, subjectId, rawTitle }) => ({ language, subjectId, rawTitle }),
      );

      // Regional dubs are hidden from the switcher, but never at the cost of leaving a
      // title with no audio at all.
      const kept = all.filter(
        (variant) => !HIDDEN_AUDIO_LANGUAGES.includes(variant.language as never),
      );
      return kept.length > 0 ? kept : all;
    });
  }

  /** Search results capped to 8 titles, for the search-as-you-type dropdown. */
  async suggest(query: string): Promise<CatalogItem[]> {
    return (await this.search(query, 1)).slice(0, 8);
  }

  async details(subjectId: string): Promise<MediaDetails> {
    return this.cached(`details:${subjectId}`, async () => {
      await this.client.init();
      const payload = await this.client.getDetails(subjectId);
      const details = detailsToMediaDetails(payload);
      if (!details) throw new Error("This title returned no usable details.");
      return details;
    });
  }

  async person(staffId: string, name: string, avatarUrl: string | null): Promise<PersonDetails> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("This cast member has no usable name.");
    return this.cached(`person:${staffId}:${trimmedName.toLowerCase()}`, async () => {
      await this.client.init();

      const candidates: CatalogItem[] = [];
      for (let page = 1; page <= 4 && candidates.length < 40; page++) {
        const payload = await this.client.search(trimmedName, page);
        candidates.push(...searchToCatalogItems(payload, this.preferredAudio));
        if (!payload?.pager?.hasMore) break;
      }

      // Search is intentionally generous (it also matches words in titles), and its
      // compact rows sometimes omit staff metadata. Verify each candidate against the
      // full details payload in small batches so the page never attributes a namesake's
      // work to the selected person or floods the provider with parallel requests.
      const credits: CatalogItem[] = [];
      const uniqueCandidates = [...new Map(candidates.map((item) => [item.id, item])).values()]
        .slice(0, 40);
      for (let index = 0; index < uniqueCandidates.length; index += 6) {
        const batch = uniqueCandidates.slice(index, index + 6);
        const verified = await Promise.all(
          batch.map(async (item) => {
            try {
              const details = await this.details(item.id);
              return details.cast.some((member) =>
                staffId
                  ? member.id === staffId
                  : member.name.trim().toLowerCase() === trimmedName.toLowerCase(),
              ) ? item : null;
            } catch {
              return null;
            }
          }),
        );
        credits.push(...verified.filter(Boolean) as CatalogItem[]);
      }

      const unique = this.screen(
        [...new Map(credits.map((item) => [item.id, item])).values()].sort(
          (a, b) => Number(b.year || 0) - Number(a.year || 0),
        ),
      );

      let biography = "";
      let biographySourceUrl: string | null = null;
      let biographyAvatar: string | null = null;
      try {
        const slug = encodeURIComponent(trimmedName.replace(/\s+/g, "_"));
        const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, {
          headers: { "user-agent": "InfinityPlay/0.2 (person biographies)" },
          signal: AbortSignal.timeout(8_000),
        });
        if (response.ok) {
          const summary = await response.json() as any;
          if (summary?.type !== "disambiguation") {
            biography = typeof summary?.extract === "string" ? summary.extract : "";
            biographySourceUrl = typeof summary?.content_urls?.desktop?.page === "string"
              ? summary.content_urls.desktop.page
              : null;
            biographyAvatar = typeof summary?.thumbnail?.source === "string"
              ? summary.thumbnail.source
              : null;
          }
        }
      } catch {
        // Filmography remains useful when the optional biography service is unavailable.
      }

      return {
        id: staffId,
        name: trimmedName,
        avatarUrl: avatarUrl || biographyAvatar,
        biography,
        biographySourceUrl,
        movies: unique.filter((item) => item.mediaType === "movie"),
        series: unique.filter((item) => item.mediaType === "series"),
      };
    });
  }

  /**
   * Playable releases for a movie (season/episode 0) or one episode.
   *
   * The API pages a whole season per resolution rather than isolating an episode, so
   * for series we query each known resolution and keep the entry that actually matches
   * the requested season/episode.
   */
  /**
   * The adaptive rendition, which is the only place 720p and 1080p still exist. Returns
   * null when the title has no DASH stream or the manifest cannot be read.
   */
  private async adaptiveRelease(
    subjectId: string,
    season: number,
    episode: number,
  ): Promise<Release[]> {
    try {
      const info = await this.client.getPlayInfo(subjectId, season, episode);
      const stream = (info?.streams ?? []).find(
        (entry: any) => typeof entry?.url === "string" && entry.url.includes(".mpd"),
      );
      if (!stream) return [];

      const signedUrl = registerSignedStream(stream.url, String(stream.signCookie ?? ""));

      // `stream.resolutions` under-reports (it says 480 for a ladder topping out at
      // 1080), so the real heights are read from the manifest itself.
      let ladder: number[] = [];
      try {
        const response = await fetch(signedUrl, { signal: AbortSignal.timeout(10_000) });
        if (response.ok) {
          const manifest = await response.text();
          ladder = [
            ...new Set(
              [...manifest.matchAll(/height="(\d+)"/g)].map((match) => Number(match[1])),
            ),
          ]
            .filter((height) => height > 0)
            .sort((a, b) => b - a);
        }
      } catch {
        // Fall back to whatever the API claimed.
      }
      if (ladder.length === 0) {
        const claimed = Number(String(stream.resolutions ?? "").split(",")[0]);
        ladder = Number.isFinite(claimed) && claimed > 0 ? [claimed] : [];
      }
      if (ladder.length === 0) return [];

      const base = {
        url: signedUrl,
        resourceId: String(stream.id ?? ""),
        filename: "",
        sizeBytes: Number(stream.size ?? 0) || 0,
        format: String(stream.codecName ?? "dash"),
        headers: {},
        dubbed: false,
        language: "",
        kind: "dash",
        ladder,
      } satisfies Omit<Release, "resolution">;
      return ladder.map((resolution) => ({ ...base, resolution }));
    } catch {
      return [];
    }
  }

  async releases(subjectId: string, season = 0, episode = 0): Promise<Release[]> {
    return this.cached(`releases:${subjectId}:${season}:${episode}`, async () => {
      await this.client.init();

      const [adaptive, progressive] = await Promise.all([
        this.adaptiveRelease(subjectId, season, episode),
        (async (): Promise<Release[]> => {
          if (season === 0 && episode === 0) {
            const payload = await this.client.getResources(subjectId, 0, 0, 1, 0, 20);
            const title = String(payload?.subjectTitle ?? "");
            return (payload?.list ?? [])
              .map((entry: unknown) => resourceToRelease(entry, title))
              .filter(Boolean) as Release[];
          }
          const resolutions = await this.client.getCollectionResolutions(subjectId);
          const found = await Promise.all(
            resolutions.map((resolution) =>
              this.findEpisode(subjectId, season, episode, resolution),
            ),
          );
          return found.filter(Boolean) as Release[];
        })(),
      ]);

      // The adaptive stream leads: it carries the qualities the progressive rows lost.
      return [...adaptive, ...sortReleases(progressive)].sort(
        (a, b) => b.resolution - a.resolution || (a.kind === "dash" ? -1 : 1),
      );
    });
  }

  /**
   * Finds one episode's release at a given resolution.
   *
   * The `se`/`ep` query parameters are advertised by the API but **ignored** — a request
   * for S5E1 returns the show from S1E1 onwards, paged 20 at a time. Reading only the
   * first page therefore finds nothing beyond roughly episode 20, which made whole late
   * seasons look unavailable when they were simply further down the list.
   *
   * The listing is ordered by season then episode, and `pager.totalCount` is the episode
   * count for that resolution, so the right page can be binary-searched instead of walked
   * (~6 requests for a 1000-episode show rather than 50).
   */
  private async findEpisode(
    subjectId: string,
    season: number,
    episode: number,
    resolution: number,
  ): Promise<Release | null> {
    const PER_PAGE = 20;
    const rank = (s: number, e: number) => s * 100_000 + e;
    const target = rank(season, episode);

    const fetchPage = async (page: number) => {
      const payload = await this.client.getResources(
        subjectId,
        season,
        episode,
        page,
        resolution,
        PER_PAGE,
      );
      const list: any[] = payload?.list ?? [];
      return { payload, list };
    };

    try {
      const first = await fetchPage(1);
      const title = String(first.payload?.subjectTitle ?? "");

      const hitOn = (list: any[]) =>
        list.find((entry) => Number(entry?.se) === season && Number(entry?.ep) === episode);

      const direct = hitOn(first.list);
      if (direct) return resourceToRelease(direct, title);
      if (first.list.length === 0) return null;

      const totalCount = Number(first.payload?.pager?.totalCount ?? 0);
      let low = 2;
      let high = Math.max(1, Math.ceil(totalCount / PER_PAGE));

      while (low <= high) {
        const mid = (low + high) >> 1;
        const { list } = await fetchPage(mid);
        if (list.length === 0) {
          high = mid - 1;
          continue;
        }

        const hit = hitOn(list);
        if (hit) return resourceToRelease(hit, title);

        const firstRank = rank(Number(list[0].se), Number(list[0].ep));
        const lastRank = rank(Number(list[list.length - 1].se), Number(list[list.length - 1].ep));

        if (target < firstRank) high = mid - 1;
        else if (target > lastRank) low = mid + 1;
        // Inside this page's range but absent: the catalog has a gap for that episode.
        else return null;
      }

      return null;
    } catch {
      return null;
    }
  }

  async subtitles(subjectId: string, resourceId: string): Promise<SubtitleOption[]> {
    if (!resourceId) return [];
    return this.cached(`subs:${subjectId}:${resourceId}`, async () => {
      await this.client.init();
      return captionsToSubtitles(await this.client.getExtCaptions(subjectId, resourceId));
    });
  }
}

/** Highest resolution first, then largest file — the best-quality pick lands at index 0. */
function sortReleases(releases: Release[]): Release[] {
  return [...releases].sort(
    (a, b) => b.resolution - a.resolution || b.sizeBytes - a.sizeBytes,
  );
}
