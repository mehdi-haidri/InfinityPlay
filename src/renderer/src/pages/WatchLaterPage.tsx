import { useMemo, useState } from "react";
import { Clock3, Trash2 } from "lucide-react";
import type { MediaType } from "@shared/types";
import { PosterCard } from "../components/PosterCard";
import { EmptyState } from "../components/States";
import { useApp } from "../store";

type QueueFilter = "all" | MediaType;

/**
 * The watch-later queue.
 *
 * Deliberately not the favourites page with a different title: a favourite is something kept, and
 * this is a list meant to be emptied — so it is ordered newest first, each card can be removed as
 * soon as it has been watched, and the whole queue can be cleared at once.
 */
export function WatchLaterPage() {
  const watchLater = useApp((state) => state.watchLater);
  const toggleWatchLater = useApp((state) => state.toggleWatchLater);
  const clearWatchLater = useApp((state) => state.clearWatchLater);
  const [filter, setFilter] = useState<QueueFilter>("all");

  const visible = useMemo(
    () => (filter === "all" ? watchLater : watchLater.filter((item) => item.mediaType === filter)),
    [watchLater, filter],
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Your library</div>
          <h1 className="page-title">Watch later</h1>
          <p className="page-description">
            {watchLater.length === 0
              ? "Titles you save for another time appear here."
              : `${watchLater.length} title${watchLater.length === 1 ? "" : "s"} waiting.`}
          </p>
        </div>
        {watchLater.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => void clearWatchLater()}>
            <Trash2 size={15} /> Clear all
          </button>
        )}
      </header>

      {watchLater.length > 0 && (
        <div className="chip-row page-filters" role="group" aria-label="Filter watch later">
          {(["all", "movie", "series"] as const).map((value) => (
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
      )}

      {visible.length > 0 ? (
        <div className="grid">
          {visible.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              onRemove={() => void toggleWatchLater(item)}
              removeLabel="watch later"
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={watchLater.length === 0 ? "Nothing saved yet" : "Nothing in this filter"}
          body={
            watchLater.length === 0
              ? "Use the clock button on any poster to put a title aside for later."
              : "Switch back to All to see the rest of the queue."
          }
          action={
            watchLater.length === 0 ? (
              <button className="btn btn-primary btn-sm" onClick={() => useApp.getState().navigate({ name: "home" })}>
                Explore trending titles
              </button>
            ) : undefined
          }
        />
      )}

      {watchLater.length > 0 && (
        <p className="setting-hint" style={{ marginTop: 18, display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Clock3 size={14} /> Saved on this device only.
        </p>
      )}
    </div>
  );
}
