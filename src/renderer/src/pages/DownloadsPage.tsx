import { useCallback, useEffect, useState, useMemo } from "react";
import {
  ExternalLink,
  FolderOpen,
  ListX,
  Pause,
  Play,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  HardDrive,
  CheckCircle2,
  Film,
  Tv,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import type { DownloadQueueStatus, DownloadRecord } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { formatBytes, qualityLabel, relativeTime } from "../lib/format";
import { EmptyState } from "../components/States";
import { MediaImage } from "../components/MediaImage";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../store";

const isRunning = (record: DownloadRecord) =>
  record.state === "progressing" || record.state === "paused";

function stateLabel(record: DownloadRecord): string {
  const transferred =
    record.totalBytes > 0
      ? `${formatBytes(record.receivedBytes)} of ${formatBytes(record.totalBytes)}`
      : `${formatBytes(record.receivedBytes)} downloaded`;

  switch (record.state) {
    case "progressing":
      return transferred;
    case "paused":
      return `Paused · ${transferred}`;
    case "completed":
      return record.fileExists
        ? `${formatBytes(record.totalBytes)} · ${relativeTime(record.completedAt ?? record.startedAt)}`
        : "File is missing from disk";
    case "cancelled":
      return "Cancelled";
    default:
      if (record.failureReason) {
        const lower = record.failureReason.toLowerCase();
        if (lower.includes("node.js") || lower.includes("v24.") || lower.includes("v20.")) {
          return "Download interrupted — please retry.";
        }
        return record.failureReason;
      }
      return "Interrupted — please retry";
  }
}

interface GroupedDownloads {
  key: string;
  title: string;
  posterUrl: string | null;
  year: string;
  isSeries: boolean;
  records: DownloadRecord[];
  totalBytes: number;
  completedCount: number;
  failedCount: number;
}

export function DownloadsPage() {
  const downloads = useApp((state) => state.downloads);
  const loadDownloads = useApp((state) => state.loadDownloads);
  const removeDownload = useApp((state) => state.removeDownload);
  const cancelDownload = useApp((state) => state.cancelDownload);
  const beginDownload = useApp((state) => state.beginDownload);
  const openPlayer = useApp((state) => state.openPlayer);
  const notify = useApp((state) => state.notify);
  const navigate = useApp((state) => state.navigate);

  const [queue, setQueue] = useState<DownloadQueueStatus | null>(null);
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void loadDownloads();
  }, [loadDownloads]);

  const refreshQueue = useCallback(async () => {
    const status = await unwrap(api.downloads.queueStatus()).catch(() => null);
    if (status) setQueue(status);
  }, []);

  useEffect(() => {
    void refreshQueue();
    const timer = window.setInterval(() => void refreshQueue(), 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshQueue]);

  const running = useMemo(() => downloads.filter(isRunning), [downloads]);

  // Group finished downloads Netflix-style by show session / movie
  const grouped = useMemo(() => {
    const finished = downloads.filter((record) => !isRunning(record));
    const map = new Map<string, GroupedDownloads>();

    for (const record of finished) {
      const isSeries = record.season > 0 || record.mediaType === "series";
      const key = isSeries ? `series:${record.subjectId || record.title}` : `movie:${record.id}`;

      const existing = map.get(key);
      const isCompleted = record.state === "completed" && record.fileExists;
      const isFailed = record.state === "interrupted" || record.state === "cancelled" || !record.fileExists;

      if (existing) {
        existing.records.push(record);
        existing.totalBytes += record.totalBytes || record.receivedBytes || 0;
        if (isCompleted) existing.completedCount += 1;
        if (isFailed) existing.failedCount += 1;
      } else {
        map.set(key, {
          key,
          title: record.title,
          posterUrl: record.posterUrl,
          year: record.year ?? "",
          isSeries,
          records: [record],
          totalBytes: record.totalBytes || record.receivedBytes || 0,
          completedCount: isCompleted ? 1 : 0,
          failedCount: isFailed ? 1 : 0,
        });
      }
    }

    // Sort series episodes by season ASC, episode ASC
    for (const group of map.values()) {
      group.records.sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return a.episode - b.episode;
      });
    }

    return Array.from(map.values());
  }, [downloads]);

  const totalStorageBytes = useMemo(() => {
    return downloads
      .filter((r) => r.state === "completed" && r.fileExists)
      .reduce((acc, r) => acc + (r.totalBytes || r.receivedBytes || 0), 0);
  }, [downloads]);

  const toggleExpand = (key: string) => {
    setExpandedSeries((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const playHere = async (record: DownloadRecord) => {
    if (!record.fileExists) {
      notify({ kind: "error", title: "File is missing", body: record.savePath });
      return;
    }

    let year = record.year ?? "";
    if (!year && record.subjectId) {
      year = await unwrap(api.catalog.details(record.subjectId))
        .then((details) => details.year)
        .catch(() => "");
    }

    openPlayer({
      title: record.title,
      subtitleLine:
        record.season > 0
          ? `Season ${record.season} · Episode ${record.episode} · ${qualityLabel(record.resolution)} · Offline`
          : `${qualityLabel(record.resolution)} · Offline`,
      url: record.fileUrl,
      resolution: record.resolution,
      live: false,
      posterUrl: record.posterUrl,
      subjectId: record.subjectId,
      season: record.season,
      episode: record.episode,
      mediaType: record.mediaType,
      year,
      subtitles: (record.subtitles ?? []).map((track) => ({
        name: track.name,
        nativeName: track.nativeName,
        lang: track.lang,
        url: `local:${track.path}`,
      })),
      initialSubtitle: record.subtitles?.[0]?.name,
    });
  };

  const retryDownload = async (record: DownloadRecord) => {
    await removeDownload(record.id, false);
    try {
      let freshUrl = record.url;
      let freshKind = record.sourceKind;
      let freshResourceId = record.resourceId;
      let freshResolution = record.resolution;

      if (record.subjectId) {
        const freshReleases = await unwrap(
          api.catalog.releases(record.subjectId, record.season || 0, record.episode || 0),
        );
        if (freshReleases && freshReleases.length > 0) {
          const matched =
            (record.resolution > 0
              ? freshReleases.find((r) => r.resolution === record.resolution)
              : null) ?? freshReleases[0];
          freshUrl = matched.url;
          freshKind = matched.kind;
          freshResourceId = matched.resourceId;
          freshResolution = matched.resolution;
        }
      }

      beginDownload({
        title: record.title,
        subjectId: record.subjectId,
        resourceId: freshResourceId,
        season: record.season,
        episode: record.episode,
        resolution: freshResolution,
        url: freshUrl,
        posterUrl: record.posterUrl,
        mediaType: record.mediaType,
        year: record.year,
        sourceKind: freshKind,
      });
      notify({ kind: "info", title: `Restarting download for ${record.title}` });
    } catch (err) {
      notify({
        kind: "error",
        title: "Could not restart download",
        body: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const control = async (record: DownloadRecord, action: "pause" | "resume") => {
    const result = await unwrap(api.downloads[action](record.id)).catch(() => ({
      ok: false,
      reason: undefined,
    }));
    if (result.ok || !result.reason) return;
    notify({
      kind: "info",
      title: action === "pause" ? "Cannot pause this download" : "Cannot resume this download",
      body: result.reason,
    });
  };

  const openExternally = async (record: DownloadRecord) => {
    const error = await unwrap(api.downloads.open(record.id)).catch((cause: Error) => cause.message);
    if (error) notify({ kind: "error", title: "Could not open the file", body: error });
  };

  const deleteEntireGroup = async (group: GroupedDownloads) => {
    if (!confirm(`Delete all ${group.records.length} files for "${group.title}"?`)) {
      return;
    }
    for (const record of group.records) {
      await removeDownload(record.id, record.fileExists);
    }
    notify({ kind: "info", title: `Deleted ${group.title} downloads` });
  };

  const queuedItems = queue?.items ?? [];

  if (downloads.length === 0 && queuedItems.length === 0) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Offline library"
          title="Downloads"
          description="Save movies and series locally to watch in 100% offline mode without an internet connection."
        />
        <EmptyState
          title="No downloads yet"
          body="Open any movie or TV series and choose Download to save it for offline watching."
          action={
            <button className="btn btn-primary" onClick={() => navigate({ name: "home" })}>
              Browse titles
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page page-medium downloads-netflix-page">
      <PageHeader
        eyebrow="Offline library"
        title="Downloads"
        description="Your downloaded movies and series ready for instant offline playback."
        action={
          <div className="inline-actions">
            {queuedItems.length > 0 && (
              <>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    const changed = await unwrap(
                      queue?.paused ? api.downloads.resumeQueue() : api.downloads.pauseQueue(),
                    );
                    await refreshQueue();
                    if (changed) {
                      notify({
                        kind: "info",
                        title: queue?.paused ? "Queue resumed" : "Queue paused",
                        body: queue?.paused
                          ? "The next waiting episode will download when it is ready."
                          : "The current download is unchanged; future episodes will wait.",
                      });
                    }
                  }}
                >
                  {queue?.paused ? <Play size={14} /> : <Pause size={14} />}
                  {queue?.paused ? "Resume queue" : "Pause queue"}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    const dropped = await unwrap(api.downloads.clearQueue());
                    await refreshQueue();
                    notify({
                      kind: "info",
                      title: `Stopped ${dropped} queued episode${dropped === 1 ? "" : "s"}`,
                      body: "The episode already downloading continues; cancel it separately.",
                    });
                  }}
                >
                  <ListX size={14} /> Stop all ({queuedItems.length})
                </button>
              </>
            )}
            {grouped.length > 0 && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  useApp.setState({ downloads: await unwrap(api.downloads.clearFinished()) });
                }}
              >
                <Trash2 size={14} /> Clear finished
              </button>
            )}
          </div>
        }
      />

      {/* Netflix-style Storage Status Pill */}
      {totalStorageBytes > 0 && (
        <div className="netflix-downloads-banner">
          <div className="netflix-downloads-banner-info">
            <HardDrive size={18} className="netflix-banner-icon" />
            <div>
              <div className="netflix-banner-title">
                {formatBytes(totalStorageBytes)} Used · All media 100% available offline
              </div>
              <div className="netflix-banner-sub">
                Watch seamlessly without internet, mobile data, or buffering.
              </div>
            </div>
          </div>
          <div className="netflix-downloads-badge">
            <CheckCircle2 size={14} /> Ready Offline
          </div>
        </div>
      )}

      {/* Waiting season episodes can be managed before they begin downloading. */}
      {queuedItems.length > 0 && (
        <section className="section">
          <h2 className="section-title">
            {queue?.paused ? "Queue paused" : "Up next"} ({queuedItems.length})
          </h2>
          <div className="netflix-downloads-list">
            {queuedItems.map((item) => (
              <div className="download-row netflix-download-row" key={item.id}>
                <div className="download-art">
                  <MediaImage src={item.posterUrl} label={item.title} alt="" />
                </div>
                <div className="download-body">
                  <div className="download-title">
                    {item.title}
                    <span className="download-tag">
                      S{String(item.season).padStart(2, "0")}E{String(item.episode).padStart(2, "0")}
                    </span>
                    <span className="download-tag">{qualityLabel(item.resolution)}</span>
                  </div>
                  <div className="download-meta">
                    {queue?.paused ? "Waiting for the queue to resume" : "Waiting for the current download"}
                  </div>
                </div>
                <div className="download-actions">
                  <button
                    className="icon-button"
                    onClick={async () => {
                      const removed = await unwrap(api.downloads.removeQueued(item.id));
                      await refreshQueue();
                      if (removed) {
                        notify({
                          kind: "info",
                          title: `Removed S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")} from the queue`,
                        });
                      }
                    }}
                    aria-label={`Remove episode ${item.episode} from queue`}
                    title="Remove from queue"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active transfers section */}
      {running.length > 0 && (
        <section className="section">
          <h2 className="section-title">Downloading now ({running.length})</h2>
          <div className="netflix-downloads-list">
            {running.map((record) => {
              const percent =
                record.totalBytes > 0 ? Math.min(record.receivedBytes / record.totalBytes, 1) : 0;
              return (
                <div className="download-row netflix-download-row active-transfer-row" key={record.id}>
                  <div className="download-art">
                    <MediaImage src={record.posterUrl} label={record.title} alt="" />
                  </div>
                  <div className="download-body">
                    <div className="download-title">
                      {record.title}
                      {record.season > 0 && (
                        <span className="download-tag">
                          S{String(record.season).padStart(2, "0")}E{String(record.episode).padStart(2, "0")}
                        </span>
                      )}
                      <span className="download-tag">{qualityLabel(record.resolution)}</span>
                    </div>
                    <div className="download-meta">{stateLabel(record)}</div>
                    <div className="download-bar">
                      <span style={{ width: `${percent * 100}%` }} />
                    </div>
                  </div>
                  <div className="download-actions">
                    {record.state === "progressing" && (
                      <button
                        className="icon-button"
                        onClick={() => void control(record, "pause")}
                        aria-label="Pause"
                        title="Pause"
                      >
                        <Pause size={16} />
                      </button>
                    )}
                    {record.state === "paused" && (
                      <button
                        className="icon-button"
                        onClick={() => void control(record, "resume")}
                        aria-label="Resume"
                        title="Resume"
                      >
                        <Play size={16} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      onClick={() => void cancelDownload(record.id)}
                      aria-label="Cancel download"
                      title="Cancel download"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Completed media grouped by show or movie */}
      {grouped.length > 0 && (
        <section className="section">
          <h2 className="section-title">Downloaded Media ({grouped.length})</h2>
          <div className="netflix-grouped-grid">
            {grouped.map((group) => {
              const isExpanded = Boolean(expandedSeries[group.key]);

              if (group.isSeries) {
                // TV Series session card with accordion
                return (
                  <div className="netflix-series-card" key={group.key}>
                    <div className="netflix-series-header" onClick={() => toggleExpand(group.key)}>
                      <div className="netflix-series-art">
                        <MediaImage src={group.posterUrl} label={group.title} alt="" />
                      </div>
                      <div className="netflix-series-info">
                        <div className="netflix-series-badge">
                          <Tv size={13} /> Series Session
                        </div>
                        <h3 className="netflix-series-title">{group.title}</h3>
                        <div className="netflix-series-meta">
                          <span>{group.completedCount} {group.completedCount === 1 ? "Episode" : "Episodes"} Ready</span>
                          {group.failedCount > 0 && (
                            <span style={{ color: "#e74c3c" }}>• {group.failedCount} Interrupted</span>
                          )}
                          <span>•</span>
                          <span>{formatBytes(group.totalBytes)}</span>
                        </div>
                      </div>
                      <div className="netflix-series-actions" onClick={(e) => e.stopPropagation()}>
                        {group.completedCount > 0 && (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              const firstPlayable = group.records.find((r) => r.state === "completed" && r.fileExists);
                              if (firstPlayable) void playHere(firstPlayable);
                            }}
                          >
                            <Play size={14} fill="currentColor" /> Play
                          </button>
                        )}
                        <button
                          className="icon-button"
                          onClick={() => toggleExpand(group.key)}
                          aria-label={isExpanded ? "Collapse episodes" : "Expand episodes"}
                          title={isExpanded ? "Collapse" : "View episodes"}
                        >
                          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => void deleteEntireGroup(group)}
                          aria-label="Delete series downloads"
                          title="Delete all episodes"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Episodes Session List */}
                    {isExpanded && (
                      <div className="netflix-episodes-session">
                        <div className="netflix-episodes-header">
                          <span>All Episodes in Session ({group.records.length})</span>
                        </div>
                        <div className="netflix-episodes-list">
                          {group.records.map((record) => {
                            const playable = record.state === "completed" && record.fileExists;
                            const isFailed = record.state === "interrupted" || record.state === "cancelled" || (!record.fileExists && record.state === "completed");

                            return (
                              <div className="netflix-episode-row" key={record.id}>
                                <div className="netflix-ep-badge">
                                  S{String(record.season).padStart(2, "0")}E{String(record.episode).padStart(2, "0")}
                                </div>
                                <div className="netflix-ep-details">
                                  <div className="netflix-ep-title">
                                    Episode {record.episode}
                                    <span className="download-tag">{qualityLabel(record.resolution)}</span>
                                  </div>
                                  <div className="netflix-ep-sub">
                                    {isFailed ? (
                                      <span style={{ color: "#e74c3c", display: "inline-flex", alignItems: "center", gap: 4 }}>
                                        <AlertTriangle size={12} /> {stateLabel(record)}
                                      </span>
                                    ) : (
                                      stateLabel(record)
                                    )}
                                    {record.subtitles?.length > 0 && ` · ${record.subtitles.length} Subtitles`}
                                  </div>
                                </div>
                                <div className="netflix-ep-actions">
                                  {playable && (
                                    <>
                                      <button
                                        className="btn btn-sm btn-primary"
                                        onClick={() => void playHere(record)}
                                      >
                                        <Play size={13} fill="currentColor" /> Play
                                      </button>
                                      <button
                                        className="icon-button"
                                        onClick={() => void openExternally(record)}
                                        aria-label="Open in external player"
                                        title="External player"
                                      >
                                        <ExternalLink size={15} />
                                      </button>
                                      <button
                                        className="icon-button"
                                        onClick={() => void api.downloads.reveal(record.id)}
                                        aria-label="Show in folder"
                                        title="Show in folder"
                                      >
                                        <FolderOpen size={15} />
                                      </button>
                                    </>
                                  )}
                                  {isFailed && (
                                    <button
                                      className="btn btn-sm btn-secondary"
                                      onClick={() => void retryDownload(record)}
                                      title="Retry download"
                                    >
                                      <RotateCcw size={13} /> Retry
                                    </button>
                                  )}
                                  <button
                                    className="icon-button"
                                    onClick={() => void removeDownload(record.id, record.fileExists)}
                                    aria-label="Delete episode"
                                    title="Delete"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              // Movie card
              const record = group.records[0];
              const playable = record && record.state === "completed" && record.fileExists;
              const isFailed = record && (record.state === "interrupted" || record.state === "cancelled" || (!record.fileExists && record.state === "completed"));

              return (
                <div className="netflix-series-card netflix-movie-card" key={group.key}>
                  <div className="netflix-series-header">
                    <div className="netflix-series-art">
                      <MediaImage src={group.posterUrl} label={group.title} alt="" />
                    </div>
                    <div className="netflix-series-info">
                      <div className="netflix-series-badge">
                        <Film size={13} /> Movie
                      </div>
                      <h3 className="netflix-series-title">{group.title}</h3>
                      <div className="netflix-series-meta">
                        {record && <span className="download-tag">{qualityLabel(record.resolution)}</span>}
                        <span>{formatBytes(group.totalBytes)}</span>
                        {isFailed && (
                          <span style={{ color: "#e74c3c", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <AlertTriangle size={12} /> {stateLabel(record)}
                          </span>
                        )}
                        {record?.subtitles?.length > 0 && (
                          <span>{record.subtitles.length} Subtitles</span>
                        )}
                      </div>
                    </div>
                    <div className="netflix-series-actions">
                      {playable && (
                        <>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => void playHere(record)}
                          >
                            <Play size={14} fill="currentColor" /> Play
                          </button>
                          <button
                            className="icon-button"
                            onClick={() => void openExternally(record)}
                            aria-label="Open in external player"
                            title="External player"
                          >
                            <ExternalLink size={16} />
                          </button>
                          <button
                            className="icon-button"
                            onClick={() => void api.downloads.reveal(record.id)}
                            aria-label="Show in folder"
                            title="Show in folder"
                          >
                            <FolderOpen size={16} />
                          </button>
                        </>
                      )}
                      {isFailed && record && (
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => void retryDownload(record)}
                          title="Retry download"
                        >
                          <RotateCcw size={14} /> Retry
                        </button>
                      )}
                      <button
                        className="icon-button"
                        onClick={() => record && void removeDownload(record.id, record.fileExists)}
                        aria-label="Delete download"
                        title="Delete movie"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
