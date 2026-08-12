import { useMemo } from "react";
import { ORIGINAL_AUDIO, type CatalogItem, type HomePage as HomePayload } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync } from "../hooks/useAsync";
import { Hero } from "../components/Hero";
import { Row } from "../components/Row";
import { ErrorState, SkeletonRow } from "../components/States";
import { findProgress, useApp } from "../store";

export function HomePage() {
  const watchHistory = useApp((state) => state.watchHistory);
  // Both settings change what the rows resolve to, so both belong in the deps.
  const preferredAudio = useApp((state) => state.config.preferredAudio);
  const catalogCountry = useApp((state) => state.config.catalogCountry);
  const hideAdultContent = useApp((state) => state.config.hideAdultContent);
  const { data, loading, error, reload } = useAsync<HomePayload>(
    () => unwrap(api.catalog.home()),
    [preferredAudio, catalogCountry, hideAdultContent],
  );

  const continueWatching = useMemo<CatalogItem[]>(() => {
    // History holds one row per episode, and each audio variant is its own subject, so
    // key on the title rather than the id to get one card per show, newest first.
    const seen = new Set<string>();
    return watchHistory
      .filter((entry) => entry.duration > 0 && entry.position / entry.duration < 0.95)
      .filter((entry) => {
        const key = `${entry.title.toLowerCase()}:${entry.mediaType}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20)
      .map((entry) => ({
        id: entry.subjectId,
        provider: "moviebox" as const,
        title: entry.title,
        rawTitle: entry.title,
        mediaType: entry.mediaType,
        year: entry.year,
        posterUrl: entry.posterUrl,
        season: entry.season,
        // History rows link straight back to the subject that was watched, so the
        // audio track is already whatever the user picked at the time.
        audioLanguage: ORIGINAL_AUDIO,
        isCam: false,
        isAdult: false,
      }));
  }, [watchHistory]);

  const progressBySubject = useMemo(() => {
    const progress = new Map<string, number>();
    for (const entry of watchHistory) {
      if (entry.duration > 0 && !progress.has(entry.subjectId)) {
        progress.set(entry.subjectId, entry.position / entry.duration);
      }
    }
    return progress;
  }, [watchHistory]);

  const progressOf = (item: CatalogItem) => progressBySubject.get(item.id) ?? 0;

  if (error) return <div className="page"><ErrorState message={error} onRetry={reload} /></div>;

  if (loading || !data) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 360, margin: "-76px -28px 28px", borderRadius: 0 }} />
        <div className="row"><div className="skeleton" style={{ height: 16, width: 180, marginBottom: 12 }} /><SkeletonRow /></div>
        <div className="row"><div className="skeleton" style={{ height: 16, width: 140, marginBottom: 12 }} /><SkeletonRow /></div>
      </div>
    );
  }

  return (
    <div className="page">
      <Hero items={data.hero.length > 0 ? data.hero : (data.rows[0]?.items ?? [])} />

      {continueWatching.length > 0 && (
        <Row
          title="Continue watching"
          items={continueWatching}
          progressOf={(item) =>
            (findProgress(watchHistory, item.id, item.season, 0)?.position ?? 0) /
            Math.max(findProgress(watchHistory, item.id, item.season, 0)?.duration ?? 1, 1)
          }
        />
      )}

      {data.rows.map((row, index) => (
        <Row key={`${row.title}-${index}`} title={row.title} items={row.items} progressOf={progressOf} />
      ))}
    </div>
  );
}
