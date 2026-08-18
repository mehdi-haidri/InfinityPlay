import type { SubtitleOption } from "../../shared/types";

interface StremioSubtitleItem {
  id?: string;
  url: string;
  lang?: string;
  SubEncoding?: string;
}

interface CinemetaMeta {
  id: string;
  imdb_id?: string;
  name: string;
  year?: string | number;
  type?: string;
}

// ISO 639-2 (3-letter) and ISO 639-1 (2-letter) language mapping
const ISO_LANG_MAP: Record<string, { code: string; name: string; nativeName: string }> = {
  eng: { code: "en", name: "English", nativeName: "English" },
  en: { code: "en", name: "English", nativeName: "English" },
  ara: { code: "ar", name: "Arabic", nativeName: "العربية" },
  ar: { code: "ar", name: "Arabic", nativeName: "العربية" },
  fre: { code: "fr", name: "French", nativeName: "Français" },
  fra: { code: "fr", name: "French", nativeName: "Français" },
  fr: { code: "fr", name: "French", nativeName: "Français" },
  spa: { code: "es", name: "Spanish", nativeName: "Español" },
  es: { code: "es", name: "Spanish", nativeName: "Español" },
  spl: { code: "es", name: "Spanish (Latin)", nativeName: "Español (Latino)" },
  ger: { code: "de", name: "German", nativeName: "Deutsch" },
  deu: { code: "de", name: "German", nativeName: "Deutsch" },
  de: { code: "de", name: "German", nativeName: "Deutsch" },
  ita: { code: "it", name: "Italian", nativeName: "Italiano" },
  it: { code: "it", name: "Italian", nativeName: "Italiano" },
  por: { code: "pt", name: "Portuguese", nativeName: "Português" },
  pob: { code: "pt", name: "Portuguese (BR)", nativeName: "Português (Brasil)" },
  pt: { code: "pt", name: "Portuguese", nativeName: "Português" },
  rus: { code: "ru", name: "Russian", nativeName: "Русский" },
  ru: { code: "ru", name: "Russian", nativeName: "Русский" },
  tur: { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  tr: { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  jpn: { code: "ja", name: "Japanese", nativeName: "日本語" },
  ja: { code: "ja", name: "Japanese", nativeName: "日本語" },
  kor: { code: "ko", name: "Korean", nativeName: "한국어" },
  ko: { code: "ko", name: "Korean", nativeName: "한국어" },
  zho: { code: "zh", name: "Chinese", nativeName: "中文" },
  zht: { code: "zh", name: "Chinese (Trad)", nativeName: "繁體中文" },
  zh: { code: "zh", name: "Chinese", nativeName: "中文" },
  hin: { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  hi: { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  pol: { code: "pl", name: "Polish", nativeName: "Polski" },
  pl: { code: "pl", name: "Polish", nativeName: "Polski" },
  dut: { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  nld: { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  nl: { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  swe: { code: "sv", name: "Swedish", nativeName: "Svenska" },
  sv: { code: "sv", name: "Swedish", nativeName: "Svenska" },
  nor: { code: "no", name: "Norwegian", nativeName: "Norsk" },
  dan: { code: "da", name: "Danish", nativeName: "Dansk" },
  fin: { code: "fi", name: "Finnish", nativeName: "Suomi" },
  ell: { code: "el", name: "Greek", nativeName: "Ελληνικά" },
  gre: { code: "el", name: "Greek", nativeName: "Ελληνικά" },
  hun: { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  cze: { code: "cs", name: "Czech", nativeName: "Čeština" },
  ces: { code: "cs", name: "Czech", nativeName: "Čeština" },
  ind: { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  vie: { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  tha: { code: "th", name: "Thai", nativeName: "ไทย" },
  ukr: { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  ron: { code: "ro", name: "Romanian", nativeName: "Română" },
  rum: { code: "ro", name: "Romanian", nativeName: "Română" },
  bul: { code: "bg", name: "Bulgarian", nativeName: "Български" },
  per: { code: "fa", name: "Persian", nativeName: "فارسی" },
  fas: { code: "fa", name: "Persian", nativeName: "فارسی" },
  heb: { code: "he", name: "Hebrew", nativeName: "עברית" },
};

export function cleanSearchTitle(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\b(1080p|720p|4k|2160p|480p|bluray|web-?rip|hdrip|x264|x265|hevc|aac)\b/gi, "")
    .replace(/\(\d{4}\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/[-_&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Searches open community subtitles via OpenSubtitles / Cinemeta resolver.
 * Works without requiring private API tokens.
 */
export async function searchOpenSubtitles(params: {
  title: string;
  year?: string;
  imdbId?: string;
  season?: number;
  episode?: number;
  languages?: string[];
}): Promise<SubtitleOption[]> {
  const { title, year, imdbId, season, episode } = params;
  if (!title?.trim() && !imdbId) return [];

  const results: SubtitleOption[] = [];
  const cleanTitle = cleanSearchTitle(title || "");
  let resolvedImdbId = imdbId;

  // 1. Resolve IMDb ID via Cinemeta if not provided
  if (!resolvedImdbId && cleanTitle) {
    const searchQueries = [cleanTitle, (title || "").trim()];
    const type = season && season > 0 ? "series" : "movie";

    for (const q of searchQueries) {
      if (resolvedImdbId) break;
      try {
        const metaRes = await fetch(
          `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(q)}.json`,
          {
            headers: { "User-Agent": "InfinityPlay" },
            signal: AbortSignal.timeout(6000),
          },
        );
        if (metaRes.ok) {
          const metaData = (await metaRes.json()) as { metas?: CinemetaMeta[] };
          if (Array.isArray(metaData.metas) && metaData.metas.length > 0) {
            const queryLower = cleanTitle.toLowerCase();
            const match =
              metaData.metas.find(
                (m) => m.name.toLowerCase() === queryLower && (!year || String(m.year) === year),
              ) ||
              metaData.metas.find((m) => m.name.toLowerCase() === queryLower) ||
              metaData.metas.find((m) => m.name.toLowerCase().includes(queryLower)) ||
              metaData.metas[0];
            if (match) {
              resolvedImdbId = match.imdb_id || match.id;
            }
          }
        }
      } catch {
        // Try next
      }
    }
  }

  // 2. Query OpenSubtitles via open community mirror
  if (resolvedImdbId) {
    try {
      const subPath =
        season && season > 0
          ? `series/${resolvedImdbId}:${season}:${episode || 1}.json`
          : `movie/${resolvedImdbId}.json`;

      const subRes = await fetch(`https://opensubtitles-v3.strem.io/subtitles/${subPath}`, {
        headers: { "User-Agent": "InfinityPlay" },
        signal: AbortSignal.timeout(8000),
      });

      if (subRes.ok) {
        const subData = (await subRes.json()) as { subtitles?: StremioSubtitleItem[] };
        if (Array.isArray(subData.subtitles)) {
          const seenLangs = new Map<string, number>();
          for (const item of subData.subtitles) {
            if (!item.url) continue;
            const rawLang = (item.lang || "").toLowerCase();
            const info = ISO_LANG_MAP[rawLang] || {
              code: rawLang.slice(0, 2) || "und",
              name: rawLang ? rawLang.toUpperCase() : "Unknown",
              nativeName: rawLang,
            };
            const count = (seenLangs.get(info.code) || 0) + 1;
            seenLangs.set(info.code, count);

            // Cap at 3 tracks per language to keep the track switcher manageable
            if (count <= 3) {
              results.push({
                name:
                  count === 1
                    ? `${info.name} (OpenSubtitles)`
                    : `${info.name} #${count} (OpenSubtitles)`,
                lang: info.code,
                nativeName: info.nativeName,
                url: item.url,
              });
            }
          }
        }
      }
    } catch {
      // Ignored
    }
  }

  return results;
}
