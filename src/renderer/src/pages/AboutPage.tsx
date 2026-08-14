import { useEffect, useState } from "react";
import { Download, Mail, Pause, Play, RefreshCw, RotateCw } from "lucide-react";
import { AUTHORS, type AppInfo, type UpdateStatus } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { formatBytes } from "../lib/format";
import { Spinner } from "../components/States";
import { PageHeader } from "../components/PageHeader";
import { ReleaseNotes } from "../components/ReleaseNotes";
import { newestNotes, notesForVersion } from "../lib/releaseNotes";
import { useApp } from "../store";

/** lucide dropped its brand icons in v1, so the GitHub mark is drawn locally. */
function GitHubMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function statusLine(status: UpdateStatus): { text: string; busy: boolean } {
  switch (status.state) {
    case "checking":
      return { text: "Checking for updates…", busy: true };
    case "available":
      return { text: `Version ${status.version} is available.`, busy: false };
    case "downloading":
      return {
        text: `Downloading… ${status.percent}% (${formatBytes(status.transferred)} of ${formatBytes(status.total)})`,
        busy: true,
      };
    case "paused":
      return {
        text: `Paused at ${status.percent}% of version ${status.version}.`,
        busy: false,
      };
    case "declined":
      return { text: `Version ${status.version} is available whenever you want it.`, busy: false };
    case "downloaded":
      return {
        text: `Version ${status.version} is ready — restart now, or it installs when you close the app.`,
        busy: false,
      };
    case "up-to-date":
      return { text: "You are on the latest version.", busy: false };
    case "error":
      return { text: `Update check failed: ${status.message}`, busy: false };
    case "unsupported":
      return { text: status.message, busy: false };
    default:
      return { text: "No update check has run yet.", busy: false };
  }
}

function packageHelp(info: AppInfo | null): string {
  if (!info) return "InfinityPlay checks for updates on launch and asks before downloading one.";
  if (info.packageType.includes("macOS")) {
    return "This macOS build is unsigned, so it cannot replace itself. A signed release will update in place.";
  }
  if (info.packageType === "AppImage") {
    return "The update is downloaded here and swapped in after a restart; keep the AppImage executable.";
  }
  if (info.packageType.includes("DEB") || info.packageType.includes("RPM") || info.packageType === "pacman") {
    return "System packages are updated by your package manager, so this build does not replace itself.";
  }
  if (info.packageType.includes("Android")) {
    return "Android installs its updates through the system package installer.";
  }
  return "Updates are downloaded here and installed when the app restarts.";
}

export function AboutPage() {
  const notify = useApp((state) => state.notify);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => {
    unwrap(api.app.info()).then(setInfo).catch(() => setInfo(null));
    unwrap(api.updates.status()).then(setStatus).catch(() => undefined);
    return api.updates.onStatus(setStatus);
  }, []);

  const check = async () => {
    try {
      setStatus(await unwrap(api.updates.check()));
    } catch (error) {
      notify({
        kind: "error",
        title: "Could not check for updates",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const install = async () => {
    try {
      await unwrap(api.updates.install());
    } catch (error) {
      notify({
        kind: "error",
        title: "Could not install the update",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const download = () => void api.updates.download();
  const pause = () => void api.updates.pause();
  const decline = () => void api.updates.decline();

  const open = (url: string) => void api.system.openExternal(url);
  const line = statusLine(status);
  const isAndroid = info?.runtime === "android";

  /*
   * Notes are always on screen. Normally they describe the running build, read from the
   * RELEASES.md bundled with it; once an update is on offer they switch to that release's own
   * notes, so the user can see what they are accepting before they accept it.
   */
  const incomingNotes = "notes" in status && status.notes ? status.notes : null;
  const incomingVersion = "version" in status && incomingNotes ? status.version : null;
  const installed = info ? notesForVersion(info.version) ?? newestNotes() : newestNotes();
  const shownNotes = incomingNotes ?? installed?.body ?? null;
  const shownVersion = incomingVersion ?? installed?.version ?? info?.version ?? "";

  return (
    <div className="page page-narrow">
      <PageHeader
        eyebrow="InfinityPlay"
        title="About"
        description="Version, release help, and project credits."
      />

      {AUTHORS.map((author) => (
        <section className="panel about-hero" key={author.github} style={{ marginBottom: 12 }}>
          <img
            className="about-avatar"
            src={`${author.github}.png?size=200`}
            alt={`Portrait of ${author.name}`}
            referrerPolicy="no-referrer"
          />
          <div className="min-width-zero">
            <div className="about-name">{author.name}</div>
            <div className="setting-hint about-role">
              {author.role}
            </div>
            <div className="inline-actions inline-actions-wrap" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => open(author.github)}>
                <GitHubMark size={15} /> {author.githubHandle}
              </button>
              <button className="btn btn-sm" onClick={() => open(`mailto:${author.email}`)}>
                <Mail size={15} /> {author.email}
              </button>
            </div>
          </div>
        </section>
      ))}

      <section className="panel panel-spaced">
        <div className="panel-title">Updates</div>

        <div className="setting">
          <div className="min-width-zero">
            <div className="setting-label">
              InfinityPlay {info ? `v${info.version}` : ""}
            </div>
            <div className="setting-hint status-line">
              {line.busy && <Spinner />}
              <span>{line.text}</span>
            </div>
          </div>

          {/* Every state offers exactly the choices that make sense in it, so the card never
              shows a control that would do nothing. */}
          <div className="update-actions">
            {status.state === "downloaded" ? (
              <button className="btn btn-sm btn-primary" onClick={() => void install()}>
                <Download size={14} /> Restart & install
              </button>
            ) : status.state === "unsupported" ? (
              // No button: this build cannot replace itself, and sending the user to a browser
              // is not an update flow. The message alone says why.
              null
            ) : status.state === "available" ? (
              <>
                <button className="btn btn-sm btn-primary" onClick={download}>
                  <Download size={14} /> Download update
                </button>
                <button className="btn btn-sm" onClick={decline}>
                  Not now
                </button>
              </>
            ) : status.state === "downloading" ? (
              <button className="btn btn-sm" onClick={pause}>
                <Pause size={14} /> Pause
              </button>
            ) : status.state === "paused" ? (
              <>
                <button className="btn btn-sm btn-primary" onClick={download}>
                  <Play size={14} /> Resume
                </button>
                <button className="btn btn-sm" onClick={decline}>
                  Cancel
                </button>
              </>
            ) : status.state === "declined" ? (
              <button className="btn btn-sm btn-primary" onClick={download}>
                <Download size={14} /> Download update
              </button>
            ) : (
              <button className="btn btn-sm" onClick={() => void check()} disabled={line.busy}>
                {line.busy ? <RefreshCw size={14} /> : <RotateCw size={14} />} Check now
              </button>
            )}
          </div>
        </div>

        <div className="setting-hint update-help">
          {status.state === "paused"
            ? "Resuming starts the transfer again from the beginning — the updater cannot continue a partial download."
            : packageHelp(info)}
        </div>

        {shownNotes && (
          <details className="release-notes-block" open>
            <summary className="release-notes-summary">
              {incomingNotes ? `What's new in ${shownVersion}` : `Release notes · ${shownVersion}`}
            </summary>
            <ReleaseNotes body={shownNotes} />
          </details>
        )}
      </section>

      {info && (
        <section className="panel panel-spaced">
          <div className="panel-title">{isAndroid ? "Android app" : "Desktop build"}</div>
          <dl className="meta-list">
            <div><dt>App version</dt><dd>{info.version}</dd></div>
            {isAndroid ? (
              info.buildNumber && <div><dt>Build code</dt><dd>{info.buildNumber}</dd></div>
            ) : (
              <>
                <div><dt>Electron</dt><dd>{info.electron}</dd></div>
                <div><dt>Chromium</dt><dd>{info.chrome}</dd></div>
                <div><dt>Node</dt><dd>{info.node}</dd></div>
                <div><dt>FFmpeg</dt><dd>{info.ffmpegVersion || (info.ffmpeg ? "Available" : "Not found")}</dd></div>
              </>
            )}
            <div><dt>Platform</dt><dd>{info.platform}</dd></div>
            <div><dt>Package</dt><dd>{info.packageType}</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}
