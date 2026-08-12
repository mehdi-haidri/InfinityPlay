import { useEffect, useState } from "react";
import { Download, Github, Mail, RefreshCw, RotateCw } from "lucide-react";
import { AUTHOR, type AppInfo, type UpdateStatus } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { formatBytes } from "../lib/format";
import { Spinner } from "../components/States";
import { useApp } from "../store";

function statusLine(status: UpdateStatus): { text: string; busy: boolean } {
  switch (status.state) {
    case "checking":
      return { text: "Checking for updates…", busy: true };
    case "available":
      return { text: `Version ${status.version} found — downloading…`, busy: true };
    case "downloading":
      return {
        text: `Downloading… ${status.percent}% (${formatBytes(status.transferred)} of ${formatBytes(status.total)})`,
        busy: true,
      };
    case "downloaded":
      return { text: `Version ${status.version} is ready to install.`, busy: false };
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

  const open = (url: string) => void api.system.openExternal(url);
  const line = statusLine(status);

  return (
    <div className="page" style={{ maxWidth: 780 }}>
      <h1 className="page-title">About</h1>

      <section className="panel about-hero">
        <img
          className="about-avatar"
          src={`${AUTHOR.github}.png?size=200`}
          alt=""
          referrerPolicy="no-referrer"
        />
        <div style={{ minWidth: 0 }}>
          <div className="about-name">{AUTHOR.name}</div>
          <div className="setting-hint" style={{ marginBottom: 14 }}>
            Developer of InfinityPlay
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={() => open(AUTHOR.github)}>
              <Github size={15} /> {AUTHOR.githubHandle}
            </button>
            <button className="btn btn-sm" onClick={() => open(`mailto:${AUTHOR.email}`)}>
              <Mail size={15} /> {AUTHOR.email}
            </button>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-title">Updates</div>

        <div className="setting">
          <div style={{ minWidth: 0 }}>
            <div className="setting-label">
              InfinityPlay {info ? `v${info.version}` : ""}
            </div>
            <div className="setting-hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {line.busy && <Spinner />}
              <span>{line.text}</span>
            </div>
          </div>

          {status.state === "downloaded" ? (
            <button className="btn btn-sm btn-primary" onClick={() => void install()}>
              <Download size={14} /> Restart & install
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => void check()}
              disabled={line.busy || status.state === "unsupported"}
            >
              {line.busy ? <RefreshCw size={14} /> : <RotateCw size={14} />} Check now
            </button>
          )}
        </div>

        <div className="setting-hint" style={{ paddingTop: 4 }}>
          Updates are downloaded from the project's GitHub releases and installed on
          restart.
        </div>
      </section>

      {info && (
        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel-title">Build</div>
          <dl className="meta-list">
            <div><dt>Version</dt><dd>{info.version}</dd></div>
            <div><dt>Electron</dt><dd>{info.electron}</dd></div>
            <div><dt>Chromium</dt><dd>{info.chrome}</dd></div>
            <div><dt>Node</dt><dd>{info.node}</dd></div>
            <div><dt>Platform</dt><dd>{info.platform}</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}
