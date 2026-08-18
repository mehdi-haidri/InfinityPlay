import { useState } from "react";
import { Download, LayoutGrid, List, Play, CheckCircle2 } from "lucide-react";
import type { MediaDetails, WatchHistoryItem } from "@shared/types";
import { Spinner } from "../../components/States";
import { findProgress } from "../../store";
import { formatTime } from "../../lib/format";

const EPISODE_BLOCK = 50;

interface Props {
  media: MediaDetails;
  season: number;
  episode: number;
  watchHistory: WatchHistoryItem[];
  canDownload: boolean;
  queueingSeason: boolean;
  onSeasonChange: (seasonNumber: number) => void;
  onEpisodeChange: (episodeNumber: number) => void;
  onDownloadSeason: () => void;
  onPlayEpisode?: (seasonNumber: number, episodeNumber: number) => void;
  onDownloadEpisode?: (seasonNumber: number, episodeNumber: number) => void;
}

export function EpisodePicker({
  media,
  season,
  episode,
  watchHistory,
  canDownload,
  queueingSeason,
  onSeasonChange,
  onEpisodeChange,
  onDownloadSeason,
  onPlayEpisode,
  onDownloadEpisode,
}: Props) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [episodeBlock, setEpisodeBlock] = useState<number | null>(null);
  const activeSeason = media.seasons.find((entry) => entry.number === season) ?? media.seasons[0];
  const episodes = activeSeason?.episodes ?? [];

  const blockStart = Math.floor(episodes.findIndex((entry) => entry.number === episode) / EPISODE_BLOCK);
  const blockCount = Math.ceil(episodes.length / EPISODE_BLOCK);
  const activeBlock = Math.min(Math.max(episodeBlock ?? Math.max(blockStart, 0), 0), Math.max(blockCount - 1, 0));
  const visibleEpisodes = episodes.slice(activeBlock * EPISODE_BLOCK, (activeBlock + 1) * EPISODE_BLOCK);

  if (!activeSeason) return null;

  return (
    <section className="section cinematic-episodes-section">
      <div className="episodes-header-row">
        <div className="episodes-title-group">
          <h2 className="section-title cinematic-section-title">Episodes</h2>
          <span className="episodes-count-badge">{episodes.length} Episodes</span>
        </div>

        <div className="episodes-actions-group">
          {/* View mode toggle */}
          <div className="episodes-view-toggle">
            <button
              className="icon-button"
              data-active={viewMode === "grid" || undefined}
              onClick={() => setViewMode("grid")}
              title="Grid view"
              aria-label="Grid view"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              className="icon-button"
              data-active={viewMode === "list" || undefined}
              onClick={() => setViewMode("list")}
              title="List view with details"
              aria-label="List view"
            >
              <List size={15} />
            </button>
          </div>

          {canDownload && (
            <button
              className="btn btn-sm"
              onClick={onDownloadSeason}
              disabled={queueingSeason || episodes.length === 0}
              title={`Download every episode of season ${season}, one after another`}
            >
              {queueingSeason ? <Spinner /> : <Download size={14} />}
              <span>Download season {season}</span>
            </button>
          )}
        </div>
      </div>

      {/* Season switcher tabs */}
      <div className="chip-row season-chips-row">
        {media.seasons.map((entry) => (
          <button
            key={entry.number}
            className="chip season-chip"
            data-active={entry.number === season}
            onClick={() => {
              onSeasonChange(entry.number);
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

      {/* Grid view */}
      {viewMode === "grid" ? (
        <div className="episode-grid">
          {visibleEpisodes.map((entry) => {
            const progress = findProgress(watchHistory, media.id, season, entry.number);
            const isWatched = Boolean(progress && progress.position > 30);

            return (
              <button
                key={entry.number}
                className="episode"
                data-active={entry.number === episode}
                data-watched={isWatched}
                onClick={() => onEpisodeChange(entry.number)}
                title={`Season ${season} Episode ${entry.number}${entry.title ? `: ${entry.title}` : ""}`}
              >
                <span>{entry.number}</span>
                {isWatched && <span className="ep-watched-dot" />}
              </button>
            );
          })}
        </div>
      ) : (
        /* Detailed List view */
        <div className="episodes-detailed-list">
          {visibleEpisodes.map((entry) => {
            const progress = findProgress(watchHistory, media.id, season, entry.number);
            const isSelected = entry.number === episode;
            const isWatched = Boolean(progress && progress.position > 30);
            const percent = progress && progress.duration > 0
              ? Math.min((progress.position / progress.duration) * 100, 100)
              : 0;

            return (
              <div
                className="episode-detailed-card"
                key={entry.number}
                data-active={isSelected || undefined}
                onClick={() => onEpisodeChange(entry.number)}
              >
                <div className="episode-detailed-badge">
                  <span>{String(entry.number).padStart(2, "0")}</span>
                </div>

                <div className="episode-detailed-body">
                  <div className="episode-detailed-title-row">
                    <span className="episode-detailed-title">
                      {entry.title || `Episode ${entry.number}`}
                    </span>
                    {isWatched && (
                      <span className="ep-watched-tag">
                        <CheckCircle2 size={12} /> Watched
                      </span>
                    )}
                  </div>

                  <div className="episode-detailed-meta">
                    <span>Season {season} · Episode {entry.number}</span>
                    {progress && progress.position > 0 && (
                      <span>· Watched to {formatTime(progress.position)}</span>
                    )}
                  </div>

                  {percent > 0 && (
                    <div className="episode-detailed-progress-bar">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  )}
                </div>

                <div className="episode-detailed-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      onEpisodeChange(entry.number);
                      if (onPlayEpisode) onPlayEpisode(season, entry.number);
                    }}
                    title={`Play Episode ${entry.number}`}
                  >
                    <Play size={13} fill="currentColor" /> Play
                  </button>
                  {canDownload && onDownloadEpisode && (
                    <button
                      className="icon-button"
                      onClick={() => onDownloadEpisode(season, entry.number)}
                      title={`Download Episode ${entry.number}`}
                      aria-label={`Download Episode ${entry.number}`}
                    >
                      <Download size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
