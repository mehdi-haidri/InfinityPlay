import { useState, useEffect } from "react";
import { Film, X, AlertCircle, ExternalLink } from "lucide-react";
import { Spinner } from "../../components/States";

interface Props {
  isOpen: boolean;
  title: string;
  year?: string;
  type?: "movie" | "series";
  onClose: () => void;
}

export function TrailerModal({ isOpen, title, year, type = "movie", onClose }: Props) {
  const [ytId, setYtId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !title) {
      setYtId(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setYtId(null);

    const fetchTrailer = async () => {
      try {
        const cleanTitle = title
          .replace(/&amp;/g, "&")
          .replace(/\b(1080p|720p|4k|2160p|480p|bluray|web-?rip|hdrip)\b/gi, "")
          .replace(/\(\d{4}\)/g, "")
          .replace(/\[[^\]]*\]/g, "")
          .replace(/[-_&]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // 1. Search Cinemeta for IMDb ID
        const searchRes = await fetch(
          `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(cleanTitle)}.json`,
          { headers: { "User-Agent": "InfinityPlay" }, signal: AbortSignal.timeout(6000) },
        );
        if (!searchRes.ok) throw new Error("Search failed");
        const searchData = (await searchRes.json()) as { metas?: Array<{ id: string; imdb_id?: string; name: string; year?: any }> };
        const match =
          searchData.metas?.find(
            (m) => m.name.toLowerCase() === cleanTitle.toLowerCase() && (!year || String(m.year) === year),
          ) ||
          searchData.metas?.find((m) => m.name.toLowerCase() === cleanTitle.toLowerCase()) ||
          searchData.metas?.[0];

        if (!match) {
          if (!cancelled) setError("No trailer found for this title");
          return;
        }

        const imdbId = match.imdb_id || match.id;
        const metaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, {
          headers: { "User-Agent": "InfinityPlay" },
          signal: AbortSignal.timeout(6000),
        });
        if (!metaRes.ok) throw new Error("Metadata fetch failed");
        const metaData = (await metaRes.json()) as {
          meta?: {
            trailerStreams?: Array<{ ytId?: string }>;
            trailers?: Array<{ source?: string }>;
          };
        };

        const foundYtId =
          metaData.meta?.trailerStreams?.[0]?.ytId || metaData.meta?.trailers?.[0]?.source;

        if (foundYtId) {
          if (!cancelled) setYtId(foundYtId);
        } else {
          if (!cancelled) setError("No official video trailer available");
        }
      } catch {
        if (!cancelled) setError("Could not load trailer");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchTrailer();

    return () => {
      cancelled = true;
    };
  }, [isOpen, title, year, type]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card trailer-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trailer-modal-title"
      >
        <div className="pin-modal-header">
          <div className="pin-modal-title-wrap">
            <div className="pin-modal-icon">
              <Film size={18} />
            </div>
            <div>
              <h3 id="trailer-modal-title" className="pin-modal-title">
                {title} — Trailer
              </h3>
              <p className="pin-modal-sub">Official trailer preview</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close trailer">
            <X size={18} />
          </button>
        </div>

        <div className="trailer-modal-body">
          {loading && (
            <div className="trailer-loading-state">
              <Spinner />
              <span>Loading official trailer…</span>
            </div>
          )}

          {!loading && error && (
            <div className="trailer-error-state">
              <AlertCircle size={28} color="var(--accent)" />
              <p>{error}</p>
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(title + " official trailer")}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm btn-ghost"
                style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <ExternalLink size={14} /> Search on YouTube
              </a>
            </div>
          )}

          {!loading && ytId && (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1`}
              title={`${title} Trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="trailer-iframe"
            />
          )}
        </div>
      </div>
    </div>
  );
}
