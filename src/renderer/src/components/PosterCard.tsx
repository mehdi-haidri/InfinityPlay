import { Star } from "lucide-react";
import type { CatalogItem } from "@shared/types";
import { useApp } from "../store";
import { MediaImage } from "./MediaImage";
import { WatchIcon } from "./CoreIcons";

interface Props {
  item: CatalogItem;
  /** 0–1 watch progress; renders the resume strip when above zero. */
  progress?: number;
  onOpen?: (item: CatalogItem) => void;
}

export function PosterCard({ item, progress = 0, onOpen }: Props) {
  const navigate = useApp((state) => state.navigate);
  const open = () => (onOpen ? onOpen(item) : navigate({ name: "details", id: item.id }));

  return (
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
  );
}
