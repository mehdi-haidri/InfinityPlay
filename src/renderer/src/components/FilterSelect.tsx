import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
  /** Shown to the right of the label — channel counts, for instance. */
  count?: number;
}

interface Props {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Shown above the list when there are enough options for search to be useful. */
  searchPlaceholder?: string;
  icon?: React.ReactNode;
  /** Below this many options the search field is hidden — it only adds noise. */
  searchThreshold?: number;
}

/**
 * A select with a search field.
 *
 * A native `<select>` cannot be filtered, which makes 180 countries unusable, and it
 * cannot carry counts or a check mark. This is a listbox instead: a trigger, a popover
 * with its own search, and full keyboard control.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  searchPlaceholder = "Search…",
  icon,
  searchThreshold = 8,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);
  const showSearch = options.length >= searchThreshold;

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => option.label.toLowerCase().includes(term));
  }, [options, query]);

  // Reopening should not inherit the previous search or cursor position.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(Math.max(0, options.findIndex((option) => option.value === value)));
    const timer = window.setTimeout(() => searchRef.current?.focus(), 10);
    return () => window.clearTimeout(timer);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => {
        if (matches.length === 0) return 0;
        const step = event.key === "ArrowDown" ? 1 : -1;
        return (current + step + matches.length) % matches.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = matches[highlight];
      if (option) commit(option.value);
    }
  };

  return (
    <div className="filter-select" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="filter-trigger"
        data-open={open}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        <span className="filter-trigger-label">{selected?.label ?? label}</span>
        {selected?.count !== undefined && <span className="filter-count">{selected.count}</span>}
        <ChevronDown size={14} className="filter-chevron" />
      </button>

      {open && (
        <div className="filter-popover" role="listbox" aria-label={label}>
          {showSearch && (
            <div className="filter-search">
              <Search size={14} color="var(--text-faint)" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlight(0);
                }}
                placeholder={searchPlaceholder}
                aria-label={`Search ${label.toLowerCase()}`}
              />
              {query && (
                <button
                  type="button"
                  className="filter-clear"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          <div className="filter-options" ref={listRef}>
            {matches.map((option, index) => (
              <button
                type="button"
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className="filter-option"
                data-active={option.value === value}
                data-highlight={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => commit(option.value)}
              >
                <span className="filter-option-label">{option.label}</span>
                {option.count !== undefined && (
                  <span className="filter-count">{option.count}</span>
                )}
                {option.value === value && <Check size={14} className="filter-tick" />}
              </button>
            ))}

            {matches.length === 0 && <div className="filter-empty">No match for “{query}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}
