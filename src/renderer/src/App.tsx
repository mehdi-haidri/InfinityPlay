import { useEffect, useState } from "react";
import { AlertTriangle, Download as DownloadIcon, Info, X } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Player } from "./components/Player";
import { Splash } from "./components/Splash";
import { HomePage } from "./pages/HomePage";
import { SearchPage } from "./pages/SearchPage";
import { DetailsPage } from "./pages/DetailsPage";
import { LiveTvPage } from "./pages/LiveTvPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AboutPage } from "./pages/AboutPage";
import { DownloadsPage } from "./pages/DownloadsPage";
import { formatBytes } from "./lib/format";
import { useApp } from "./store";

function Routes() {
  const route = useApp((state) => state.route);

  switch (route.name) {
    case "home":
      return <HomePage />;
    case "search":
      return <SearchPage query={route.query} />;
    case "details":
      return (
        <DetailsPage
          key={route.id}
          id={route.id}
          initialSeason={route.season}
          initialEpisode={route.episode}
          audioLocked={route.audioLocked}
        />
      );
    case "livetv":
      return <LiveTvPage />;
    case "history":
      return <HistoryPage />;
    case "settings":
      return <SettingsPage />;
    case "downloads":
      return <DownloadsPage />;
    case "about":
      return <AboutPage />;
  }
}

function Toasts() {
  const toasts = useApp((state) => state.toasts);
  const downloads = useApp((state) => state.downloads);
  const dismiss = useApp((state) => state.dismissToast);
  const navigate = useApp((state) => state.navigate);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts">
      {toasts.map((toast) => {
        const record = toast.downloadId
          ? downloads.find((entry) => entry.id === toast.downloadId)
          : undefined;
        const percent =
          record && record.totalBytes > 0
            ? Math.min(record.receivedBytes / record.totalBytes, 1)
            : 0;

        return (
          <div className="toast" key={toast.id} data-kind={toast.kind} role="status">
            {toast.kind === "error" ? (
              <AlertTriangle size={16} color="var(--accent)" />
            ) : toast.kind === "progress" ? (
              <DownloadIcon size={16} color="var(--accent)" />
            ) : (
              <Info size={16} color="var(--text-muted)" />
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="toast-title">{toast.title}</div>
              {toast.body && <div className="toast-body">{toast.body}</div>}

              {record && toast.kind === "progress" && (
                <>
                  <div className="toast-bar">
                    <span style={{ width: `${percent * 100}%` }} />
                  </div>
                  <div className="toast-body" style={{ display: "flex", gap: 8 }}>
                    <span>
                      {record.totalBytes > 0
                        ? `${Math.round(percent * 100)}% · ${formatBytes(record.receivedBytes)} of ${formatBytes(record.totalBytes)}`
                        : formatBytes(record.receivedBytes)}
                    </span>
                    <button
                      className="toast-link"
                      onClick={() => navigate({ name: "downloads" })}
                    >
                      View
                    </button>
                  </div>
                </>
              )}
            </div>

            <button className="icon-button" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function App() {
  const loadConfig = useApp((state) => state.loadConfig);
  const loadWatchHistory = useApp((state) => state.loadWatchHistory);
  const loadDownloads = useApp((state) => state.loadDownloads);
  const watchDownloads = useApp((state) => state.watchDownloads);
  const route = useApp((state) => state.route);
  const player = useApp((state) => state.player);

  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // The splash lifts once the persisted state is in, so the first frame behind it is
    // the real UI rather than empty shells.
    void Promise.allSettled([loadConfig(), loadWatchHistory(), loadDownloads()]).then(() =>
      setBooted(true),
    );
    // One subscription for the whole app: progress feeds both the toasts and the page.
    return watchDownloads();
  }, [loadConfig, loadWatchHistory, loadDownloads, watchDownloads]);

  // Every route change starts at the top, the way a browser would.
  useEffect(() => {
    document.querySelector(".main")?.scrollTo({ top: 0 });
  }, [route]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        <Routes />
      </div>
      {player && <Player />}
      <Toasts />
      <Splash ready={booted} />
    </div>
  );
}
