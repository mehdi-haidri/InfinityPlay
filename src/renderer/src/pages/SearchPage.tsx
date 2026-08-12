import { useMemo, useState } from "react";
import type { CatalogItem } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync } from "../hooks/useAsync";
import { PosterCard } from "../components/PosterCard";
import { EmptyState, ErrorState, SkeletonGrid } from "../components/States";
import { useApp } from "../store";

type Filter = "all" | "movie" | "series";

export function SearchPage({ query }: { query: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const preferredAudio = useApp((state) => state.config.preferredAudio);
  const hideAdultContent = useApp((state) => state.config.hideAdultContent);

  const { data, loading, error, reload } = useAsync<CatalogItem[]>(
    () => (query.trim() ? unwrap(api.catalog.search(query, 1)) : Promise.resolve([])),
    [query, preferredAudio, hideAdultContent],
  );

  const results = useMemo(
    () => (data ?? []).filter((item) => filter === "all" || item.mediaType === filter),
    [data, filter],
  );

  if (!query.trim()) {
    return (
      <div className="page">
        <EmptyState title="Search the catalog" body="Type a title above, or press Ctrl+K from anywhere." />
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Results for “{query}”</h1>

      <div className="chip-row" style={{ marginBottom: 22 }}>
        {(["all", "movie", "series"] as Filter[]).map((value) => (
          <button
            key={value}
            className="chip"
            data-active={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === "all" ? "All" : value === "movie" ? "Movies" : "Series"}
          </button>
        ))}
      </div>

      {loading && <SkeletonGrid />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && results.length === 0 && (
        <EmptyState title="No matches" body="Try a shorter query or a different spelling." />
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
