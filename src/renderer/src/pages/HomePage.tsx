import { useMemo } from "react";
import { ORIGINAL_AUDIO, type CatalogItem, type HomeRow } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync } from "../hooks/useAsync";
import { useInView } from "../hooks/useInView";
import { Hero } from "../components/Hero";
import { Row } from "../components/Row";
import { ErrorState, SkeletonRow } from "../components/States";
import { findProgress, useApp } from "../store";

/**
 * One Home row, fetched only once it is nearly on screen.
 *
 * The whole screen used to arrive as a single payload — eleven rows built before the first pixel,
 * seconds of blank page — even though only the top two are ever visible at first.
 */
function LazyRow({
  index,
  title,
  deps,
  progressOf,
}: {
  index: number;
  title: string;
  deps: unknown[];
  progressOf: (item: CatalogItem) => number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const { data } = useAsync<HomeRow | null>(
    () => (inView ? unwrap(api.catalog.homeSection(index)) : Promise.resolve(null)),
    [index, inView, ...deps],
  );

  // The placeholder holds a row's worth of height, so nothing below it jumps as rows land.
  if (!data || data.items.length === 0) {
    return (
      <div className="row" ref={ref} aria-busy={inView} aria-label={title}>
        <div className="skeleton" style={{ height: 16, width: 160, marginBottom: 12 }} />
        <SkeletonRow />
      </div>
    );
  }

  return (
    <div ref={ref}>
      <Row title={data.title} items={data.items} progressOf={progressOf} />
    </div>
  );
}

export function HomePage() {
  const watchHistory = useApp((state) => state.watchHistory);
  // Both settings change what the rows resolve to, so both belong in the deps.
  const preferredAudio = useApp((state) => state.config.preferredAudio);
  const catalogCountry = useApp((state) => state.config.catalogCountry);
  const hideAdultContent = useApp((state) => state.config.hideAdultContent);
  const forgetTitle = useApp((state) => state.forgetTitle);
  // The section list costs nothing to fetch: it is a fixed set of titles, not a catalog request.
  const sections = useAsync<string[]>(() => unwrap(api.catalog.homeSections()), []);
  // The hero shares the first row, so that one is always fetched rather than waiting to scroll.
  const first = useAsync<HomeRow>(
    () => unwrap(api.catalog.homeSection(0)),
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

  // Camcorder rips are often the hottest thing in the catalog but make a poor full-bleed hero,
  // so they only headline when there is nothing else.
  const hero = useMemo(() => {
    const items = first.data?.items ?? [];
    return [...items.filter((item) => !item.isCam), ...items.filter((item) => item.isCam)].slice(0, 6);
  }, [first.data]);

  const error = sections.error ?? first.error;
  if (error) {
    return (
      <div className="page">
        <ErrorState
          message={error}
          onRetry={() => {
            sections.reload();
            first.reload();
          }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      {first.loading || hero.length === 0 ? <div className="skeleton home-hero-skeleton" /> : <Hero items={hero} />}

      {continueWatching.length > 0 && (
        <Row
          title="Continue watching"
          items={continueWatching}
          progressOf={(item) =>
            (findProgress(watchHistory, item.id, item.season, 0)?.position ?? 0) /
            Math.max(findProgress(watchHistory, item.id, item.season, 0)?.duration ?? 1, 1)
          }
          onRemove={(item) => void forgetTitle(item.id)}
        />
      )}

      {first.data && first.data.items.length > 0 && (
        <Row title={first.data.title} items={first.data.items} progressOf={progressOf} />
      )}

      {(sections.data ?? []).slice(1).map((title, offset) => (
        <LazyRow
          key={title}
          index={offset + 1}
          title={title}
          deps={[preferredAudio, catalogCountry, hideAdultContent]}
          progressOf={progressOf}
        />
      ))}
    </div>
  );
}
