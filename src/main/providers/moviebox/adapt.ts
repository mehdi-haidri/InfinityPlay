/**
 * Maps raw catalog API payloads onto the shared models: title cleaning, audio-variant
 * detection, de-duplication, and the homepage/search/browse extraction.
 */
import {
  AUDIO_LANGUAGES,
  ORIGINAL_AUDIO,
  SUBTITLE_LANGUAGES,
  type CatalogItem,
  type HomePage,
  type HomeRow,
  type MediaDetails,
  type MediaType,
  type Release,
  type Season,
  type SubtitleOption,
} from "@shared/types";

type Json = any;

/**
 * Strips `[Hindi]`, `[CAM]`, ` (Dubbed)` and trailing ` S3` season markers from a title.
 * The bracket is not always space-separated — `Spider-Man: Brand New Day[Hindi][CAM]` is
 * a real catalog entry — so both forms are handled.
 */
export function cleanMovieBoxTitle(rawTitle: string): string {
  let end = rawTitle.length;

  const spacedBracket = rawTitle.indexOf(" [");
  const bareBracket = rawTitle.indexOf("[");
  const bracket = spacedBracket !== -1 ? spacedBracket : bareBracket;
  if (bracket > 0) end = bracket;

  const paren = rawTitle.slice(0, end).indexOf(" (");
  if (paren !== -1) {
    const inside = rawTitle.slice(paren, end).toLowerCase();
    if (inside.includes("dub") || inside.includes("hindi")) end = paren;
  }

  const seasonIdx = rawTitle.slice(0, end).lastIndexOf(" S");
  if (seasonIdx !== -1) {
    const suffix = rawTitle.slice(seasonIdx + 2, end);
    const isSeason = suffix.length > 0 && /^[0-9]/.test(suffix) && /^[0-9\-S]+$/.test(suffix);
    if (isSeason) end = seasonIdx;
  }

  return rawTitle.slice(0, end).trimEnd();
}

/**
 * The dub language lives in the raw title (`Stranger Things [Hindi]`, `Kalki (Dubbed)`),
 * never in the API's `language` field — that one reports the production language and
 * says "English" even for a Hindi dub.
 */
export function detectAudioLanguage(rawTitle: string): string {
  const lower = rawTitle.toLowerCase();
  for (const language of AUDIO_LANGUAGES) {
    if (language === ORIGINAL_AUDIO) continue;
    const marker = language.toLowerCase();
    if (lower.includes(`[${marker}]`) || lower.includes(`(${marker})`)) return language;
  }
  if (lower.includes("dubbed") || lower.includes("[dub]")) return "Dubbed";
  return ORIGINAL_AUDIO;
}

/** Genres MovieBox uses for pornographic and softcore material. */
const ADULT_GENRES = ["adult", "erotic", "hot"];

/**
 * Porn-industry studio names and explicit act words. Deliberately narrow: these strings
 * essentially never occur in mainstream titles, so a plain substring test is safe. Words
 * that also appear innocently (`anal` inside `analysis`) are matched on word boundaries.
 */
const ADULT_STUDIOS = [
  "brazzers", "digital playground", "jules jordan", "naughty america", "reality kings",
  "bangbros", "evil angel", "blacked.com", "tushy.com", "vixen.com", "deeper.com",
  "mofos", "twistys", "wicked pictures", "new sensations", "pure taboo", "adult time",
  "teamskeet", "team skeet", "nubiles", "missax", "swallowed", "nympho", "legalporno",
  "dorcel", "sexart", "hegre", "kink.com", "x-art", "private black",
];

const ADULT_WORDS = [
  "porn", "xxx", "hardcore", "blowjob", "creampie", "cumshot", "gangbang",
  "hentai", "milf", "anal", "cock", "cocks", "pussy", "uncensored",
];

/**
 * MovieBox mixes pornography into ordinary rows. `restrictKid` is its own adult flag and
 * catches most of it, but not all — some explicit uploads carry `restrictKid: 0` and a
 * bland "Romance" genre — so genre and title markers back it up.
 */
export function isAdultSubject(subject: Json): boolean {
  if (Number(subject?.restrictKid) === 1) return true;

  const genres = String(subject?.genre ?? "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim());
  if (genres.some((genre) => ADULT_GENRES.includes(genre))) return true;

  const title = String(subject?.title ?? "").toLowerCase();
  if (ADULT_STUDIOS.some((studio) => title.includes(studio))) return true;
  return ADULT_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(title));
}

const mediaTypeOf = (subjectType: unknown): MediaType => (Number(subjectType) === 2 ? "series" : "movie");

const yearOf = (releaseDate: unknown): string =>
  typeof releaseDate === "string" ? releaseDate.split("-")[0] : "";

const imageUrl = (node: Json): string | null => {
  const url = node?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
};

export function subjectToCatalogItem(subject: Json): CatalogItem | null {
  const id = subject?.subjectId;
  if (typeof id !== "string" || id.length === 0) return null;

  const rawTitle = typeof subject.title === "string" ? subject.title : "Unknown";
  return {
    id,
    provider: "moviebox",
    title: cleanMovieBoxTitle(rawTitle) || rawTitle,
    rawTitle,
    mediaType: mediaTypeOf(subject.subjectType),
    year: yearOf(subject.releaseDate),
    posterUrl: imageUrl(subject.cover),
    season: Number(subject.season ?? 0) || 0,
    audioLanguage: detectAudioLanguage(rawTitle),
    isCam: Boolean(subject.isCam) || rawTitle.toUpperCase().includes("[CAM]"),
    isAdult: isAdultSubject(subject),
    description: typeof subject.description === "string" ? subject.description : undefined,
    imdbRating: typeof subject.imdbRatingValue === "string" ? subject.imdbRatingValue : undefined,
    genres: typeof subject.genre === "string" && subject.genre ? subject.genre.split(", ") : [],
  };
}

/**
 * Collapses per-season and per-dub duplicates: one entry per clean title + type, keeping
 * the highest season seen.
 *
 * Which dub survives is a deliberate choice, not arrival order — the API commonly lists
 * `Stranger Things [Hindi]` ahead of `Stranger Things`, and taking the first would hand
 * the user a Hindi audio track by default. `preferredAudio` wins, the original is the
 * fallback, and any other dub is kept only when nothing better exists.
 */
export function dedupeCatalogItems(
  items: CatalogItem[],
  preferredAudio: string = ORIGINAL_AUDIO,
): CatalogItem[] {
  const rank = (item: CatalogItem): number => {
    if (item.audioLanguage === preferredAudio) return 0;
    if (item.audioLanguage === ORIGINAL_AUDIO) return 1;
    return 2;
  };

  const output: CatalogItem[] = [];

  for (const item of items) {
    const existingById = output.findIndex((candidate) => candidate.id === item.id);
    if (existingById !== -1) {
      if (item.season > output[existingById].season) {
        output[existingById] = { ...item, season: item.season };
      }
      continue;
    }

    const twinIdx = output.findIndex(
      (candidate) => candidate.title === item.title && candidate.mediaType === item.mediaType,
    );

    if (twinIdx === -1) {
      output.push(item);
      continue;
    }

    const twin = output[twinIdx];
    // A different year on the same title is a different production, not a dub.
    if (twin.audioLanguage === item.audioLanguage && twin.year !== item.year) {
      output.push(item);
      continue;
    }

    if (rank(item) < rank(twin)) {
      output[twinIdx] = { ...item, season: Math.max(item.season, twin.season) };
    } else if (item.season > twin.season) {
      twin.season = item.season;
    }
  }

  return output;
}

/** A movie (1) or a series (2); every other subject type is a music clip, short or upload. */
const isWatchableSubject = (subject: Json): boolean => {
  const type = Number(subject?.subjectType);
  return type === 1 || type === 2;
};

export function searchToCatalogItems(payload: Json, preferredAudio?: string): CatalogItem[] {
  const subjects: Json[] = [];
  for (const group of payload?.results ?? []) {
    for (const subject of group?.subjects ?? []) subjects.push(subject);
  }
  // Search mixes in types 5, 6 and 9 — YouTube-style clips, music videos, wrestling
  // uploads — which are noise here and a common vector for explicit uploads.
  return dedupeCatalogItems(
    subjects.filter(isWatchableSubject).map(subjectToCatalogItem).filter(Boolean) as CatalogItem[],
    preferredAudio,
  );
}

/**
 * Rows from the filtered browse endpoint. Junk subject types (music clips, shorts,
 * user uploads) share the response shape, so anything that is not a movie or a series
 * is dropped here rather than leaking into the UI.
 */
export function listToCatalogItems(payload: Json, preferredAudio?: string): CatalogItem[] {
  const subjects = (payload?.items ?? []).filter(isWatchableSubject);
  return dedupeCatalogItems(
    subjects.map(subjectToCatalogItem).filter(Boolean) as CatalogItem[],
    preferredAudio,
  );
}

/**
 * Every audio variant of one title, for the details-page switcher. Keeps one subject per
 * language — the one with the most seasons, which is the fullest listing.
 */
export function searchToAudioVariants(
  payload: Json,
  title: string,
  mediaType: MediaType,
): { language: string; subjectId: string; rawTitle: string; season: number }[] {
  const byLanguage = new Map<string, { language: string; subjectId: string; rawTitle: string; season: number }>();

  for (const group of payload?.results ?? []) {
    for (const subject of group?.subjects ?? []) {
      const item = subjectToCatalogItem(subject);
      if (!item) continue;
      if (item.mediaType !== mediaType) continue;
      if (item.title.toLowerCase() !== title.toLowerCase()) continue;

      const existing = byLanguage.get(item.audioLanguage);
      if (!existing || item.season > existing.season) {
        byLanguage.set(item.audioLanguage, {
          language: item.audioLanguage,
          subjectId: item.id,
          rawTitle: item.rawTitle,
          season: item.season,
        });
      }
    }
  }

  // Original first, then alphabetical, so the list does not reshuffle between titles.
  return [...byLanguage.values()].sort((a, b) => {
    if (a.language === ORIGINAL_AUDIO) return -1;
    if (b.language === ORIGINAL_AUDIO) return 1;
    return a.language.localeCompare(b.language);
  });
}

/** Each row keeps its own identity rather than being flattened into a single list. */
export function homepageToRows(payload: Json, preferredAudio?: string): HomePage {
  const rows: HomeRow[] = [];
  const hero: CatalogItem[] = [];

  for (const item of payload?.items ?? []) {
    for (const banner of item?.banner?.banners ?? []) {
      const mapped = banner?.subject ? subjectToCatalogItem(banner.subject) : null;
      if (mapped) hero.push(mapped);
    }

    const rowSubjects: Json[] = [];
    for (const custom of item?.customData?.items ?? []) {
      if (custom?.subject) rowSubjects.push(custom.subject);
    }
    for (const subject of item?.subjects ?? []) rowSubjects.push(subject);

    const mapped = dedupeCatalogItems(
      rowSubjects.map(subjectToCatalogItem).filter(Boolean) as CatalogItem[],
      preferredAudio,
    );
    if (mapped.length === 0) continue;

    rows.push({
      title: typeof item.title === "string" && item.title ? item.title : "Featured",
      items: mapped,
    });
  }

  return { tabs: [], hero: dedupeCatalogItems(hero, preferredAudio), rows };
}

export function detailsToMediaDetails(payload: Json): MediaDetails | null {
  const base = subjectToCatalogItem(payload);
  if (!base) return null;

  const seasons: Season[] = [];
  for (const season of payload?.seasons?.seasons ?? []) {
    const number = Number(season?.se ?? 0);
    const maxEp = Number(season?.maxEp ?? 0);
    if (number <= 0 || maxEp <= 0) continue;
    seasons.push({
      number,
      episodes: Array.from({ length: maxEp }, (_, index) => ({
        season: number,
        number: index + 1,
        title: null,
        subjectId: base.id,
      })),
    });
  }

  const durationSeconds = Number(payload?.durationSeconds ?? 0);
  const duration =
    typeof payload?.duration === "string" && payload.duration
      ? payload.duration
      : durationSeconds > 0
        ? `${Math.round(durationSeconds / 60)} min`
        : "";

  return {
    ...base,
    description: typeof payload.description === "string" ? payload.description : "",
    imdbRating: typeof payload.imdbRatingValue === "string" ? payload.imdbRatingValue : "",
    genres: typeof payload.genre === "string" && payload.genre ? payload.genre.split(", ") : [],
    releaseDate: typeof payload.releaseDate === "string" ? payload.releaseDate : "",
    duration,
    country: typeof payload.countryName === "string" ? payload.countryName : "",
    cast: (payload?.staffList ?? []).slice(0, 20).map((staff: Json) => ({
      name: String(staff?.name ?? ""),
      character: String(staff?.character ?? ""),
      avatarUrl: typeof staff?.avatarUrl === "string" ? staff.avatarUrl : null,
    })),
    seasons,
    backdropUrl: imageUrl(payload?.stills) ?? base.posterUrl,
    trailerUrl: typeof payload?.trailer?.url === "string" ? payload.trailer.url : null,
  };
}

export function resourceToRelease(entry: Json, subjectTitle: string): Release | null {
  const url = entry?.resourceLink;
  if (typeof url !== "string" || url.length === 0) return null;

  // Releases inherit the audio of the subject they belong to; there is no per-file field.
  const detected = detectAudioLanguage(subjectTitle);
  const language = detected === ORIGINAL_AUDIO ? "" : detected;

  return {
    url,
    resourceId: String(entry?.resourceId ?? ""),
    filename: String(entry?.title || subjectTitle || "release"),
    resolution: Number(entry?.resolution ?? 0) || 0,
    sizeBytes: Number(entry?.size ?? 0) || 0,
    format: String(entry?.codecName ?? ""),
    headers: {}, // MovieBox serves pre-signed links; no extra headers required.
    dubbed: language !== "" && language !== "English",
    language,
  };
}

const SUBTITLE_NAME_BY_CODE = new Map(
  SUBTITLE_LANGUAGES.map((language) => [language.code, language.name]),
);

let displayNames: Intl.DisplayNames | null = null;

/**
 * Maps the API's language code to a consistent English name.
 *
 * MovieBox labels every track in its own script — `हिन्दी`, `اَلْعَرَبِيَّةُ`, `中文` — which
 * is unreadable unless you happen to know the script, and sorts unpredictably. The table
 * is tried first because the API uses non-standard codes (`in_id`, `fil`); `Intl` covers
 * anything new; the API's own label is the last resort.
 */
export function subtitleDisplayName(code: string, fallback: string): string {
  const normalized = code.trim().toLowerCase();
  const mapped = SUBTITLE_NAME_BY_CODE.get(normalized);
  if (mapped) return mapped;

  // `in_id` style codes are region-suffixed with an underscore rather than a hyphen.
  const base = normalized.split(/[_-]/)[0];
  const mappedBase = SUBTITLE_NAME_BY_CODE.get(base);
  if (mappedBase) return mappedBase;

  try {
    displayNames ??= new Intl.DisplayNames(["en"], { type: "language" });
    const resolved = displayNames.of(base);
    if (resolved && resolved.toLowerCase() !== base) {
      return resolved.charAt(0).toUpperCase() + resolved.slice(1);
    }
  } catch {
    // Intl cannot resolve it; fall through to the API's own label.
  }

  return fallback || "Unknown";
}

export function captionsToSubtitles(payload: Json): SubtitleOption[] {
  const options: SubtitleOption[] = [];
  for (const caption of payload?.extCaptions ?? []) {
    const url = caption?.url;
    if (typeof url !== "string" || url.length === 0) continue;

    const nativeName = String(caption?.lanName ?? "").trim();
    const lang = String(caption?.lan ?? "").trim();
    options.push({
      name: subtitleDisplayName(lang, nativeName),
      nativeName: nativeName || subtitleDisplayName(lang, ""),
      lang,
      url,
    });
  }

  // Alphabetical by English name, with English first — the API's order is arbitrary.
  return options.sort((a, b) => {
    if (a.lang === "en") return -1;
    if (b.lang === "en") return 1;
    return a.name.localeCompare(b.name);
  });
}
