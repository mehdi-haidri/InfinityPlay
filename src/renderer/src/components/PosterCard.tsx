import { Heart, Star, X } from "lucide-react";
import type { CatalogItem } from "@shared/types";
import { useApp } from "../store";
import { MediaImage } from "./MediaImage";
import { WatchIcon } from "./CoreIcons";

interface Props {
  item: CatalogItem;
  /** 0–1 watch progress; renders the resume strip when above zero. */
  progress?: number;
  onOpen?: (item: CatalogItem) => void;
  onRemove?: (item: CatalogItem) => void;
  removeLabel?: string;
  /** Off on the Favorites page, where the remove control already covers it. */
  showFavorite?: boolean;
}

export function PosterCard({
  item,
  progress = 0,
  onOpen,
  onRemove,
  removeLabel = "continue watching",
  showFavorite = true,
}: Props) {
  const navigate = useApp((state) => state.navigate);
  const toggleFavorite = useApp((state) => state.toggleFavorite);
  const isFavorite = useApp((state) => state.favorites.some((entry) => entry.id === item.id));
  const open = () => (onOpen ? onOpen(item) : navigate({ name: "details", id: item.id }));

  return (
    <article className="poster-card-shell">
      <button className="card" onClick={open} title={item.title}>
      <div className="card-art">
        <MediaImage src={item.posterUrl} label={item.title} alt="" />

        <span className="badge">
          {item.isCam ? "CAM" : item.mediaType === "series" ? "Series" : "Movie"}
        </span>
        {item.imdbRating && (
          <span className="badge badge-rating">
            <Star size={9} fill="currentColor" style={{ verticalAlign: -1 }} /> {item.imdbRating}
          </span>
        )}

        <span className="card-overlay">
          <span className="play-bubble">
            <WatchIcon size={20} />
          </span>
        </span>

        {progress > 0 && (
          <span className="progress-strip">
            <span style={{ width: `${Math.min(progress, 1) * 100}%` }} />
          </span>
        )}
      </div>

      <div>
        <div className="card-title">{item.title}</div>
        <div className="card-sub">
          {[item.year, item.season > 1 ? `S${item.season}` : null].filter(Boolean).join(" · ")}
        </div>
      </div>
      </button>

      {/* The card itself is a button, so the heart cannot be nested inside it. This overlay is a
          sibling that mirrors the art box exactly, which keeps the control pinned to the poster
          rather than to the shell (which is taller by the title block). */}
      {showFavorite && (
        <div className="card-favorite-layer" aria-hidden={false}>
          <button
            className="card-favorite"
            data-active={isFavorite}
            onClick={() => void toggleFavorite(item)}
            aria-pressed={isFavorite}
            aria-label={
              isFavorite ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`
            }
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart size={15} fill={isFavorite ? "currentColor" : "none"} />
          </button>
        </div>
      )}

      {onRemove && (
        <button
          className="icon-button card-remove-action"
          onClick={() => onRemove(item)}
          aria-label={`Remove ${item.title} from ${removeLabel}`}
          title={`Remove from ${removeLabel}`}
        >
          <X size={14} />
        </button>
      )}
    </article>
  );
}
