import { useMemo, useState, useEffect, useCallback } from "react";
import type { CatalogItem } from "@shared/types";
import {
  Film,
  Tv,
  Sparkles,
  SlidersHorizontal,
  RotateCcw,
  ArrowUpDown,
  Calendar,
  Video,
  Languages,
  X,
  Star,
  Clapperboard,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api, unwrap } from "../lib/api";
import { useAsync } from "../hooks/useAsync";
import { PosterCard } from "../components/PosterCard";
import { EmptyState, ErrorState, SkeletonGrid } from "../components/States";
import { useApp } from "../store";
import { PageHeader } from "../components/PageHeader";

type MediaFilter = "all" | "movie" | "series" | "anime";
type SortOption = "relevance" | "rating" | "newest" | "oldest" | "az" | "za";
type YearEra = "all" | "2025+" | "2020-2024" | "2010-2019" | "2000-2009" | "1990-1999" | "classic";
type AudioFilter = "all" | "en" | "ar" | "fr" | "ja" | "es" | "und";
type RatingFilter = "all" | "8+" | "7+" | "6+";

const GENRES = [
  "All",
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Horror",
  "Music",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Thriller",
  "War",
  "Western",
] as const;

export function SearchPage({ query }: { query: string }) {
  const [page, setPage] = useState(1);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [genreFilter, setGenreFilter] = useState<string>("All");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("relevance");
  const [yearEra, setYearEra] = useState<YearEra>("all");
  const [audioFilter, setAudioFilter] = useState<AudioFilter>("all");
  const [hideCam, setHideCam] = useState(false);

  const preferredAudio = useApp((state) => state.config.preferredAudio);
  const hideAdultContent = useApp((state) => state.config.hideAdultContent);

  // Reset page when search keyword changes
  useEffect(() => {
    setPage(1);
  }, [query]);

  const { data, loading, error, reload } = useAsync<CatalogItem[]>(
    () => (query.trim() ? unwrap(api.catalog.search(query, page)) : Promise.resolve([])),
    [query, page, preferredAudio, hideAdultContent],
  );

  const activeAdvancedCount = useMemo(() => {
    let count = 0;
    if (sortBy !== "relevance") count++;
    if (genreFilter !== "All") count++;
    if (ratingFilter !== "all") count++;
    if (yearEra !== "all") count++;
    if (audioFilter !== "all") count++;
    if (hideCam) count++;
    return count;
  }, [sortBy, genreFilter, ratingFilter, yearEra, audioFilter, hideCam]);

  const resetFilters = useCallback(() => {
    setMediaFilter("all");
    setGenreFilter("All");
    setRatingFilter("all");
    setSortBy("relevance");
    setYearEra("all");
    setAudioFilter("all");
    setHideCam(false);
  }, []);

  const results = useMemo(() => {
    let list = [...(data ?? [])];

    // 1. Media type / Anime
    if (mediaFilter === "movie") {
      list = list.filter((item) => item.mediaType === "movie");
    } else if (mediaFilter === "series") {
      list = list.filter((item) => item.mediaType === "series");
    } else if (mediaFilter === "anime") {
      list = list.filter((item) => {
        const titleLower = (item.title + " " + item.rawTitle).toLowerCase();
        const genreLower = (item.genres ?? []).join(" ").toLowerCase();
        const audioLower = (item.audioLanguage ?? "").toLowerCase();
        return (
          genreLower.includes("animation") ||
          genreLower.includes("anime") ||
          audioLower.includes("ja") ||
          titleLower.includes("anime")
        );
      });
    }

    // 2. Genre filter
    if (genreFilter !== "All") {
      const gLower = genreFilter.toLowerCase();
      list = list.filter((item) => {
        if (item.genres && item.genres.length > 0) {
          return item.genres.some((g) => g.toLowerCase().includes(gLower));
        }
        const descLower = (item.description ?? "").toLowerCase();
        const titleLower = (item.title + " " + item.rawTitle).toLowerCase();
        return descLower.includes(gLower) || titleLower.includes(gLower);
      });
    }

    // 3. Minimum rating
    if (ratingFilter !== "all") {
      const min = ratingFilter === "8+" ? 8.0 : ratingFilter === "7+" ? 7.0 : 6.0;
      list = list.filter((item) => {
        const score = parseFloat(item.imdbRating ?? "0");
        return !isNaN(score) && score >= min;
      });
    }

    // 4. Hide CAM recordings
    if (hideCam) {
      list = list.filter((item) => !item.isCam);
    }

    // 5. Year / Era
    if (yearEra !== "all") {
      list = list.filter((item) => {
        const y = parseInt(item.year, 10);
        if (Number.isNaN(y)) return true;
        if (yearEra === "2025+") return y >= 2025;
        if (yearEra === "2020-2024") return y >= 2020 && y <= 2024;
        if (yearEra === "2010-2019") return y >= 2010 && y <= 2019;
        if (yearEra === "2000-2009") return y >= 2000 && y <= 2009;
        if (yearEra === "1990-1999") return y >= 1990 && y <= 1999;
        if (yearEra === "classic") return y < 1990;
        return true;
      });
    }

    // 6. Audio Language
    if (audioFilter !== "all") {
      list = list.filter((item) => {
        if (!item.audioLanguage) return true;
        return item.audioLanguage.toLowerCase().includes(audioFilter.toLowerCase());
      });
    }

    // 7. Sorting
    if (sortBy === "rating") {
      list.sort((a, b) => (parseFloat(b.imdbRating ?? "0") || 0) - (parseFloat(a.imdbRating ?? "0") || 0));
    } else if (sortBy === "newest") {
      list.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
    } else if (sortBy === "oldest") {
      list.sort((a, b) => (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0));
    } else if (sortBy === "az") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "za") {
      list.sort((a, b) => b.title.localeCompare(a.title));
    }

    return list;
  }, [data, mediaFilter, genreFilter, ratingFilter, hideCam, yearEra, audioFilter, sortBy]);

  const rawItemCount = data?.length ?? 0;
  const hasMore = rawItemCount >= 20;

  const handlePageChange = (newPage: number) => {
    if (newPage < 1) return;
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!query.trim()) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Discovery"
          title="Search"
          description="Find movies, TV shows, anime and live events across the catalog."
        />
        <EmptyState title="Search the catalog" body="Type a title above, or press Ctrl+K from anywhere." />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Discovery"
        title={`Results for “${query}”`}
        description={
          loading
            ? "Searching catalog..."
            : `Showing ${results.length} ${results.length === 1 ? "title" : "titles"} (Page ${page})${
                activeAdvancedCount > 0 || mediaFilter !== "all" ? " · Filtered" : ""
              }`
        }
      />

      {/* Main Filter Toolbar */}
      <div className="search-filter-toolbar">
        <div className="chip-row">
          <button
            className="chip"
            data-active={mediaFilter === "all"}
            onClick={() => setMediaFilter("all")}
          >
            <Sparkles size={14} /> All
          </button>
          <button
            className="chip"
            data-active={mediaFilter === "movie"}
            onClick={() => setMediaFilter("movie")}
          >
            <Film size={14} /> Movies
          </button>
          <button
            className="chip"
            data-active={mediaFilter === "series"}
            onClick={() => setMediaFilter("series")}
          >
            <Tv size={14} /> TV Series
          </button>
          <button
            className="chip"
            data-active={mediaFilter === "anime"}
            onClick={() => setMediaFilter("anime")}
          >
            <Clapperboard size={14} /> Anime
          </button>
        </div>

        <div className="search-filter-actions">
          <button
            className={`btn btn-sm ${showAdvanced || activeAdvancedCount > 0 ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setShowAdvanced((prev) => !prev)}
            aria-expanded={showAdvanced}
            aria-label="Toggle advanced search filters"
          >
            <SlidersHorizontal size={14} />
            <span>Advanced Filters</span>
            {activeAdvancedCount > 0 && <span className="filter-badge-count">{activeAdvancedCount}</span>}
          </button>

          {(activeAdvancedCount > 0 || mediaFilter !== "all") && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={resetFilters}
              title="Reset all filters"
              aria-label="Reset all filters"
            >
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Expandable Advanced Filter Panel */}
      {showAdvanced && (
        <div className="advanced-filter-panel">
          <div className="filter-control-group">
            <label className="filter-group-label">
              <ArrowUpDown size={13} /> Sort By
            </label>
            <select
              className="select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="relevance">🔥 Relevance (Default)</option>
              <option value="rating">⭐ Highest IMDb Rating</option>
              <option value="newest">📅 Newest Year First</option>
              <option value="oldest">⏳ Oldest Year First</option>
              <option value="az">🔤 Title (A to Z)</option>
              <option value="za">🔤 Title (Z to A)</option>
            </select>
          </div>

          <div className="filter-control-group">
            <label className="filter-group-label">
              <Sparkles size={13} /> Genre
            </label>
            <select
              className="select"
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
            >
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g === "All" ? "All Genres" : g}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-control-group">
            <label className="filter-group-label">
              <Star size={13} /> Minimum Rating
            </label>
            <select
              className="select"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value as RatingFilter)}
            >
              <option value="all">Any Rating</option>
              <option value="8+">⭐ 8.0+ Exceptional</option>
              <option value="7+">⭐ 7.0+ Great</option>
              <option value="6+">⭐ 6.0+ Good</option>
            </select>
          </div>

          <div className="filter-control-group">
            <label className="filter-group-label">
              <Calendar size={13} /> Release Era
            </label>
            <select
              className="select"
              value={yearEra}
              onChange={(e) => setYearEra(e.target.value as YearEra)}
            >
              <option value="all">All Release Years</option>
              <option value="2025+">2025 – 2026+ (Latest)</option>
              <option value="2020-2024">2020 – 2024 (Modern)</option>
              <option value="2010-2019">2010 – 2019 (2010s)</option>
              <option value="2000-2009">2000 – 2009 (2000s)</option>
              <option value="1990-1999">1990 – 1999 (90s Hits)</option>
              <option value="classic">Classics (Pre-1990)</option>
            </select>
          </div>

          <div className="filter-control-group">
            <label className="filter-group-label">
              <Languages size={13} /> Audio Track
            </label>
            <select
              className="select"
              value={audioFilter}
              onChange={(e) => setAudioFilter(e.target.value as AudioFilter)}
            >
              <option value="all">All Audio Tracks</option>
              <option value="en">English Dub / Original</option>
              <option value="ar">Arabic</option>
              <option value="fr">French</option>
              <option value="ja">Japanese (Anime/Original)</option>
              <option value="es">Spanish</option>
              <option value="und">Original Audio Only</option>
            </select>
          </div>

          <div className="filter-control-group filter-control-toggle">
            <label className="filter-group-label">
              <Video size={13} /> Video Quality
            </label>
            <button
              type="button"
              className={`chip ${hideCam ? "active" : ""}`}
              data-active={hideCam}
              onClick={() => setHideCam((prev) => !prev)}
            >
              {hideCam ? "HD / Clean Only" : "Include CAM Rips"}
            </button>
          </div>
        </div>
      )}

      {/* Active Filter Pills Bar */}
      {(activeAdvancedCount > 0 || mediaFilter !== "all") && (
        <div className="search-active-pills">
          {mediaFilter !== "all" && (
            <span className="filter-pill">
              Type: {mediaFilter.toUpperCase()}
              <button onClick={() => setMediaFilter("all")} aria-label="Remove media filter">
                <X size={12} />
              </button>
            </span>
          )}
          {genreFilter !== "All" && (
            <span className="filter-pill">
              Genre: {genreFilter}
              <button onClick={() => setGenreFilter("All")} aria-label="Remove genre filter">
                <X size={12} />
              </button>
            </span>
          )}
          {ratingFilter !== "all" && (
            <span className="filter-pill">
              Rating: {ratingFilter}
              <button onClick={() => setRatingFilter("all")} aria-label="Remove rating filter">
                <X size={12} />
              </button>
            </span>
          )}
          {yearEra !== "all" && (
            <span className="filter-pill">
              Era: {yearEra}
              <button onClick={() => setYearEra("all")} aria-label="Remove era filter">
                <X size={12} />
              </button>
            </span>
          )}
          {audioFilter !== "all" && (
            <span className="filter-pill">
              Audio: {audioFilter.toUpperCase()}
              <button onClick={() => setAudioFilter("all")} aria-label="Remove audio filter">
                <X size={12} />
              </button>
            </span>
          )}
          {sortBy !== "relevance" && (
            <span className="filter-pill">
              Sort: {sortBy}
              <button onClick={() => setSortBy("relevance")} aria-label="Remove sorting filter">
                <X size={12} />
              </button>
            </span>
          )}
          {hideCam && (
            <span className="filter-pill">
              HD Only
              <button onClick={() => setHideCam(false)} aria-label="Remove HD only filter">
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}

      {loading && <SkeletonGrid />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && results.length === 0 && (
        <EmptyState
          title="No matches found"
          body={
            activeAdvancedCount > 0 || mediaFilter !== "all"
              ? "No titles match your current filter settings on this page. Try resetting filters or switching pages."
              : page > 1
                ? "No additional titles found on this page."
                : "Try searching with a shorter title or different spelling."
          }
        />
      )}

      {!loading && !error && results.length > 0 && (
        <>
          <div className="grid">
            {results.map((item) => (
              <PosterCard key={item.id} item={item} />
            ))}
          </div>

          {/* Search Pagination Controller */}
          <nav className="search-pagination" aria-label="Search pagination">
            <button
              type="button"
              className="btn btn-sm btn-ghost pagination-btn"
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
              <span>Previous</span>
            </button>

            <div className="pagination-pills">
              {page > 2 && (
                <button
                  type="button"
                  className="pagination-num-btn"
                  onClick={() => handlePageChange(1)}
                >
                  1
                </button>
              )}
              {page > 3 && <span className="pagination-ellipsis">…</span>}

              {page > 1 && (
                <button
                  type="button"
                  className="pagination-num-btn"
                  onClick={() => handlePageChange(page - 1)}
                >
                  {page - 1}
                </button>
              )}

              <button
                type="button"
                className="pagination-num-btn active"
                aria-current="page"
              >
                {page}
              </button>

              {hasMore && (
                <button
                  type="button"
                  className="pagination-num-btn"
                  onClick={() => handlePageChange(page + 1)}
                >
                  {page + 1}
                </button>
              )}
            </div>

            <button
              type="button"
              className="btn btn-sm btn-ghost pagination-btn"
              disabled={!hasMore}
              onClick={() => handlePageChange(page + 1)}
              aria-label="Next page"
            >
              <span>Next</span>
              <ChevronRight size={16} />
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
