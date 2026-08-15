import { useEffect, useMemo, useState } from "react";
import { AudioLines, Captions, Download, Heart, Play, Star, Trash2 } from "lucide-react";
import {
  isAllowedCatalogAudio,
  ORIGINAL_AUDIO,
  preferredAudioOrder,
  SUBTITLE_OFF,
  type AudioVariant,
  type MediaDetails,
  type Release,
  type SubtitleOption,
} from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync } from "../hooks/useAsync";
import { formatBytes, qualityLabel } from "../lib/format";
import { downloadsSupported } from "../lib/device";
import { loadVttText, pickCastRelease, pickCastSubtitle } from "../lib/castMedia";
import { CastControl } from "../components/CastControl";
import { EmptyState, ErrorState, LoadingState, Spinner } from "../components/States";
import { MediaImage } from "../components/MediaImage";
import { findProgress, useApp } from "../store";
import { WatchAvailabilityPanel } from "../components/WatchAvailabilityPanel";

/** Episodes drawn at once. Big enough that ordinary seasons stay on one block. */
const EPISODE_BLOCK = 50;

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
  const loadDownloads = useApp((state) => state.loadDownloads);
  const beginDownload = useApp((state) => state.beginDownload);
  const preferredAudio = useApp((state) => state.config.preferredAudio);
  const navigate = useApp((state) => state.navigate);
  const openPlayer = useApp((state) => state.openPlayer);
  const watchHistory = useApp((state) => state.watchHistory);
  const forgetTitle = useApp((state) => state.forgetTitle);
  const defaultResolution = useApp((state) => state.config.defaultResolution);
  const ffmpeg = useApp((state) => state.ffmpeg);
  const favorites = useApp((state) => state.favorites);
  const toggleFavorite = useApp((state) => state.toggleFavorite);

  const preferredSubtitle = useApp((state) => state.config.preferredSubtitle);

  const [season, setSeason] = useState(initialSeason ?? 1);
  const [episode, setEpisode] = useState(initialEpisode ?? 1);
  const [subtitles, setSubtitles] = useState<SubtitleOption[]>([]);
  const [subtitleChoice, setSubtitleChoice] = useState(preferredSubtitle);
  const [sourceSelection, setSourceSelection] = useState(() => `${initialSeason ?? 1}:${initialEpisode ?? 1}`);
  const [queueingSeason, setQueueingSeason] = useState(false);
  /** Null follows the selected episode; a number is a block the user chose. */
  const [episodeBlock, setEpisodeBlock] = useState<number | null>(null);
  // Android TV has nowhere useful to put a saved file, so it does not offer to make one.
  const canDownload = downloadsSupported();
  /** WebVTT for the caption track a cast would carry, loaded alongside the subtitle list. */
  const [castVtt, setCastVtt] = useState("");

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
    // One option is enough to be worth switching to: hidden regional dubs are filtered
    // out upstream, so a title whose only listed track is the original still arrives
    // here as a single-entry list while the viewed subject is the dub.
    if (!media || !options || options.length === 0) return;
    const order = [...preferredAudioOrder(preferredAudio), ORIGINAL_AUDIO];
    const target = order
      .map((language) => options.find((variant) => variant.language === language))
      .find(Boolean);
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

  const requestedSelection = `${isSeries ? season : 0}:${isSeries ? episode : 0}`;
  const sourcesReady = !releases.loading && sourceSelection === requestedSelection;

  useEffect(() => {
    if (!releases.loading && releases.data) setSourceSelection(requestedSelection);
  }, [releases.loading, releases.data, requestedSelection]);

  // Preferred quality first, falling back to the best available.
  const preferred = useMemo(() => {
    if (!sourcesReady) return null;
    const list = releases.data ?? [];
    if (list.length === 0) return null;
    // Automatic means best available. Android now uses Media3 rather than WebView, so
    // it can select the 1080p adaptive source instead of being artificially capped at
    // the first progressive (typically 480p) file.
    const sorted = [...list].sort((a, b) => b.resolution - a.resolution);
    return defaultResolution > 0
      ? sorted.find((release) => release.resolution === defaultResolution) ?? sorted[0]
      : sorted[0];
  }, [releases.data, defaultResolution, sourcesReady]);

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

  // Casting straight from here should carry captions too, so the preferred track is fetched with
  // the list rather than only when the player opens.
  const castSubtitle = pickCastSubtitle(subtitles, preferredSubtitle);
  useEffect(() => {
    if (!castSubtitle) {
      setCastVtt("");
      return;
    }
    let cancelled = false;
    loadVttText(castSubtitle.url)
      .then((text) => {
        if (!cancelled) setCastVtt(text);
      })
      .catch(() => {
        if (!cancelled) setCastVtt("");
      });
    return () => {
      cancelled = true;
    };
  }, [castSubtitle?.url]);

  if (details.loading) return <div className="page"><LoadingState label="Loading title…" /></div>;
  if (details.error)
    return <div className="page"><ErrorState message={details.error} onRetry={details.reload} /></div>;
  if (!details.data) return <div className="page"><EmptyState title="Title unavailable" /></div>;
  if (
    !isAllowedCatalogAudio(details.data.audioLanguage) &&
    !variants.loading &&
    (variants.data?.length ?? 0) === 0
  ) {
    return (
      <div className="page">
        <EmptyState
          title="Supported audio unavailable"
          body="This catalog entry has no English, Arabic, French, or undubbed release."
        />
      </div>
    );
  }

  const media = details.data;
  const isFavorite = favorites.some((entry) => entry.id === media.id);
  const activeSeason = media.seasons.find((entry) => entry.number === season) ?? media.seasons[0];
  const resume = findProgress(watchHistory, id, isSeries ? season : 0, isSeries ? episode : 0);

  /*
   * Long-running shows are drawn a block at a time.
   *
   * A One Piece season is over a thousand episodes, and rendering every button at once cost a
   * visible pause on opening the page for a list nobody reads end to end. Blocks are ranges rather
   * than numbered pages so the label says where you are ("101–150"), and the visible block follows
   * whichever episode is selected, so resuming lands on the right one without hunting.
   */
  /*
   * What a television would need to take this over, built from the same progressive-release rule
   * the player uses. Resumes where the user stopped, so casting from here lands in the same place
   * as pressing Play would.
   */
  const castRelease = pickCastRelease(releases.data ?? [], preferred?.resolution);
  const castMedia = castRelease
    ? {
        url: castRelease.url,
        title: media.title,
        subtitleLine: isSeries ? `Season ${season} · Episode ${episode}` : media.year,
        posterUrl: media.posterUrl ?? undefined,
        subtitleVtt: castVtt || undefined,
        subtitleName: castSubtitle?.name,
        subtitleLanguage: castSubtitle?.lang,
        startSeconds: resume?.position ?? 0,
        durationSeconds: resume?.duration ?? 0,
        live: false,
      }
    : null;

  const episodes = activeSeason?.episodes ?? [];
  const blockStart = Math.floor(episodes.findIndex((entry) => entry.number === episode) / EPISODE_BLOCK);
  const blockCount = Math.ceil(episodes.length / EPISODE_BLOCK);
  const activeBlock = Math.min(Math.max(episodeBlock ?? Math.max(blockStart, 0), 0), Math.max(blockCount - 1, 0));
  const visibleEpisodes = episodes.slice(activeBlock * EPISODE_BLOCK, (activeBlock + 1) * EPISODE_BLOCK);

  // The subject being viewed is offered only when it is part of the supported policy;
  // direct links to Hindi or another removed dub can never leak back into the switcher.
  const audioTracks: AudioVariant[] = (() => {
    const found = variants.data ?? [];
    if (found.some((variant) => variant.subjectId === media.id)) return found;
    if (!isAllowedCatalogAudio(media.audioLanguage)) return found;
    return [
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
      resolution: release.resolution,
      releases: releases.data ?? [],
      subtitles,
      episodeCount: activeSeason?.episodes.length ?? 0,
      initialSubtitle: subtitleChoice,
    });
  };

  // The store owns the toast and the progress stream; this only supplies the metadata
  // the Downloads page needs to show a poster and play the file back.
  const download = (release: Release) => {
    if (!release) {
      notify({
        kind: "error",
        title: "No downloadable file",
        body: "No source is available for this quality.",
      });
      return;
    }
    void beginDownload({
      url: release.url,
      // Captions hang off a progressive release; the adaptive manifest has no caption id.
      resourceId: captionSource?.resourceId ?? release.resourceId,
      title: media.title,
      year: media.year,
      posterUrl: media.posterUrl,
      subjectId: media.id,
      mediaType: media.mediaType,
      season: isSeries ? season : 0,
      episode: isSeries ? episode : 0,
      resolution: release.resolution,
      sourceKind: release.kind ?? "mp4",
    });
  };

  /**
   * Queues the visible season. The main process resolves each episode's source when its
   * turn comes, so nothing here has to fetch a release per episode up front.
   */
  const downloadSeason = async () => {
    if (!activeSeason || queueingSeason) return;
    setQueueingSeason(true);
    try {
      const queued = await unwrap(
        api.downloads.startSeason({
          subjectId: media.id,
          title: media.title,
          year: media.year,
          posterUrl: media.posterUrl,
          season,
          episodes: activeSeason.episodes.map((entry) => entry.number),
          // 0 means each episode takes the best quality it actually has, rather than
          // failing the ones that lack whatever height this episode happens to offer.
          resolution: 0,
        }),
      );
      notify({
        kind: "info",
        title: `Queued ${queued} episode${queued === 1 ? "" : "s"}`,
        body: `Season ${season} downloads one after another. Progress is on the Downloads page.`,
      });
      void loadDownloads();
    } catch (error) {
      notify({
        kind: "error",
        title: "Could not queue the season",
        body: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setQueueingSeason(false);
    }
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

          {/* Phones collapse everything but Play to its icon; the labels live on as the accessible
              name and the tooltip, so nothing is lost with the text. */}
          <div className="detail-actions">
            <button
              className="btn btn-primary"
              disabled={!preferred}
              onClick={() => preferred && play(preferred)}
            >
              {releases.loading ? <Spinner /> : <Play size={17} fill="currentColor" />}
              <span className="btn-label">
                {resume && resume.position > 30 ? "Resume" : "Play"}
                {preferred ? ` · ${qualityLabel(preferred.resolution)}` : ""}
              </span>
            </button>
            {canDownload && (
              <button
                className="btn"
                disabled={!preferred}
                onClick={() => preferred && download(preferred)}
                aria-label="Download"
                title="Download"
              >
                <Download size={17} />
                <span className="btn-label">Download</span>
              </button>
            )}
            {/* Sending a title to a television should not require opening the player first. The
                trigger borrows the shape of the favourite and remove buttons it sits beside. */}
            <CastControl
              media={castMedia}
              subtitles={subtitles}
              triggerClassName="btn btn-ghost btn-compact"
            />

            <button
              className="btn btn-ghost btn-compact"
              data-active={isFavorite || undefined}
              onClick={() => void toggleFavorite(media)}
              aria-pressed={isFavorite}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Heart size={17} fill={isFavorite ? "currentColor" : "none"} />
              <span className="btn-label">{isFavorite ? "Favorited" : "Favorite"}</span>
            </button>
            {watchHistory.some((entry) => entry.subjectId === id) && (
              <button
                className="btn btn-ghost btn-compact"
                onClick={() => void forgetTitle(id)}
                aria-label="Remove progress"
                title="Remove progress"
              >
                <Trash2 size={16} />
                <span className="btn-label">Remove progress</span>
              </button>
            )}
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <h2 className="section-title">Episodes</h2>
                {canDownload && (
                  <button
                    className="btn btn-sm"
                    onClick={() => void downloadSeason()}
                    disabled={queueingSeason || (activeSeason?.episodes.length ?? 0) === 0}
                    title={`Download every episode of season ${season}, one after another`}
                  >
                    {queueingSeason ? <Spinner /> : <Download size={15} />}
                    Download season {season}
                  </button>
                )}
              </div>

              <div className="chip-row" style={{ marginBottom: 16 }}>
                {media.seasons.map((entry) => (
                  <button
                    key={entry.number}
                    className="chip"
                    data-active={entry.number === season}
                    onClick={() => {
                      setSourceSelection("");
                      setSeason(entry.number);
                      setEpisode(1);
                      setEpisodeBlock(null);
                    }}
                  >
                    Season {entry.number}
                  </button>
                ))}
              </div>

              {blockCount > 1 && (
                <div className="chip-row episode-blocks">
                  {Array.from({ length: blockCount }, (_, index) => {
                    const from = episodes[index * EPISODE_BLOCK]?.number;
                    const to = episodes[Math.min((index + 1) * EPISODE_BLOCK, episodes.length) - 1]?.number;
                    return (
                      <button
                        key={index}
                        className="chip chip-sm"
                        data-active={index === activeBlock}
                        onClick={() => setEpisodeBlock(index)}
                      >
                        {from === to ? from : `${from}–${to}`}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="episode-grid">
                {visibleEpisodes.map((entry) => (
                  <button
                    key={entry.number}
                    className="episode"
                    data-active={entry.number === episode}
                    data-watched={Boolean(findProgress(watchHistory, id, season, entry.number))}
                    onClick={() => {
                      setSourceSelection("");
                      setEpisode(entry.number);
                    }}
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
                  <button
                    className="cast"
                    key={`${member.name}-${index}`}
                    onClick={() =>
                      navigate({
                        name: "person",
                        id: member.id,
                        personName: member.name,
                        avatarUrl: member.avatarUrl,
                      })
                    }
                    aria-label={`View ${member.name}'s movies and series`}
                  >
                    <MediaImage
                      src={member.avatarUrl}
                      label={member.name}
                      alt={`Portrait of ${member.name}`}
                      className="cast-avatar"
                    />
                    <div className="cast-name">{member.name}</div>
                    <div className="cast-role">{member.character}</div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside>
          <WatchAvailabilityPanel title={media.title} mediaType={media.mediaType} />
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">
              Sources{isSeries ? ` · S${season}E${episode}` : ""} ·{" "}
              {media.audioLanguage === ORIGINAL_AUDIO ? "Original audio" : `${media.audioLanguage} audio`}
            </div>

            {releases.loading && <LoadingState label="Finding sources…" />}
            {releases.error && <ErrorState message={releases.error} onRetry={releases.reload} />}
            {sourcesReady && !releases.error && (releases.data ?? []).length === 0 && (
              <EmptyState title="No sources" body="This episode has no playable release yet." />
            )}

            {sourcesReady && (releases.data ?? []).map((release) => (
              <button key={`${release.url}-${release.resolution}`} className="release" onClick={() => play(release)}>
                <span className="release-quality">{qualityLabel(release.resolution)}</span>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {release.format.toUpperCase()}
                  {release.language ? ` · ${release.language}` : ""}
                </span>
                <span className="release-meta">
                  {release.kind === "dash" ? "Adaptive" : formatBytes(release.sizeBytes)}
                  {canDownload && (
                    <span
                      className="icon-button"
                      role="button"
                      tabIndex={0}
                      aria-label={`Download ${qualityLabel(release.resolution)}`}
                      data-disabled={release.kind === "dash" && !ffmpeg}
                      title={
                        release.kind === "dash" && !ffmpeg
                          ? "This quality is adaptive and needs FFmpeg to be saved as a file"
                          : `Download ${qualityLabel(release.resolution)}`
                      }
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
                  )}
                </span>
              </button>
            ))}

            {canDownload && !ffmpeg && sourcesReady && (releases.data ?? []).some((r) => r.kind === "dash") && (
              <div className="setting-hint" style={{ marginTop: 10 }}>
                Adaptive qualities stream fine but need FFmpeg to download. Install FFmpeg to
                save them, or pick a quality that lists a file size.
              </div>
            )}
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
