import { useState } from "react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import type { AppConfig } from "@shared/types";
import { api, unwrap } from "../../lib/api";

interface Props {
  config: AppConfig;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;
  notify: (toast: { kind: "info" | "error"; title: string; body?: string }) => void;
}

export function IptvSection({ config, patchConfig, notify }: Props) {
  const [playlistName, setPlaylistName] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistEpgUrl, setPlaylistEpgUrl] = useState("");
  const [xtreamName, setXtreamName] = useState("");
  const [xtreamServer, setXtreamServer] = useState("");
  const [xtreamUsername, setXtreamUsername] = useState("");
  const [xtreamPassword, setXtreamPassword] = useState("");

  const addPlaylist = (name: string, url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    if (config.playlists.some((playlist) => playlist.url === trimmedUrl)) {
      notify({ kind: "error", title: "Already added", body: "That playlist is in the list." });
      return;
    }
    void patchConfig({
      playlists: [
        ...config.playlists,
        {
          name: name.trim() || trimmedUrl,
          url: trimmedUrl,
          trust: "user",
          trustNote: "Playlist added by you.",
          epgUrl: playlistEpgUrl.trim() || undefined,
        },
      ],
    });
    setPlaylistName("");
    setPlaylistUrl("");
    setPlaylistEpgUrl("");
  };

  const addXtream = () => {
    if (!xtreamServer.trim() || !xtreamUsername.trim() || !xtreamPassword) {
      notify({ kind: "error", title: "Missing IPTV login", body: "Enter the server, username, and password." });
      return;
    }
    try {
      const url = new URL(xtreamServer.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      notify({ kind: "error", title: "Invalid IPTV server", body: "Use a complete HTTP or HTTPS server URL." });
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() ?? `iptv-${Date.now()}`;
    void patchConfig({
      xtreamSources: [
        ...config.xtreamSources,
        {
          id,
          name: xtreamName.trim() || "My IPTV",
          serverUrl: xtreamServer.trim(),
          username: xtreamUsername.trim(),
          password: xtreamPassword,
        },
      ],
    });
    setXtreamName("");
    setXtreamServer("");
    setXtreamUsername("");
    setXtreamPassword("");
  };

  const pickFile = async () => {
    try {
      const path = await unwrap(api.system.pickPlaylistFile());
      if (path) addPlaylist(path.split(/[\\/]/).pop() ?? "Local playlist", path);
    } catch (error) {
      notify({
        kind: "error",
        title: "Could not open file",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <section className="setting-block">
      <h2 className="setting-title">Live TV Sources</h2>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8, color: "var(--text)" }}>M3U Playlists</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {config.playlists.map((pl) => (
            <div
              key={pl.url}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "var(--surface)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
                <div style={{ fontWeight: 500, fontSize: 13, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {pl.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {pl.url}
                </div>
              </div>
              <button
                className="icon-button"
                onClick={() =>
                  void patchConfig({
                    playlists: config.playlists.filter((p) => p.url !== pl.url),
                  })
                }
                title="Remove playlist"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            className="input"
            placeholder="Playlist name"
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            style={{ flex: 1, minWidth: 140 }}
          />
          <input
            type="text"
            className="input"
            placeholder="M3U / M3U8 URL"
            value={playlistUrl}
            onChange={(e) => setPlaylistUrl(e.target.value)}
            style={{ flex: 2, minWidth: 200 }}
          />
          <button className="btn btn-sm" onClick={() => addPlaylist(playlistName, playlistUrl)}>
            <Plus size={14} /> Add URL
          </button>
          <button className="btn btn-sm" onClick={() => void pickFile()}>
            <FolderOpen size={14} /> Open file
          </button>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, marginBottom: 8, color: "var(--text)" }}>Xtream Codes Accounts</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {config.xtreamSources.map((xs) => (
            <div
              key={xs.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "var(--surface)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{xs.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{xs.serverUrl} ({xs.username})</div>
              </div>
              <button
                className="icon-button"
                onClick={() =>
                  void patchConfig({
                    xtreamSources: config.xtreamSources.filter((s) => s.id !== xs.id),
                  })
                }
                title="Remove account"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            className="input"
            placeholder="Account name"
            value={xtreamName}
            onChange={(e) => setXtreamName(e.target.value)}
          />
          <input
            type="text"
            className="input"
            placeholder="Server URL (http://...)"
            value={xtreamServer}
            onChange={(e) => setXtreamServer(e.target.value)}
          />
          <input
            type="text"
            className="input"
            placeholder="Username"
            value={xtreamUsername}
            onChange={(e) => setXtreamUsername(e.target.value)}
          />
          <input
            type="password"
            className="input"
            placeholder="Password"
            value={xtreamPassword}
            onChange={(e) => setXtreamPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-sm" onClick={addXtream}>
          <Plus size={14} /> Add Xtream Account
        </button>
      </div>
    </section>
  );
}
