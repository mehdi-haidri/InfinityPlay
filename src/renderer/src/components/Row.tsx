import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CatalogItem } from "@shared/types";
import { PosterCard } from "./PosterCard";

interface Props {
  title: string;
  items: CatalogItem[];
  progressOf?: (item: CatalogItem) => number;
  onOpen?: (item: CatalogItem) => void;
  onRemove?: (item: CatalogItem) => void;
}

export function Row({ title, items, progressOf, onOpen, onRemove }: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: 1 | -1) => {
    const node = scroller.current;
    if (!node) return;
    node.scrollBy({ left: direction * (node.clientWidth * 0.8), behavior: "smooth" });
  };

  if (items.length === 0) return null;

  /*
   * A handful of cards is not a slider. Showing scroll arrows over four posters and a stretch of
   * empty track reads as a row that failed to load, so a short row drops the arrows and lays its
   * cards out plainly instead.
   */
  const sparse = items.length <= 4;

  return (
    <section className="row">
      <header className="row-header">
        <h2 className="row-title">{title}</h2>
        {!sparse && (
          <div className="row-actions">
            <button className="icon-button" onClick={() => scrollBy(-1)} aria-label={`Scroll ${title} left`} title="Scroll left">
              <ChevronLeft size={18} />
            </button>
            <button className="icon-button" onClick={() => scrollBy(1)} aria-label={`Scroll ${title} right`} title="Scroll right">
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </header>

      <div className="row-scroll" data-sparse={sparse || undefined} ref={scroller}>
        {items.map((item) => (
          <PosterCard
            key={item.id}
            item={item}
            progress={progressOf?.(item) ?? 0}
            onOpen={onOpen}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  );
}
