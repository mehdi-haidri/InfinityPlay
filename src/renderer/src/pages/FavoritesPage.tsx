import { useMemo, useState } from "react";
import type { MediaType } from "@shared/types";
import { PosterCard } from "../components/PosterCard";
import { EmptyState } from "../components/States";
import { useApp } from "../store";

type FavoriteFilter = "all" | MediaType;

export function FavoritesPage() {
  const favorites = useApp((state) => state.favorites);
  const toggleFavorite = useApp((state) => state.toggleFavorite);
  const navigate = useApp((state) => state.navigate);
  const [filter, setFilter] = useState<FavoriteFilter>("all");
  const visible = useMemo(
    () => filter === "all" ? favorites : favorites.filter((item) => item.mediaType === filter),
    [favorites, filter],
  );

  return (
    <div className="page favorites-page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Your library</div>
          <h1 className="page-title">Favorites</h1>
          <p className="page-description">Movies and series saved on this device.</p>
        </div>
      </header>

      <div className="chip-row page-filters" role="group" aria-label="Filter favorites">
        {(["all", "movie", "series"] as const).map((value) => (
          <button key={value} className="chip" data-active={filter === value} onClick={() => setFilter(value)}>
            {value === "all" ? "All" : value === "movie" ? "Movies" : "Series"}
          </button>
        ))}
      </div>

      {visible.length > 0 ? (
        <div className="grid favorites-grid">
          {visible.map((item) => (
            <PosterCard key={item.id} item={item} onRemove={() => void toggleFavorite(item)} removeLabel="favorites" showFavorite={false} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={favorites.length === 0 ? "No favorites yet" : `No ${filter} favorites`}
          body="Save a title from its details page and it will appear here."
          action={
            <button className="btn btn-primary btn-sm" onClick={() => navigate({ name: "home" })}>
              Browse catalog
            </button>
          }
        />
      )}
    </div>
  );
}
