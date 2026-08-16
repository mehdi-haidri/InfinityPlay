import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Search, X } from "lucide-react";
import type { CatalogItem } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useDebounced } from "../hooks/useAsync";
import { useDeviceProfile } from "../hooks/useDeviceProfile";
import { useApp } from "../store";
import { MediaImage } from "./MediaImage";

export function TopBar() {
  const route = useApp((state) => state.route);
  const navigate = useApp((state) => state.navigate);
  const goBack = useApp((state) => state.goBack);
  const goForward = useApp((state) => state.goForward);
  const historyLength = useApp((state) => state.history.length);
  const futureLength = useApp((state) => state.future.length);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([]);
  const [open, setOpen] = useState(false);
  /** True once the page has moved, which is when the bar needs a background to stay readable. */
  const [scrolled, setScrolled] = useState(false);

  /*
   * At the top of a page the bar sits over the hero artwork and a slab of colour cuts it in half,
   * so it stays transparent until there is content passing underneath it.
   */
  useEffect(() => {
    // `.main` is the scroll container; the bar is sticky inside it, so the window never scrolls.
    const scroller = document.querySelector<HTMLElement>(".main");
    if (!scroller) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(scroller.scrollTop > 8);
    };
    const onScroll = () => {
      // Coalesced into a frame: this fires continuously while scrolling.
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  // A new page starts at the top, so the bar goes back to transparent with it.
  useEffect(() => {
    setScrolled((document.querySelector<HTMLElement>(".main")?.scrollTop ?? 0) > 8);
  }, [route]);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(query, 320);
  /*
   * The placeholder names what this field searches, at every width.
   *
   * A bare "Search" here sat directly above pages with their own search box — "Filter channels" on
   * Live TV, "Search free films" in the library — and read as a duplicate of them rather than as
   * the catalogue search it is. There is no Ctrl+K on a phone, and the full hint is clipped at
   * that width, so only the shortcut is dropped.
   */
  const device = useDeviceProfile();
  const placeholder =
    device === "phone"
      ? "Search movies & series"
      : device === "tablet"
        ? "Search movies, series, anime…"
        : "Search movies, series, anime…   (Ctrl+K)";

  // Keep the field in sync when navigation changes the active search.
  useEffect(() => {
    if (route.name === "search") setQuery(route.query);
  }, [route]);

  // Ctrl/Cmd+K focuses search from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    const isMobileTouch = window.matchMedia("(pointer: coarse)").matches && window.innerWidth <= 768;
    if (isMobileTouch) return;

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = debounced.trim();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    unwrap(api.catalog.suggest(term))
      .then((items) => {
        if (!cancelled) {
          setSuggestions(items);
          setHighlight(-1);
        }
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const submit = (term: string) => {
    const trimmed = term.trim();
    if (trimmed.length === 0) return;
    setOpen(false);
    navigate({ name: "search", query: trimmed });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setHighlight((value) => (value + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setHighlight((value) => (value <= 0 ? suggestions.length - 1 : value - 1));
      return;
    }
    if (event.key === "Enter") {
      const picked = highlight >= 0 ? suggestions[highlight] : null;
      if (picked) {
        setOpen(false);
        navigate({ name: "details", id: picked.id });
      } else {
        submit(query);
      }
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  /*
   * Reloads the current page and nothing more.
   *
   * This used to clear the catalog cache as well, which turned an ordinary refresh into several
   * seconds of refetching every row. Re-entering the same route re-runs the page's effects, so
   * anything stale on screen is rebuilt while cached responses are still reused.
   */
  const refresh = () => {
    const current = useApp.getState().route;
    useApp.setState({ route: { name: "home" } });
    setTimeout(() => useApp.setState({ route: current }), 0);
  };

  return (
    <header className="topbar" data-scrolled={scrolled || undefined}>
      <button
        className="icon-button"
        onClick={goBack}
        disabled={historyLength === 0}
        aria-label="Back"
      >
        <ArrowLeft size={18} />
      </button>
      <button
        className="icon-button"
        onClick={goForward}
        disabled={futureLength === 0}
        aria-label="Forward"
      >
        <ArrowRight size={18} />
      </button>

      <div className="search">
        <div className="search-field">
          <Search size={16} color="var(--text-faint)" />
          <input
            ref={inputRef}
            value={query}
            placeholder={placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 140)}
            onKeyDown={onKeyDown}
            aria-label="Search movies, series and anime"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls="search-suggestions"
            aria-activedescendant={highlight >= 0 ? `search-suggestion-${suggestions[highlight]?.id}` : undefined}
          />
          {query && (
            <button className="icon-button" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
        </div>

        {open && suggestions.length > 0 && (
          <div id="search-suggestions" className="suggestions" role="listbox" aria-label="Search suggestions">
            {suggestions.map((item, index) => (
              <button
                key={item.id}
                className="suggestion"
                role="option"
                id={`search-suggestion-${item.id}`}
                aria-selected={index === highlight}
                data-active={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  navigate({ name: "details", id: item.id });
                }}
              >
                <MediaImage src={item.posterUrl} label={item.title} alt="" className="suggestion-art" />
                <span>{item.title}</span>
                <span className="suggestion-meta">
                  {[item.year, item.mediaType === "series" ? "Series" : "Movie"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="icon-button" onClick={refresh} aria-label="Reload this page" title="Reload this page">
        <RotateCw size={17} />
      </button>
    </header>
  );
}
