import { useEffect, useMemo, useState } from "react";
import { AudioLines, Captions, Download, Play, Star } from "lucide-react";
import {
  ORIGINAL_AUDIO,
  SUBTITLE_OFF,
  type AudioVariant,
  type MediaDetails,
  type Release,
  type SubtitleOption,
} from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync } from "../hooks/useAsync";
import { formatBytes, qualityLabel } from "../lib/format";
import { EmptyState, ErrorState, LoadingState, Spinner } from "../components/States";
import { MediaImage } from "../components/MediaImage";
import { findProgress, useApp } from "../store";

interface Props {
  id: string;
  /** Carried over when the user switches audio track, so the episode is preserved. */
  initialSeason?: number;
  initialEpisode?: number;
  /** The track was chosen by hand; do not override it with the preferred language. */
  audioLocked?: boolean;
}

export function DetailsPage({ id, initialSeason, initialEpisode, audioLocked }: Props) {
  const notify = useApp((state) => state.notify);
  const beginDownload = useApp((state) => state.beginDownload);
  const preferredAudio = useApp((state) => state.config.preferredAudio);
  const navigate = useApp((state) => state.navigate);
  const openPlayer = useApp((state) => state.openPlayer);
  const watchHistory = useApp((state) => state.watchHistory);
  const defaultResolution = useApp((state) => state.config.defaultResolution);

  const preferredSubtitle = useApp((state) => state.config.preferredSubtitle);

  const [season, setSeason] = useState(initialSeason ?? 1);
  const [episode, setEpisode] = useState(initialEpisode ?? 1);
  const [subtitles, setSubtitles] = useState<SubtitleOption[]>([]);
  const [subtitleChoice, setSubtitleChoice] = useState(preferredSubtitle);

  const details = useAsync<MediaDetails>(() => unwrap(api.catalog.details(id)), [id]);
  const isSeries = details.data?.mediaType === "series" && (details.data?.seasons.length ?? 0) > 0;

  const variants = useAsync<AudioVariant[]>(
    () =>
      details.data
        ? unwrap(api.catalog.audioVariants(details.data.title, details.data.mediaType))
        : Promise.resolve([]),
    [details.data],
  );

  // Resume where the user left off, unless the route already pinned an episode.
  useEffect(() => {
    if (!details.data) return;
    if (initialSeason !== undefined) return;

    const lastWatched = watchHistory.find((entry) => entry.subjectId === details.data!.id);
    if (lastWatched && lastWatched.season > 0) {
      setSeason(lastWatched.season);
      setEpisode(lastWatched.episode || 1);
    } else {
      setSeason(details.data.seasons[0]?.number ?? 1);
      setEpisode(1);
    }
    // Only re-derive when the title itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.data?.id]);

  // Gated on `details.data` so a series never fires the movie-shaped (0, 0) request
  // first and briefly shows the wrong sources while the details response is in flight.
  /**
   * Land on the preferred audio track automatically.
   *
   * The catalog rows are overwhelmingly the dubbed subjects — a typical US trending row is
   * 11 of 12 `[Hindi]` — and the cleaned titles make them indistinguishable from the
   * originals. De-duplication only helps when both variants appear in the same response,
   * which almost never happens in a browse row, so the correction has to happen here,
   * using the variants lookup this page already performs.
   */
  useEffect(() => {
    if (audioLocked) return;
    const media = details.data;
    const options = variants.data;
    if (!media || !options || options.length < 2) return;
    if (media.audioLanguage === preferredAudio) return;

    const target = options.find((variant) => variant.language === preferredAudio);
    if (!target || target.subjectId === media.id) return;

    // Replace rather than push: Back should return to where the user came from, not to
    // the dubbed subject they were silently moved off.
    navigate(
      { name: "details", id: target.subjectId, season: initialSeason, episode: initialEpisode },
      true,
    );
  }, [
    audioLocked,
    details.data,
    variants.data,
    preferredAudio,
    navigate,
    initialSeason,
    initialEpisode,
  ]);

  const releases = useAsync<Release[]>(
    () => {
      const media = details.data;
      if (!media) return Promise.resolve([]);
      const series = media.mediaType === "series" && media.seasons.length > 0;
      return unwrap(api.catalog.releases(id, series ? season : 0, series ? episode : 0));
    },
    [id, details.data, season, episode],
  );

  // Preferred quality first, falling back to the best available.
  const preferred = useMemo(() => {
    const list = releases.data ?? [];
    if (list.length === 0) return null;
    return list.find((release) => release.resolution === defaultResolution) ?? list[0];
  }, [releases.data, defaultResolution]);

  // Captions are keyed on a progressive release's `resourceId`. The adaptive stream
  // carries a manifest id instead, which `get-ext-captions` does not recognise, so the
  // lookup deliberately skips it.
  const captionSource = useMemo(
    () =>
      (releases.data ?? []).find((release) => release.kind !== "dash" && release.resourceId) ??
      preferred,
    [releases.data, preferred],
  );

  useEffect(() => {
    if (!captionSource?.resourceId) {
      setSubtitles([]);
      return;
    }
    let cancelled = false;
    unwrap(api.catalog.subtitles(id, captionSource.resourceId))
      .then((options) => {
        if (!cancelled) setSubtitles(options);
      })
      .catch(() => {
        if (!cancelled) setSubtitles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id, captionSource?.resourceId]);

  if (details.loading) return <div className="page"><LoadingState label="Loading title…" /></div>;
  if (details.error)
    return <div className="page"><ErrorState message={details.error} onRetry={details.reload} /></div>;
  if (!details.data) return <div className="page"><EmptyState title="Title unavailable" /></div>;

  const media = details.data;
  const activeSeason = media.seasons.find((entry) => entry.number === season) ?? media.seasons[0];
  const resume = findProgress(watchHistory, id, isSeries ? season : 0, isSeries ? episode : 0);

  // The subject being viewed is always offered, even if the variant search missed it.
  const audioTracks: AudioVariant[] = (() => {
    const found = variants.data ?? [];
    return found.some((variant) => variant.subjectId === media.id)
      ? found
      : [
          { language: media.audioLanguage, subjectId: media.id, rawTitle: media.rawTitle },
          ...found,
        ];
  })();

  // Null when the picker is on Off, or when this episode has no track in the chosen
  // language — a choice made on one episode should not silently apply the wrong file.
  const activeSubtitle =
    subtitleChoice === SUBTITLE_OFF
      ? null
      : (subtitles.find(
          (option) =>
            option.lang.toLowerCase() === subtitleChoice.toLowerCase() ||
            option.name.toLowerCase() === subtitleChoice.toLowerCase() ||
            option.nativeName.toLowerCase() === subtitleChoice.toLowerCase(),
        ) ?? null);

  /** Each dub is its own subject, so switching audio is a navigation, not a state flip. */
  const switchAudio = (variant: AudioVariant) => {
    if (variant.subjectId === media.id) return;
    navigate({
      name: "details",
      id: variant.subjectId,
      season: isSeries ? season : undefined,
      episode: isSeries ? episode : undefined,
      audioLocked: true,
    });
  };

  const play = (release: Release) => {
    openPlayer({
      title: media.title,
      subtitleLine: isSeries
        ? `Season ${season} · Episode ${episode} · ${qualityLabel(release.resolution)}`
        : `${media.year} · ${qualityLabel(release.resolution)}`,
      url: release.url,
      live: false,
      posterUrl: media.posterUrl,
      subjectId: media.id,
      resourceId: release.resourceId,
      season: isSeries ? season : 0,
      episode: isSeries ? episode : 0,
      mediaType: media.mediaType,
      year: media.year,
      startAt: resume?.position ?? 0,
      releases: releases.data ?? [],
      subtitles,
      episodeCount: activeSeason?.episodes.length ?? 0,
      initialSubtitle: subtitleChoice,
    });
  };

  // The store owns the toast and the progress stream; this only supplies the metadata
  // the Downloads page needs to show a poster and play the file back.
  const download = (release: Release) => {
    const candidates = (releases.data ?? []).filter((item) => item.kind !== "dash");
    const downloadable = release.kind === "dash"
      ? candidates.find((item) => item.resolution <= release.resolution) ?? candidates[0]
      : release;
    if (!downloadable) {
      notify({
        kind: "error",
        title: "No downloadable file",
        body: "This title only provides an adaptive stream. A standalone MP4 is not available.",
      });
      return;
    }
    if (downloadable !== release) {
      notify({
        kind: "info",
        title: `Downloading ${qualityLabel(downloadable.resolution)}`,
        body: "The higher-quality option is adaptive, so InfinityPlay selected the best standalone MP4.",
      });
    }
    void beginDownload({
      url: downloadable.url,
      // Captions hang off a progressive release; the adaptive manifest has no caption id.
      resourceId: captionSource?.resourceId ?? downloadable.resourceId,
      title: media.title,
      year: media.year,
      posterUrl: media.posterUrl,
      subjectId: media.id,
      mediaType: media.mediaType,
      season: isSeries ? season : 0,
      episode: isSeries ? episode : 0,
      resolution: downloadable.resolution,
      sourceKind: downloadable.kind ?? "mp4",
    });
  };

  return (
    <div className="page">
      <section className="hero" style={{ height: 380 }}>
        {media.backdropUrl && (
          <div className="hero-bg" style={{ backgroundImage: `url("${media.backdropUrl}")` }} />
        )}
        <div className="hero-content">
          <h1 className="hero-title" style={{ fontSize: 34 }}>{media.title}</h1>
          <div className="hero-meta">
            {media.imdbRating && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Star size={13} fill="#ffd166" color="#ffd166" /> {media.imdbRating}
              </span>
            )}
            {media.year && <span>· {media.year}</span>}
            {media.duration && <span>· {media.duration}</span>}
            {media.country && <span>· {media.country}</span>}
          </div>
          {media.genres.length > 0 && (
            <div className="chip-row" style={{ marginBottom: 14 }}>
              {media.genres.map((genre) => (
                <span className="chip" key={genre}>{genre}</span>
              ))}
            </div>
          )}

          {audioTracks.length > 1 && (
            <div className="chip-row" style={{ marginBottom: 16, alignItems: "center" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--text-faint)",
                }}
              >
                <AudioLines size={14} /> Audio
              </span>
              {audioTracks.map((variant) => (
                <button
                  key={variant.subjectId}
                  className="chip"
                  data-active={variant.subjectId === media.id}
                  onClick={() => switchAudio(variant)}
                  title={variant.rawTitle}
                >
                  {variant.language}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn btn-primary"
              disabled={!preferred}
              onClick={() => preferred && play(preferred)}
            >
              {releases.loading ? <Spinner /> : <Play size={17} fill="currentColor" />}
              {resume && resume.position > 30 ? "Resume" : "Play"}
              {preferred ? ` · ${qualityLabel(preferred.resolution)}` : ""}
            </button>
            <button
              className="btn"
              disabled={!preferred}
              onClick={() => preferred && download(preferred)}
            >
              <Download size={17} /> Download
            </button>
          </div>
        </div>
      </section>

      <div className="details-body">
        <div>
          {media.description && (
            <section className="section">
              <h2 className="section-title">Overview</h2>
              <p style={{ color: "var(--text-muted)", maxWidth: 760 }}>{media.description}</p>
            </section>
          )}

          {isSeries && activeSeason && (
            <section className="section">
              <h2 className="section-title">Episodes</h2>

              <div className="chip-row" style={{ marginBottom: 16 }}>
                {media.seasons.map((entry) => (
                  <button
                    key={entry.number}
                    className="chip"
                    data-active={entry.number === season}
                    onClick={() => {
                      setSeason(entry.number);
                      setEpisode(1);
                    }}
                  >
                    Season {entry.number}
                  </button>
                ))}
              </div>

              <div className="episode-grid">
                {activeSeason.episodes.map((entry) => (
                  <button
                    key={entry.number}
                    className="episode"
                    data-active={entry.number === episode}
                    data-watched={Boolean(findProgress(watchHistory, id, season, entry.number))}
                    onClick={() => setEpisode(entry.number)}
                  >
                    {entry.number}
                  </button>
                ))}
              </div>
            </section>
          )}

          {media.cast.length > 0 && (
            <section className="section">
              <h2 className="section-title">Cast</h2>
              <div className="cast-row">
                {media.cast.map((member, index) => (
                  <div className="cast" key={`${member.name}-${index}`}>
                    <MediaImage
                      src={member.avatarUrl}
                      label={member.name}
                      alt={`Portrait of ${member.name}`}
                      className="cast-avatar"
                    />
                    <div className="cast-name">{member.name}</div>
                    <div className="cast-role">{member.character}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">
              Sources{isSeries ? ` · S${season}E${episode}` : ""} ·{" "}
              {media.audioLanguage === ORIGINAL_AUDIO ? "Original audio" : `${media.audioLanguage} audio`}
            </div>

            {releases.loading && <LoadingState label="Finding sources…" />}
            {releases.error && <ErrorState message={releases.error} onRetry={releases.reload} />}
            {!releases.loading && !releases.error && (releases.data ?? []).length === 0 && (
              <EmptyState title="No sources" body="This episode has no playable release yet." />
            )}

            {(releases.data ?? []).map((release) => (
              <button key={release.url} className="release" onClick={() => play(release)}>
                <span className="release-quality">{qualityLabel(release.resolution)}</span>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {release.format.toUpperCase()}
                  {release.language ? ` · ${release.language}` : ""}
                </span>
                <span className="release-meta">
                  {formatBytes(release.sizeBytes)}
                  <span
                    className="icon-button"
                    role="button"
                    tabIndex={0}
                    aria-label={`Download ${qualityLabel(release.resolution)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      download(release);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.stopPropagation();
                        download(release);
                      }
                    }}
                  >
                    <Download size={15} />
                  </span>
                </span>
              </button>
            ))}
          </div>

          {subtitles.length > 0 && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-title">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Captions size={14} /> Subtitles · {subtitles.length} available
                </span>
              </div>
              <div className="chip-row">
                <button
                  className="chip"
                  data-active={!activeSubtitle}
                  onClick={() => setSubtitleChoice(SUBTITLE_OFF)}
                >
                  {SUBTITLE_OFF}
                </button>
                {subtitles.map((option) => (
                  <button
                    key={option.url}
                    className="chip"
                    data-active={option.name === activeSubtitle?.name}
                    onClick={() => setSubtitleChoice(option.name)}
                    title={option.nativeName !== option.name ? option.nativeName : undefined}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
              <div className="setting-hint" style={{ marginTop: 10 }}>
                Switches on when playback starts. Change it any time from the player too.
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-title">Details</div>
            <dl className="meta-list">
              <div><dt>Type</dt><dd>{media.mediaType === "series" ? "Series" : "Movie"}</dd></div>
              {media.releaseDate && <div><dt>Released</dt><dd>{media.releaseDate}</dd></div>}
              {media.country && <div><dt>Country</dt><dd>{media.country}</dd></div>}
              {media.duration && <div><dt>Runtime</dt><dd>{media.duration}</dd></div>}
              {subtitles.length > 0 && (
                <div>
                  <dt>Subtitle</dt>
                  <dd>{activeSubtitle ? activeSubtitle.name : SUBTITLE_OFF}</dd>
                </div>
              )}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
