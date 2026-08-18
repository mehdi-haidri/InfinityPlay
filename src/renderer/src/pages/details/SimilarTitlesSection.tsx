import { useEffect, useState } from "react";
import { Sparkles, Star } from "lucide-react";
import type { CatalogItem, MediaType } from "@shared/types";
import { api, unwrap } from "../../lib/api";
import { MediaImage } from "../../components/MediaImage";
import { useApp } from "../../store";

interface Props {
  currentId: string;
  genre?: string;
  mediaType: MediaType;
  title: string;
}

export function SimilarTitlesSection({ currentId, genre, mediaType, title }: Props) {
  const navigate = useApp((state) => state.navigate);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const query = genre || title.split(" ")[0] || "Action";

    setLoading(true);
    unwrap(api.catalog.search(query))
      .then((results) => {
        if (cancelled) return;
        // Filter out current media and keep items of similar type
        const filtered = (results || []).filter(
          (item) => item.id !== currentId && (!item.mediaType || item.mediaType === mediaType),
        );
        setItems(filtered.slice(0, 12));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentId, genre, mediaType, title]);

  if (!loading && items.length === 0) return null;

  return (
    <section className="section cinematic-similar-section">
      <div className="similar-section-header">
        <h2 className="section-title cinematic-section-title">
          <Sparkles size={16} /> More Like This
        </h2>
        {genre && <span className="similar-genre-label">Based on {genre}</span>}
      </div>

      <div className="similar-scroll-row">
        {items.map((item) => (
          <div
            className="similar-card"
            key={item.id}
            onClick={() => navigate({ name: "details", id: item.id })}
            title={item.title}
          >
            <div className="similar-card-poster">
              <MediaImage src={item.posterUrl} label={item.title} alt={item.title} />
              {item.imdbRating && (
                <div className="similar-rating-badge">
                  <Star size={11} fill="#ffd166" color="#ffd166" />
                  <span>{item.imdbRating}</span>
                </div>
              )}
            </div>
            <div className="similar-card-info">
              <div className="similar-card-title">{item.title}</div>
              <div className="similar-card-meta">
                {item.year && <span>{item.year}</span>}
                {item.mediaType && (
                  <span>{item.mediaType === "series" ? "TV Series" : "Movie"}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
