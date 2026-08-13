import type { MediaType, WatchAvailability, WatchProviderOption } from "@shared/types";

interface TmdbProvider { provider_id?: number; provider_name?: string; logo_path?: string }

function options(entries: TmdbProvider[] | undefined): WatchProviderOption[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => entry.provider_id && entry.provider_name ? [{
    id: entry.provider_id,
    name: entry.provider_name,
    logoUrl: entry.logo_path ? `https://image.tmdb.org/t/p/w92${entry.logo_path}` : null,
  }] : []);
}

async function tmdb(url: URL, token: string): Promise<any> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token.startsWith("ey")) headers.Authorization = `Bearer ${token}`;
  else url.searchParams.set("api_key", token);
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`TMDB returned status ${response.status}. Check the read token in Settings.`);
  return response.json();
}

export async function findWatchAvailability(
  title: string,
  mediaType: MediaType,
  token: string,
  requestedRegion: string,
): Promise<WatchAvailability> {
  const region = /^[A-Z]{2}$/i.test(requestedRegion) ? requestedRegion.toUpperCase() : "MA";
  const empty = { configured: Boolean(token.trim()), region, link: null, free: [], ads: [], subscription: [], rent: [], buy: [] };
  if (!token.trim() || !title.trim()) return empty;

  const kind = mediaType === "series" ? "tv" : "movie";
  const search = new URL(`https://api.themoviedb.org/3/search/${kind}`);
  search.searchParams.set("query", title);
  search.searchParams.set("include_adult", "false");
  const match = (await tmdb(search, token.trim())).results?.[0];
  if (!match?.id) return empty;
  const providersUrl = new URL(`https://api.themoviedb.org/3/${kind}/${match.id}/watch/providers`);
  const country = (await tmdb(providersUrl, token.trim())).results?.[region];
  if (!country) return empty;
  return {
    configured: true,
    region,
    link: typeof country.link === "string" ? country.link : null,
    free: options(country.free),
    ads: options(country.ads),
    subscription: options(country.flatrate),
    rent: options(country.rent),
    buy: options(country.buy),
  };
}
