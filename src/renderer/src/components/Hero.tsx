import { useEffect, useState } from "react";
import { Info, Play, Star } from "lucide-react";
import type { CatalogItem } from "@shared/types";
import { useApp } from "../store";

const ROTATE_MS = 9000;

export function Hero({ items }: { items: CatalogItem[] }) {
  const navigate = useApp((state) => state.navigate);
  const [index, setIndex] = useState(0);

  const slides = items.slice(0, 6);

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => setIndex((value) => (value + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [slides.length]);

  if (slides.length === 0) return null;
  const active = slides[Math.min(index, slides.length - 1)];

  return (
    <section className="hero">
      {active.posterUrl && (
        <div
          className="hero-bg"
          style={{ backgroundImage: `url("${active.posterUrl}")` }}
          key={active.id}
        />
      )}

      <div className="hero-content">
        <h1 className="hero-title">{active.title}</h1>
        <div className="hero-meta">
          <span>{active.mediaType === "series" ? "Series" : "Movie"}</span>
          {active.year && <span>· {active.year}</span>}
          {active.imdbRating && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              · <Star size={13} fill="#ffd166" color="#ffd166" /> {active.imdbRating}
            </span>
          )}
        </div>
        {active.description && <p className="hero-desc">{active.description}</p>}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn btn-primary"
            onClick={() => navigate({ name: "details", id: active.id })}
          >
            <Play size={17} fill="currentColor" /> Watch now
          </button>
          <button
            className="btn"
            onClick={() => navigate({ name: "details", id: active.id })}
          >
            <Info size={17} /> More info
          </button>
        </div>
      </div>

      {slides.length > 1 && (
        <div className="hero-dots">
          {slides.map((slide, slideIndex) => (
            <button
              key={slide.id}
              data-active={slideIndex === index}
              onClick={() => setIndex(slideIndex)}
              aria-label={`Show ${slide.title}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
