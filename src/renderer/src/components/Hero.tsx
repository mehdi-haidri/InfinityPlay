import { useEffect, useState } from "react";
import { Info, Star } from "lucide-react";
import type { CatalogItem } from "@shared/types";
import { useApp } from "../store";
import { MediaImage } from "./MediaImage";
import { WatchIcon } from "./CoreIcons";

const ROTATE_MS = 9000;

export function Hero({ items }: { items: CatalogItem[] }) {
  const navigate = useApp((state) => state.navigate);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visibilityPaused, setVisibilityPaused] = useState(document.hidden);
  const [motionAllowed, setMotionAllowed] = useState(true);

  const slides = items.slice(0, 6);

  useEffect(() => {
    if (slides.length < 2 || paused || visibilityPaused || !motionAllowed) return;
    const timer = setInterval(() => setIndex((value) => (value + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [slides.length, paused, visibilityPaused, motionAllowed]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMotionAllowed(!media.matches);
    sync();
    media.addEventListener("change", sync);
    const visibility = () => setVisibilityPaused(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  if (slides.length === 0) return null;
  const active = slides[Math.min(index, slides.length - 1)];

  return (
    <section
      className="hero hero-featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      aria-roledescription="carousel"
      aria-label="Featured titles"
    >
      {active.posterUrl && (
        <div
          className="hero-bg hero-bg-poster"
          style={{ backgroundImage: `url("${active.posterUrl}")` }}
          key={active.id}
        />
      )}

      <div className="hero-poster-wrap" key={`poster-${active.id}`}>
        <MediaImage
          src={active.posterUrl}
          label={active.title}
          alt=""
          className="hero-poster"
          loading="eager"
        />
      </div>

      <div className="hero-content">
        <h1 className="hero-title">{active.title}</h1>
        <div className="hero-meta">
          <span>{active.mediaType === "series" ? "Series" : "Movie"}</span>
          {active.year && <span>· {active.year}</span>}
          {active.imdbRating && (
            <span className="hero-rating">
              · <Star size={13} fill="#ffd166" color="#ffd166" /> {active.imdbRating}
            </span>
          )}
        </div>
        {active.description && <p className="hero-desc">{active.description}</p>}

        <div className="inline-actions">
          <button
            className="btn btn-primary"
            onClick={() => navigate({ name: "details", id: active.id })}
          >
            <WatchIcon size={17} /> Watch now
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
