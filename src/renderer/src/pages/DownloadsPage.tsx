import { useEffect } from "react";
import {
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Trash2,
  X,
} from "lucide-react";
import type { DownloadRecord } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { formatBytes, qualityLabel, relativeTime } from "../lib/format";
import { EmptyState } from "../components/States";
import { useApp } from "../store";

const isRunning = (record: DownloadRecord) =>
  record.state === "progressing" || record.state === "paused";

function stateLabel(record: DownloadRecord): string {
  // A server that sends no Content-Length leaves `totalBytes` at 0; show what has
  // arrived rather than "0 B of 0 B".
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
      return "Interrupted — start it again from the title page";
  }
}

export function DownloadsPage() {
  const downloads = useApp((state) => state.downloads);
  const loadDownloads = useApp((state) => state.loadDownloads);
  const removeDownload = useApp((state) => state.removeDownload);
  const cancelDownload = useApp((state) => state.cancelDownload);
  const openPlayer = useApp((state) => state.openPlayer);
  const notify = useApp((state) => state.notify);

  useEffect(() => {
    void loadDownloads();
  }, [loadDownloads]);

  const running = downloads.filter(isRunning);
  const finished = downloads.filter((record) => !isRunning(record));

  const playHere = async (record: DownloadRecord) => {
    if (!record.fileExists) {
      notify({ kind: "error", title: "File is missing", body: record.savePath });
      return;
    }

    // Records saved before the year was tracked have none, and playing them would write
    // a history entry with a blank line under the title. One cached lookup fixes that;
    // failure is fine, since the year is cosmetic.
    let year = record.year ?? "";
    if (!year) {
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
      live: false,
      posterUrl: record.posterUrl,
      subjectId: record.subjectId,
      season: record.season,
      episode: record.episode,
      mediaType: record.mediaType,
      // Without this the history entry is saved with an empty year, and the card on Home
      // ends up missing the line that streaming-watched titles have.
      year,
      // `local:` tells the main process to read the saved caption file from disk instead
      // of fetching it, so subtitles work with no network.
      subtitles: (record.subtitles ?? []).map((track) => ({
        name: track.name,
        nativeName: track.nativeName,
        lang: track.lang,
        url: `local:${track.path}`,
      })),
      // A downloaded caption was saved deliberately, so switch it on rather than making
      // the user pick it again every time — this ignores the global "Off" preference.
      initialSubtitle: record.subtitles?.[0]?.name,
    });
  };

  const openExternally = async (record: DownloadRecord) => {
    const error = await unwrap(api.downloads.open(record.id)).catch((cause: Error) => cause.message);
    if (error) notify({ kind: "error", title: "Could not open the file", body: error });
  };

  const row = (record: DownloadRecord) => {
    const percent =
      record.totalBytes > 0 ? Math.min(record.receivedBytes / record.totalBytes, 1) : 0;
    const playable = record.state === "completed" && record.fileExists;

    return (
      <div className="download-row" key={record.id}>
        <div className="download-art">
          {record.posterUrl ? (
            <img src={record.posterUrl} alt="" loading="lazy" />
          ) : (
            <div style={{ width: "100%", height: "100%", background: "var(--bg-hover)" }} />
          )}
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

          <div className="download-meta">
            {stateLabel(record)}
            {record.subtitles?.length > 0 && ` · ${record.subtitles.length} subtitle tracks`}
          </div>

          {isRunning(record) && (
            <div className="download-bar">
              <span style={{ width: `${percent * 100}%` }} />
            </div>
          )}
        </div>

        <div className="download-actions">
          {playable && (
            <>
              <button className="btn btn-sm btn-primary" onClick={() => void playHere(record)}>
                <Play size={14} fill="currentColor" /> Play
              </button>
              <button
                className="icon-button"
                onClick={() => void openExternally(record)}
                aria-label="Open in the system player"
                title="Open in the system player"
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

          {record.state === "progressing" && (
            <button
              className="icon-button"
              onClick={() => void api.downloads.pause(record.id)}
              aria-label="Pause"
              title="Pause"
            >
              <Pause size={16} />
            </button>
          )}

          {record.state === "paused" && (
            <button
              className="icon-button"
              onClick={() => void api.downloads.resume(record.id)}
              aria-label="Resume"
              title="Resume"
            >
              <Play size={16} />
            </button>
          )}

          {isRunning(record) ? (
            <button
              className="icon-button"
              onClick={() => void cancelDownload(record.id)}
              aria-label="Cancel download"
              title="Cancel download"
            >
              <X size={16} />
            </button>
          ) : (
            <button
              className="icon-button"
              onClick={() => void removeDownload(record.id, record.fileExists)}
              aria-label="Delete download"
              title={record.fileExists ? "Delete file and entry" : "Remove from the list"}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    );
  };

  if (downloads.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Downloads</h1>
        <EmptyState
          title="Nothing downloaded yet"
          body="Use the download button on any title to save it for offline viewing."
        />
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 940 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <h1 className="page-title">Downloads</h1>
        {finished.length > 0 && (
          <button
            className="btn btn-sm btn-ghost"
            style={{ marginLeft: "auto" }}
            onClick={async () => {
              useApp.setState({ downloads: await unwrap(api.downloads.clearFinished()) });
            }}
          >
            <Trash2 size={14} /> Clear finished
          </button>
        )}
      </div>

      {running.length > 0 && (
        <section className="section">
          <h2 className="section-title">In progress</h2>
          {running.map(row)}
        </section>
      )}

      {finished.length > 0 && (
        <section className="section">
          <h2 className="section-title">On this device</h2>
          {finished.map(row)}
        </section>
      )}
    </div>
  );
}
