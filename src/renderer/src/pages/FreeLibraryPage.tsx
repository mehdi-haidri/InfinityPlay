import { useMemo, useState } from "react";
import { ExternalLink, LibraryBig, Play, Search, ShieldCheck } from "lucide-react";
import type { FreeMediaItem, FreeMediaProvider } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync, useDebounced } from "../hooks/useAsync";
import { EmptyState, ErrorState, SkeletonGrid, Spinner } from "../components/States";
import { MediaImage } from "../components/MediaImage";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../store";

const PROVIDERS: { id: FreeMediaProvider; label: string; description: string }[] = [
  { id: "loc", label: "Library of Congress", description: "Historic films from the National Screening Room." },
  { id: "wikimedia", label: "Wikimedia Commons", description: "Freely licensed and public-domain films and video." },
];

export function FreeLibraryPage() {
  const openPlayer = useApp((state) => state.openPlayer);
  const notify = useApp((state) => state.notify);
  const [provider, setProvider] = useState<FreeMediaProvider>("loc");
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState("");
  const debounced = useDebounced(query, 300);

  const requestKey = `${provider}:${debounced.trim().toLowerCase()}`;
  const { data, loading, error, reload } = useAsync<FreeMediaItem[]>(
    () => debounced.trim()
      ? unwrap(api.freeMedia.search(provider, debounced.trim(), 1))
      : unwrap(api.freeMedia.browse(provider, 1)),
    [requestKey],
  );

  const providerInfo = useMemo(() => PROVIDERS.find((entry) => entry.id === provider)!, [provider]);

  const play = async (item: FreeMediaItem) => {
    if (opening) return;
    setOpening(item.id);
    try {
      const resolved = item.streamUrl ? item : await unwrap(api.freeMedia.details(item.provider, item.id));
      if (!resolved.streamUrl) throw new Error("This item has metadata but no directly playable video file.");
      openPlayer({
        title: resolved.title,
        subtitleLine: [resolved.year, resolved.rights || "Free cultural archive"].filter(Boolean).join(" · "),
        url: resolved.streamUrl,
        live: false,
        posterUrl: resolved.posterUrl,
        year: resolved.year,
        mediaType: "movie",
      });
    } catch (cause) {
      notify({
        kind: "error",
        title: "Could not open this film",
        body: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setOpening("");
    }
  };

  const openCollection = () => {
    const url = provider === "loc"
      ? "https://www.loc.gov/collections/national-screening-room/"
      : "https://commons.wikimedia.org/wiki/Category:Videos_of_films";
    void unwrap(api.system.openExternal(url));
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Rights-cleared media"
        title="Free Library"
        description="Watch public-domain and openly licensed films with their source and rights attached."
      />

      <div className="chip-row page-filters">
        {PROVIDERS.map((entry) => (
          <button key={entry.id} className="chip" data-active={provider === entry.id} onClick={() => setProvider(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      <div className="panel free-library-toolbar">
        <div>
          <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <ShieldCheck size={16} /> {providerInfo.label}
          </div>
          <div className="setting-hint">{providerInfo.description}</div>
        </div>
        <div className="search-field free-library-search">
          <Search size={15} color="var(--text-faint)" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search free films" aria-label="Search free films" />
        </div>
        <button className="btn btn-sm btn-ghost" onClick={openCollection}><ExternalLink size={14} /> Source site</button>
      </div>

      {loading && <SkeletonGrid />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState title="No free films found" body="Try another search or switch archive." />
      )}

      {!loading && !error && (data ?? []).length > 0 && (
        <div className="grid">
          {(data ?? []).map((item) => (
            <article className="poster-card-shell" key={`${item.provider}:${item.id}`}>
              <button className="card" onClick={() => void play(item)} title={item.title}>
                <div className="card-art">
                  <MediaImage src={item.posterUrl} label={item.title} alt="" />
                  <span className="badge">{item.rights || "Archive"}</span>
                  <span className="card-overlay"><span className="play-bubble">{opening === item.id ? <Spinner /> : <Play size={19} fill="currentColor" />}</span></span>
                </div>
                <div>
                  <div className="card-title">{item.title}</div>
                  <div className="card-sub">{[item.year, item.creator].filter(Boolean).join(" · ") || "Free media"}</div>
                </div>
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="free-library-note"><LibraryBig size={15} /> Rights vary per item; InfinityPlay preserves the archive’s rights label and source link.</div>
    </div>
  );
}
