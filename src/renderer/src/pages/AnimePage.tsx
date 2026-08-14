import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogItem } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useInView } from "../hooks/useInView";
import { EmptyState, ErrorState, SkeletonGrid, Spinner } from "../components/States";
import { PageHeader } from "../components/PageHeader";
import { PosterCard } from "../components/PosterCard";
import { useApp } from "../store";

type Filter = "all" | "series" | "movie";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "series", label: "Series" },
  { id: "movie", label: "Films" },
];

/**
 * The anime browser.
 *
 * Loads a page at a time and asks for the next one as the user reaches the end of the grid, so
 * the first screenful arrives without waiting for a catalog the user may never scroll through.
 */
export function AnimePage() {
  const preferredAudio = useApp((state) => state.config.preferredAudio);
  const hideAdultContent = useApp((state) => state.config.hideAdultContent);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const { ref: sentinel, inView } = useInView<HTMLDivElement>("400px");

  // A settings change makes every page already on screen wrong, so the list starts over.
  const settingsKey = `${preferredAudio}:${hideAdultContent}`;
  const requested = useRef("");

  useEffect(() => {
    setItems([]);
    setPage(1);
    setExhausted(false);
    requested.current = "";
  }, [settingsKey]);

  const load = useCallback(
    async (target: number) => {
      const key = `${settingsKey}:${target}`;
      if (requested.current === key) return;
      requested.current = key;

      setLoading(true);
      setError(null);
      try {
        const batch = await unwrap(api.catalog.anime(target));
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...batch.filter((item) => !seen.has(item.id))];
        });
        if (batch.length === 0) setExhausted(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [settingsKey],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  // Reaching the sentinel is the request for more.
  useEffect(() => {
    if (inView && !loading && !exhausted && !error) setPage((current) => current + 1);
  }, [inView, loading, exhausted, error]);

  const shown = filter === "all" ? items : items.filter((item) => item.mediaType === filter);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Animation from Japan and beyond"
        title="Anime"
        description="Series and films, in their original audio wherever the catalog carries it."
      />

      <div className="chip-row page-filters">
        {FILTERS.map((entry) => (
          <button key={entry.id} className="chip" data-active={filter === entry.id} onClick={() => setFilter(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {error && items.length === 0 && <ErrorState message={error} onRetry={() => void load(page)} />}
      {loading && items.length === 0 && <SkeletonGrid />}

      {shown.length > 0 && (
        <div className="grid">
          {shown.map((item) => (
            <PosterCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {!loading && !error && shown.length === 0 && items.length > 0 && (
        <EmptyState title="Nothing in this filter" body="Switch back to Everything to see the full list." />
      )}
      {!loading && !error && items.length === 0 && (
        <EmptyState title="No anime found" body="The catalog returned nothing for this section." />
      )}

      {/* Crossing this is what asks for the next page. */}
      <div ref={sentinel} className="grid-sentinel">
        {loading && items.length > 0 && <Spinner />}
        {exhausted && items.length > 0 && <span className="setting-hint">That is everything the catalog has.</span>}
        {error && items.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => void load(page)}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
