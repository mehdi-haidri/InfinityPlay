import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Clock3,
  Download,
  Film,
  Heart,
  Info,
  Play,
  Share2,
  Star,
  Trash2,
} from "lucide-react";
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
import { formatTime, qualityLabel } from "../lib/format";
import { downloadsSupported } from "../lib/device";
import { loadVttText, pickCastRelease, pickCastSubtitle } from "../lib/castMedia";
import { CastControl } from "../components/CastControl";
import { EmptyState, ErrorState, LoadingState, Spinner } from "../components/States";
import { MediaImage } from "../components/MediaImage";
import { findProgress, useApp } from "../store";
import { AudioTrackSelector } from "./details/AudioTrackSelector";
import { EpisodePicker } from "./details/EpisodePicker";
import { CastSection } from "./details/CastSection";
import { SimilarTitlesSection } from "./details/SimilarTitlesSection";
import { PlayQualityModal } from "./details/PlayQualityModal";
import { TrailerModal } from "./details/TrailerModal";
import { ResumeChoiceModal } from "./details/ResumeChoiceModal";

interface Props {
  id: string;
  initialSeason?: number;
  initialEpisode?: number;
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
  const toggleWatchLater = useApp((state) => state.toggleWatchLater);
  const watchLater = useApp((state) => state.watchLater);
  const patchConfig = useApp((state) => state.patchConfig);
  const preferredSubtitle = useApp((state) => state.config.preferredSubtitle);

  const [season, setSeason] = useState(initialSeason ?? 1);
  const [episode, setEpisode] = useState(initialEpisode ?? 1);
  const [subtitles, setSubtitles] = useState<SubtitleOption[]>([]);
  const subtitleChoice = preferredSubtitle;
  const [sourceSelection, setSourceSelection] = useState(() => `${initialSeason ?? 1}:${initialEpisode ?? 1}`);
  const [queueingSeason, setQueueingSeason] = useState(false);
  const [qualityModalOpen, setQualityModalOpen] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [trailerModalOpen, setTrailerModalOpen] = useState(false);
  const canDownload = downloadsSupported();
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
  }, [details.data?.id]);

  useEffect(() => {
    if (audioLocked) return;
    const media = details.data;
    const options = variants.data;
    if (!media || !options || options.length === 0) return;
    const order = [...preferredAudioOrder(preferredAudio), ORIGINAL_AUDIO];
    const target = order
      .map((language) => options.find((variant) => variant.language === language))
      .find(Boolean);
    if (!target || target.subjectId === media.id) return;

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

  const preferred = useMemo(() => {
    if (!sourcesReady) return null;
    const list = releases.data ?? [];
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => b.resolution - a.resolution);
    return defaultResolution > 0
      ? sorted.find((release) => release.resolution === defaultResolution) ?? sorted[0]
      : sorted[0];
  }, [releases.data, defaultResolution, sourcesReady]);

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
    unwrap(
      api.catalog.subtitles(
        id,
        captionSource.resourceId,
        details.data?.title,
        details.data?.year,
        isSeries ? season : undefined,
        isSeries ? episode : undefined,
      ),
    )
      .then((options) => {
        if (!cancelled) setSubtitles(options);
      })
      .catch(() => {
        if (!cancelled) setSubtitles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id, captionSource?.resourceId, details.data?.title, details.data?.year, isSeries, season, episode]);

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

  const castRelease = pickCastRelease(releases.data ?? [], defaultResolution);
  const castMedia = useMemo(() => {
    const data = details.data;
    if (!castRelease || !data) return null;
    return {
      title: data.title,
      subtitle: isSeries ? `Season ${season} · Episode ${episode}` : data.year,
      url: castRelease.url,
      posterUrl: data.posterUrl || undefined,
      startPosition: 0,
      vttText: castVtt || undefined,
    };
  }, [details.data, castRelease, isSeries, season, episode, castVtt]);

  if (details.loading) return <div className="page"><LoadingState label="Loading title…" /></div>;
  if (details.error)
    return <div className="page"><ErrorState message={details.error} onRetry={details.reload} /></div>;
  if (!details.data) return <div className="page"><EmptyState title="Title unavailable" /></div>;
  if (
    !isAllowedCatalogAudio(details.data.audioLanguage) &&
    variants.data &&
    variants.data.length > 0 &&
    !variants.data.some((variant) => variant.subjectId === details.data?.id)
  ) {
    return <div className="page"><EmptyState title="Title unavailable in your audio language" /></div>;
  }

  const media = details.data;
  const isFavorite = favorites.some((item) => item.id === id);
  const isQueued = watchLater.some((item) => item.id === id);
  const activeSeason = media.seasons.find((item) => item.number === season);
  const episodes = activeSeason?.episodes ?? [];
  const resume = findProgress(watchHistory, id, isSeries ? season : 0, isSeries ? episode : 0);

  const episodeSequence = isSeries && activeSeason
    ? activeSeason.episodes.map((ep) => ({
        season,
        number: ep.number,
      }))
    : undefined;

  const audioTracks = (variants.data ?? []).filter((variant) => isAllowedCatalogAudio(variant.language));

  const switchAudio = (variant: AudioVariant) => {
    navigate({
      name: "details",
      id: variant.subjectId,
      season: isSeries ? season : undefined,
      episode: isSeries ? episode : undefined,
      audioLocked: true,
    });
  };

  const play = (
    release: Release,
    customSubtitle?: SubtitleOption | null,
    customStartAt?: number,
  ) => {
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
      startAt: customStartAt !== undefined ? customStartAt : (resume?.position ?? 0),
      resolution: release.resolution,
      releases: releases.data ?? [],
      subtitles,
      episodeSequence: isSeries ? episodeSequence : undefined,
      initialSubtitle:
        customSubtitle !== undefined
          ? customSubtitle
            ? customSubtitle.name
            : SUBTITLE_OFF
          : subtitleChoice,
    });
  };

  const download = (release: Release) => {
    if (!release) {
      notify({
        kind: "error",
        title: "No downloadable file",
        body: "No source is available for this quality.",
      });
      return;
    }
    beginDownload({
      title: media.title,
      subjectId: media.id,
      resourceId: release.resourceId,
      season: isSeries ? season : 0,
      episode: isSeries ? episode : 0,
      resolution: release.resolution,
      url: release.url,
      posterUrl: media.posterUrl,
      mediaType: media.mediaType,
      year: media.year,
      sourceKind: release.kind,
    });
  };

  const downloadEpisode = async (targetSeason: number, targetEpisode: number) => {
    try {
      const epReleases = await unwrap(api.catalog.releases(id, targetSeason, targetEpisode));
      if (!epReleases || epReleases.length === 0) {
        notify({
          kind: "error",
          title: "No sources found",
          body: `Episode ${targetEpisode} has no downloadable source.`,
        });
        return;
      }
      const targetRelease =
        defaultResolution > 0
          ? epReleases.find((r) => r.resolution === defaultResolution) ?? epReleases[0]
          : epReleases[0];

      beginDownload({
        title: media.title,
        subjectId: media.id,
        resourceId: targetRelease.resourceId,
        season: targetSeason,
        episode: targetEpisode,
        resolution: targetRelease.resolution,
        url: targetRelease.url,
        posterUrl: media.posterUrl,
        mediaType: media.mediaType,
        year: media.year,
        sourceKind: targetRelease.kind,
      });
      notify({
        kind: "info",
        title: `Downloading S${String(targetSeason).padStart(2, "0")}E${String(targetEpisode).padStart(2, "0")}`,
        body: media.title,
      });
      void loadDownloads();
    } catch (err) {
      notify({
        kind: "error",
        title: "Could not start download",
        body: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const downloadSeason = async () => {
    if (!activeSeason || activeSeason.episodes.length === 0) return;
    setQueueingSeason(true);
    try {
      const queued = await unwrap(
        api.downloads.startSeason({
          title: media.title,
          subjectId: media.id,
          posterUrl: media.posterUrl,
          season,
          episodes: activeSeason.episodes.map((entry) => entry.number),
          resolution: 0,
          year: media.year,
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
      <section className="cinematic-hero">
        {media.backdropUrl ? (
          <div
            className="cinematic-hero-bg"
            style={{ backgroundImage: `url("${media.backdropUrl}")` }}
          />
        ) : media.posterUrl ? (
          <div
            className="cinematic-hero-bg cinematic-hero-bg-poster"
            style={{ backgroundImage: `url("${media.posterUrl}")` }}
          />
        ) : null}

        <div className="cinematic-hero-scrim" />

        <div className="cinematic-hero-inner">
          <div className="cinematic-poster-card">
            <MediaImage src={media.posterUrl} label={media.title} alt={media.title} />
          </div>

          <div className="cinematic-hero-content">
            <div className="cinematic-eyebrow">
              <span className="cinematic-type-tag">
                {isSeries ? "TV Series" : "Feature Film"}
              </span>
              {media.year && <span className="cinematic-year-tag">{media.year}</span>}
            </div>

            <h1 className="cinematic-title">{media.title}</h1>

            <div className="cinematic-meta-bar">
              {media.imdbRating && (
                <div className="cinematic-rating-badge">
                  <Star size={14} fill="#ffd166" color="#ffd166" />
                  <span className="cinematic-rating-score">{media.imdbRating}</span>
                  <span className="cinematic-rating-max">/ 10</span>
                </div>
              )}

              {media.duration && (
                <span className="cinematic-meta-item">{media.duration}</span>
              )}

              {isSeries && media.seasons.length > 0 && (
                <span className="cinematic-meta-item">
                  {media.seasons.length} {media.seasons.length === 1 ? "Season" : "Seasons"}
                </span>
              )}

              {media.country && (
                <span className="cinematic-meta-item">{media.country}</span>
              )}

              <span className="cinematic-badge-accent">Ultra HD</span>
            </div>

            {media.genres.length > 0 && (
              <div className="cinematic-genres-row">
                {media.genres.map((genre) => (
                  <span className="cinematic-genre-pill" key={genre}>
                    {genre}
                  </span>
                ))}
              </div>
            )}

            <AudioTrackSelector
              audioTracks={audioTracks}
              currentId={media.id}
              onSelect={switchAudio}
            />

            {resume && resume.position > 15 && (
              <div className="cinematic-resume-bar">
                <div className="cinematic-resume-info">
                  <span>
                    Resume from {formatTime(resume.position)}
                    {resume.duration > 0 ? ` of ${formatTime(resume.duration)}` : ""}
                  </span>
                  {resume.duration > 0 && (
                    <span>{Math.round((resume.position / resume.duration) * 100)}%</span>
                  )}
                </div>
                <div className="cinematic-resume-track">
                  <span
                    style={{
                      width: `${resume.duration > 0 ? Math.min((resume.position / resume.duration) * 100, 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="cinematic-actions-row">
              <button
                className="btn btn-primary cinematic-btn-play"
                disabled={releases.loading || (releases.data?.length ?? 0) === 0}
                onClick={() => {
                  if (resume && resume.position > 30) {
                    setResumeModalOpen(true);
                  } else {
                    setQualityModalOpen(true);
                  }
                }}
                aria-label={resume && resume.position > 30 ? "Resume playback" : "Play now"}
              >
                {releases.loading ? <Spinner /> : <Play size={18} fill="currentColor" />}
                <span>
                  {resume && resume.position > 30 ? "Resume" : "Play Now"}
                </span>
              </button>

              <button
                className="btn btn-secondary cinematic-btn-action"
                onClick={() => setTrailerModalOpen(true)}
                aria-label="Watch Trailer"
                title="Watch Trailer"
              >
                <Film size={17} />
                <span>Trailer</span>
              </button>

              {canDownload && (
                <button
                  className="btn btn-secondary cinematic-btn-action"
                  disabled={!preferred}
                  onClick={() => preferred && download(preferred)}
                  aria-label="Download"
                  title="Download"
                >
                  <Download size={17} />
                  <span>Download</span>
                </button>
              )}

              <div className="cinematic-icon-group">
                <button
                  className="icon-button cinematic-action-icon"
                  data-active={isFavorite || undefined}
                  onClick={() => void toggleFavorite(media)}
                  aria-pressed={isFavorite}
                  aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                  title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
                </button>

                <button
                  className="icon-button cinematic-action-icon"
                  data-active={isQueued || undefined}
                  onClick={() => void toggleWatchLater(media)}
                  aria-pressed={isQueued}
                  aria-label={isQueued ? "Remove from Watch later" : "Save to Watch later"}
                  title={isQueued ? "Remove from Watch later" : "Watch later"}
                >
                  <Clock3 size={18} />
                </button>

                <button
                  className="icon-button cinematic-action-icon"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `${media.title} (${media.year || ""}) - InfinityPlay`
                    );
                    notify({
                      kind: "info",
                      title: "Copied to clipboard",
                      body: `"${media.title}" title info copied.`,
                    });
                  }}
                  aria-label="Share title"
                  title="Share title"
                >
                  <Share2 size={17} />
                </button>

                <CastControl
                  media={castMedia}
                  subtitles={subtitles}
                  triggerClassName="icon-button cinematic-action-icon"
                />

                {watchHistory.some((entry) => entry.subjectId === id) && (
                  <button
                    className="icon-button cinematic-action-icon"
                    onClick={() => void forgetTitle(id)}
                    aria-label="Remove progress"
                    title="Remove progress"
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="details-body cinematic-details-body">
        <div className="cinematic-main-content">
          {media.description && (
            <section className="section cinematic-overview-section">
              <h2 className="section-title cinematic-section-title">
                <BookOpen size={17} /> Storyline
              </h2>
              <p className="cinematic-description">{media.description}</p>
            </section>
          )}

          {isSeries && (
            <EpisodePicker
              media={media}
              season={season}
              episode={episode}
              watchHistory={watchHistory}
              canDownload={canDownload}
              queueingSeason={queueingSeason}
              onSeasonChange={(s) => {
                setSourceSelection("");
                setSeason(s);
                setEpisode(1);
              }}
              onEpisodeChange={(e) => {
                setSourceSelection("");
                setEpisode(e);
              }}
              onDownloadSeason={() => void downloadSeason()}
              onPlayEpisode={(_s, _ep) => {
                const target = preferred ?? releases.data?.[0];
                if (target) play(target);
              }}
              onDownloadEpisode={(s, ep) => void downloadEpisode(s, ep)}
            />
          )}

          <CastSection
            media={media}
            onNavigatePerson={(personId, personName, avatarUrl) =>
              navigate({ name: "person", id: personId, personName, avatarUrl })
            }
          />

          <SimilarTitlesSection
            currentId={media.id}
            genre={media.genres[0]}
            mediaType={media.mediaType}
            title={media.title}
          />
        </div>

        <aside className="cinematic-sidebar">
          <div className="panel cinematic-specs-panel">
            <div className="panel-title cinematic-panel-title">
              <Info size={15} /> Specifications
            </div>
            <dl className="meta-list cinematic-meta-list">
              <div>
                <dt>Format</dt>
                <dd>{media.mediaType === "series" ? "TV Series" : "Feature Film"}</dd>
              </div>
              {media.releaseDate && (
                <div>
                  <dt>Released</dt>
                  <dd>{media.releaseDate}</dd>
                </div>
              )}
              {media.country && (
                <div>
                  <dt>Country</dt>
                  <dd>{media.country}</dd>
                </div>
              )}
              {media.duration && (
                <div>
                  <dt>Runtime</dt>
                  <dd>{media.duration}</dd>
                </div>
              )}
              {audioTracks.length > 0 && (
                <div>
                  <dt>Audio Tracks</dt>
                  <dd>
                    {audioTracks.map((t) => t.language).filter(Boolean).join(", ") || "Original"}
                  </dd>
                </div>
              )}
              {subtitles.length > 0 && (
                <div>
                  <dt>Captions</dt>
                  <dd>{subtitles.length} Tracks Available</dd>
                </div>
              )}
              <div>
                <dt>Offline Playback</dt>
                <dd>100% Supported</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <PlayQualityModal
        isOpen={qualityModalOpen}
        title={media.title}
        subtitleLine={isSeries ? `Season ${season} · Episode ${episode}` : media.year}
        releases={releases.data ?? []}
        subtitles={subtitles}
        audioTracks={audioTracks}
        currentAudioId={media.id}
        selectedSubtitle={subtitleChoice}
        currentProgress={resume ? { position: resume.position, duration: resume.duration } : undefined}
        defaultRelease={preferred}
        onClose={() => setQualityModalOpen(false)}
        onPlay={(rel, sub) => play(rel, sub)}
        onSwitchAudio={(targetId) => {
          const variant = audioTracks.find((v) => v.subjectId === targetId);
          if (variant) switchAudio(variant);
        }}
        onSelectSubtitle={(subName) => void patchConfig({ preferredSubtitle: subName })}
      />

      {resume && (
        <ResumeChoiceModal
          isOpen={resumeModalOpen}
          title={media.title}
          subtitleLine={isSeries ? `Season ${season} · Episode ${episode}` : media.year}
          position={resume.position}
          duration={resume.duration}
          onClose={() => setResumeModalOpen(false)}
          onResume={() => {
            setResumeModalOpen(false);
            const targetRelease = preferred ?? releases.data?.[0];
            if (targetRelease) {
              play(targetRelease, undefined, resume.position);
            }
          }}
          onRestart={() => {
            setResumeModalOpen(false);
            const targetRelease = preferred ?? releases.data?.[0];
            if (targetRelease) {
              play(targetRelease, undefined, 0);
            }
          }}
          onOpenQualityModal={() => {
            setResumeModalOpen(false);
            setQualityModalOpen(true);
          }}
        />
      )}

      <TrailerModal
        isOpen={trailerModalOpen}
        title={media.title}
        year={media.year}
        type={media.mediaType}
        onClose={() => setTrailerModalOpen(false)}
      />
    </div>
  );
}
