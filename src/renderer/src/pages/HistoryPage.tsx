import { Trash2 } from "lucide-react";
import { relativeTime, formatTime } from "../lib/format";
import { EmptyState } from "../components/States";
import { useApp } from "../store";
import { PageHeader } from "../components/PageHeader";
import { MediaImage } from "../components/MediaImage";

export function HistoryPage() {
  const watchHistory = useApp((state) => state.watchHistory);
  const forgetTitle = useApp((state) => state.forgetTitle);
  const clearWatchHistory = useApp((state) => state.clearWatchHistory);
  const navigate = useApp((state) => state.navigate);

  if (watchHistory.length === 0) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Your library"
          title="Continue watching"
          description="Resume films and episodes from where you stopped."
        />
        <EmptyState title="Nothing watched yet" body="Titles you start show up here with their resume point." />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Your library"
        title="Continue watching"
        description="Resume films and episodes from where you stopped."
        action={<button
          className="btn btn-sm btn-ghost"
          onClick={() => void clearWatchHistory()}
        >
          <Trash2 size={14} /> Clear all
        </button>}
      />

      <div className="grid">
        {watchHistory.map((entry) => {
          const progress = entry.duration > 0 ? entry.position / entry.duration : 0;
          return (
            <div key={`${entry.subjectId}-${entry.season}-${entry.episode}`}>
              <button
                className="card"
                onClick={() => navigate({ name: "details", id: entry.subjectId })}
              >
                <div className="card-art">
                  <MediaImage src={entry.posterUrl} label={entry.title} alt="" />
                  <span className="badge">
                    {entry.season > 0 ? `S${entry.season}E${entry.episode}` : "Movie"}
                  </span>
                  {progress > 0 && (
                    <span className="progress-strip">
                      <span style={{ width: `${Math.min(progress, 1) * 100}%` }} />
                    </span>
                  )}
                </div>
                <div>
                  <div className="card-title">{entry.title}</div>
                  <div className="card-sub">
                    {formatTime(entry.position)}
                    {entry.duration > 0 ? ` / ${formatTime(entry.duration)}` : ""} ·{" "}
                    {relativeTime(entry.timestamp)}
                  </div>
                </div>
              </button>
              <button
                className="btn btn-sm btn-ghost card-secondary-action"
                onClick={() => void forgetTitle(entry.subjectId)}
              >
                <Trash2 size={13} /> Remove
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
