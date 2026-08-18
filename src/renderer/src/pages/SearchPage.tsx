import { useMemo, useState } from "react";
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
} from "lucide-react";
import { api, unwrap } from "../lib/api";
import { useAsync } from "../hooks/useAsync";
import { PosterCard } from "../components/PosterCard";
import { EmptyState, ErrorState, SkeletonGrid } from "../components/States";
import { useApp } from "../store";
import { PageHeader } from "../components/PageHeader";

type MediaFilter = "all" | "movie" | "series";
type SortOption = "relevance" | "newest" | "oldest" | "az" | "za";
type YearEra = "all" | "2025+" | "2020-2024" | "2010-2019" | "2000-2009" | "classic";
type AudioFilter = "all" | "en" | "ar" | "fr" | "ja" | "und";

export function SearchPage({ query }: { query: string }) {
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("relevance");
  const [yearEra, setYearEra] = useState<YearEra>("all");
  const [audioFilter, setAudioFilter] = useState<AudioFilter>("all");
  const [hideCam, setHideCam] = useState(false);

  const preferredAudio = useApp((state) => state.config.preferredAudio);
  const hideAdultContent = useApp((state) => state.config.hideAdultContent);

  const { data, loading, error, reload } = useAsync<CatalogItem[]>(
    () => (query.trim() ? unwrap(api.catalog.search(query, 1)) : Promise.resolve([])),
    [query, preferredAudio, hideAdultContent],
  );

  const activeAdvancedCount = useMemo(() => {
    let count = 0;
    if (sortBy !== "relevance") count++;
    if (yearEra !== "all") count++;
    if (audioFilter !== "all") count++;
    if (hideCam) count++;
    return count;
  }, [sortBy, yearEra, audioFilter, hideCam]);

  const resetFilters = () => {
    setMediaFilter("all");
    setSortBy("relevance");
    setYearEra("all");
    setAudioFilter("all");
    setHideCam(false);
  };

  const results = useMemo(() => {
    let list = [...(data ?? [])];

    // 1. Media type
    if (mediaFilter !== "all") {
      list = list.filter((item) => item.mediaType === mediaFilter);
    }

    // 2. Hide CAM recordings
    if (hideCam) {
      list = list.filter((item) => !item.isCam);
    }

    // 3. Year / Era
    if (yearEra !== "all") {
      list = list.filter((item) => {
        const y = parseInt(item.year, 10);
        if (Number.isNaN(y)) return true;
        if (yearEra === "2025+") return y >= 2025;
        if (yearEra === "2020-2024") return y >= 2020 && y <= 2024;
        if (yearEra === "2010-2019") return y >= 2010 && y <= 2019;
        if (yearEra === "2000-2009") return y >= 2000 && y <= 2009;
        if (yearEra === "classic") return y < 2000;
        return true;
      });
    }

    // 4. Audio Language
    if (audioFilter !== "all") {
      list = list.filter((item) => {
        if (!item.audioLanguage) return true;
        return item.audioLanguage.toLowerCase().includes(audioFilter.toLowerCase());
      });
    }

    // 5. Sorting
    if (sortBy === "newest") {
      list.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
    } else if (sortBy === "oldest") {
      list.sort((a, b) => (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0));
    } else if (sortBy === "az") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "za") {
      list.sort((a, b) => b.title.localeCompare(a.title));
    }

    return list;
  }, [data, mediaFilter, hideCam, yearEra, audioFilter, sortBy]);

  if (!query.trim()) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Discovery"
          title="Search"
          description="Find movies and series across the full catalog."
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
        description={`${results.length} matching ${results.length === 1 ? "title" : "titles"}${
          activeAdvancedCount > 0 || mediaFilter !== "all" ? " (filtered)" : ""
        }`}
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
        </div>

        <div className="search-filter-actions">
          <button
            className={`btn btn-sm ${showAdvanced || activeAdvancedCount > 0 ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setShowAdvanced((prev) => !prev)}
            aria-expanded={showAdvanced}
            aria-label="Toggle advanced search filters"
          >
            <SlidersHorizontal size={14} />
            <span>Filters</span>
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
              <option value="relevance">Relevance</option>
              <option value="newest">Newest Year First</option>
              <option value="oldest">Oldest Year First</option>
              <option value="az">Title (A to Z)</option>
              <option value="za">Title (Z to A)</option>
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
              <option value="2020-2024">2020 – 2024</option>
              <option value="2010-2019">2010 – 2019</option>
              <option value="2000-2009">2000 – 2009</option>
              <option value="classic">Classics (Before 2000)</option>
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
              <option value="ja">Japanese</option>
              <option value="und">Original Audio</option>
            </select>
          </div>

          <div className="filter-control-group filter-control-toggle">
            <label className="filter-group-label">
              <Video size={13} /> Quality
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

      {loading && <SkeletonGrid />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && results.length === 0 && (
        <EmptyState
          title="No matches found"
          body={
            activeAdvancedCount > 0 || mediaFilter !== "all"
              ? "No titles match the selected filters. Try resetting or relaxing filter criteria."
              : "Try a shorter query or a different spelling."
          }
        />
      )}

      {!loading && !error && results.length > 0 && (
        <div className="grid">
          {results.map((item) => (
            <PosterCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
