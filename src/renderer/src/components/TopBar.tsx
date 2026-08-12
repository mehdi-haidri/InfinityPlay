import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Search, X } from "lucide-react";
import type { CatalogItem } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useDebounced } from "../hooks/useAsync";
import { useApp } from "../store";
import { MediaImage } from "./MediaImage";

export function TopBar() {
  const route = useApp((state) => state.route);
  const navigate = useApp((state) => state.navigate);
  const goBack = useApp((state) => state.goBack);
  const goForward = useApp((state) => state.goForward);
  const historyLength = useApp((state) => state.history.length);
  const futureLength = useApp((state) => state.future.length);
  const notify = useApp((state) => state.notify);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(query, 320);

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

  const refresh = async () => {
    try {
      await unwrap(api.catalog.clearCache());
      notify({ kind: "info", title: "Cache cleared", body: "Fresh data on the next request." });
      // Re-entering the same route forces the page effects to run again.
      const current = useApp.getState().route;
      useApp.setState({ route: { name: "home" } });
      setTimeout(() => useApp.setState({ route: current }), 0);
    } catch (error) {
      notify({
        kind: "error",
        title: "Refresh failed",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <header className="topbar">
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
            placeholder="Search movies, series, anime…   (Ctrl+K)"
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 140)}
            onKeyDown={onKeyDown}
            aria-label="Search"
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

      <button className="icon-button" onClick={refresh} aria-label="Clear cache and refresh">
        <RotateCw size={17} />
      </button>
    </header>
  );
}
