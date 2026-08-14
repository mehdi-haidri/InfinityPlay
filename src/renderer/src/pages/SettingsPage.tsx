import { useEffect, useState } from "react";
import { FolderOpen, Plus, RotateCw, Trash2 } from "lucide-react";
import {
  AUDIO_PREFERENCES,
  CATALOG_COUNTRIES,
  SUBTITLE_COLORS,
  SUBTITLE_FONT_FAMILIES,
  SUBTITLE_EDGE_STYLES,
  SUBTITLE_POSITIONS,
  SUBTITLE_LANGUAGES,
  SUBTITLE_OFF,
  type AppConfig,
  type AppInfo,
  type SubtitleFontFamily,
  type SubtitleEdgeStyle,
  type SubtitlePosition,
} from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useApp } from "../store";
import { PageHeader } from "../components/PageHeader";

const THEMES: { value: AppConfig["theme"]; label: string }[] = [
  { value: "midnight", label: "Midnight (rose accent)" },
  { value: "noir", label: "Noir (monochrome)" },
  { value: "ember", label: "Ember (amber accent)" },
  { value: "ocean", label: "Ocean (teal accent)" },
  { value: "forest", label: "Forest (green accent)" },
  { value: "plum", label: "Plum (violet accent)" },
];

const RESOLUTIONS = [0, 2160, 1080, 720, 480, 360];

export function SettingsPage() {
  const config = useApp((state) => state.config);
  const patchConfig = useApp((state) => state.patchConfig);
  const notify = useApp((state) => state.notify);

  const [playlistName, setPlaylistName] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistEpgUrl, setPlaylistEpgUrl] = useState("");
  const [xtreamName, setXtreamName] = useState("");
  const [xtreamServer, setXtreamServer] = useState("");
  const [xtreamUsername, setXtreamUsername] = useState("");
  const [xtreamPassword, setXtreamPassword] = useState("");
  const [tmdbToken, setTmdbToken] = useState(config.tmdbReadToken);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    unwrap(api.app.info()).then(setAppInfo).catch(() => undefined);
  }, []);

  const addPlaylist = (name: string, url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    if (config.playlists.some((playlist) => playlist.url === trimmedUrl)) {
      notify({ kind: "error", title: "Already added", body: "That playlist is in the list." });
      return;
    }
    void patchConfig({
      playlists: [...config.playlists, {
        name: name.trim() || trimmedUrl,
        url: trimmedUrl,
        trust: "user",
        trustNote: "Playlist added by you.",
        epgUrl: playlistEpgUrl.trim() || undefined,
      }],
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
      xtreamSources: [...config.xtreamSources, {
        id,
        name: xtreamName.trim() || "My IPTV",
        serverUrl: xtreamServer.trim(),
        username: xtreamUsername.trim(),
        password: xtreamPassword,
      }],
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
    <div className="page page-narrow">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Control catalog, playback, subtitles, downloads, and live TV sources."
      />

      <section className="panel panel-section">
        <div className="panel-title">Appearance & playback</div>

        <div className="setting">
          <div>
            <div className="setting-label">Theme</div>
            <div className="setting-hint">Changes the accent colour across the app.</div>
          </div>
          <select
            className="input"
            value={config.theme}
            onChange={(event) => void patchConfig({ theme: event.target.value as AppConfig["theme"] })}
          >
            {THEMES.map((theme) => (
              <option key={theme.value} value={theme.value}>{theme.label}</option>
            ))}
          </select>
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Resume playback</div>
            <div className="setting-hint">Ask each time, always continue, or always start from the beginning.</div>
          </div>
          <select
            className="input"
            value={config.resumeBehavior}
            onChange={(event) => void patchConfig({ resumeBehavior: event.target.value as AppConfig["resumeBehavior"] })}
          >
            <option value="ask">Ask me</option>
            <option value="resume">Always continue</option>
            <option value="restart">Always start over</option>
          </select>
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Hardware acceleration</div>
            <div className="setting-hint">
              Uses NVIDIA, AMD, or Intel decoding through Electron and FFmpeg when the installed driver supports it. Restart required.
              {appInfo?.gpu ? ` Detected: ${appInfo.gpu}.` : ""}
            </div>
          </div>
          <button
            className="switch"
            data-on={config.hardwareAcceleration}
            aria-pressed={config.hardwareAcceleration}
            aria-label="Hardware acceleration"
            onClick={async () => {
              await patchConfig({ hardwareAcceleration: !config.hardwareAcceleration });
              setRestartNeeded(true);
            }}
          />
        </div>

        {restartNeeded && (
          <div className="setting-restart" role="status">
            <span>The acceleration change takes effect after restart.</span>
            <button className="btn btn-sm" onClick={() => void api.system.restart()}>
              <RotateCw size={14} /> Restart now
            </button>
          </div>
        )}

        <div className="setting">
          <div>
            <div className="setting-label">Reduce motion</div>
            <div className="setting-hint">Disables interface animation and smooth scrolling without changing the theme.</div>
          </div>
          <button
            className="switch"
            data-on={config.reducedMotion}
            aria-pressed={config.reducedMotion}
            aria-label="Reduce motion"
            onClick={() => void patchConfig({ reducedMotion: !config.reducedMotion })}
          />
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Catalog region</div>
            <div className="setting-hint">
              Which country's catalog the Home rows are built from. MovieBox's own feed is
              India-focused regardless of where you are, so this filters the catalog
              directly. “All” is the unfiltered, universal catalog — broader, but noisier.
            </div>
          </div>
          <select
            className="input"
            value={config.catalogCountry}
            onChange={(event) => void patchConfig({ catalogCountry: event.target.value })}
          >
            {CATALOG_COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country === "All" ? "All countries (universal)" : country}
              </option>
            ))}
          </select>
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Preferred audio</div>
            <div className="setting-hint">
              English is the fallback. Arabic and French are used when selected and
              available; Hindi and other dubbed variants are excluded.
            </div>
          </div>
          <select
            className="input"
            value={config.preferredAudio}
            onChange={(event) => void patchConfig({ preferredAudio: event.target.value })}
          >
            {AUDIO_PREFERENCES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Preferred subtitle</div>
            <div className="setting-hint">
              Switched on automatically when playback starts, when the title carries that
              language. Every title also has its own subtitle picker.
            </div>
          </div>
          <select
            className="input"
            value={config.preferredSubtitle}
            onChange={(event) => void patchConfig({ preferredSubtitle: event.target.value })}
          >
            <option value={SUBTITLE_OFF}>Off</option>
            {SUBTITLE_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.native && language.native !== language.name
                  ? `${language.name} — ${language.native}`
                  : language.name}
              </option>
            ))}
          </select>
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Preferred quality</div>
            <div className="setting-hint">Used when a title offers it; otherwise the best available plays.</div>
          </div>
          <select
            className="input"
            value={config.defaultResolution}
            onChange={(event) => void patchConfig({ defaultResolution: Number(event.target.value) })}
          >
            {RESOLUTIONS.map((resolution) => (
              <option key={resolution} value={resolution}>
                {resolution === 0 ? "Best available" : resolution === 2160 ? "4K" : `${resolution}p`}
              </option>
            ))}
          </select>
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Hide adult content</div>
            <div className="setting-hint">
              MovieBox mixes pornography into ordinary rows. This keeps it out of Home,
              search and suggestions, using the catalog's own age flag plus genre and
              title markers. A few explicitly erotic mainstream films are caught too.
            </div>
          </div>
          <button
            className="switch"
            data-on={config.hideAdultContent}
            aria-pressed={config.hideAdultContent}
            aria-label="Hide adult content"
            onClick={() => void patchConfig({ hideAdultContent: !config.hideAdultContent })}
          />
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Subtitles with downloads</div>
            <div className="setting-hint">
              Saved next to the video as <code>.srt</code>, sharing its filename so
              external players load them automatically. Titles often carry sixteen
              languages, so only the preferred one is kept by default.
            </div>
          </div>
          <select
            className="input"
            value={config.downloadSubtitles}
            onChange={(event) =>
              void patchConfig({
                downloadSubtitles: event.target.value as AppConfig["downloadSubtitles"],
              })
            }
          >
            <option value="preferred">Preferred language only</option>
            <option value="all">Every available language</option>
            <option value="none">Do not download subtitles</option>
          </select>
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Subtitle appearance</div>
            <div className="setting-hint">
              Netflix-style subtitle customization: Size, Font Family, Colour, Background, Edge Style, and Position.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-end", width: "100%", maxWidth: 360 }}>
            {/* Size Stepper */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <span className="setting-hint" style={{ margin: 0 }}>Font Size</span>
              <div className="cue-stepper">
                <button
                  onClick={() =>
                    void patchConfig({ subtitleSize: Math.max(60, config.subtitleSize - 10) })
                  }
                  aria-label="Smaller subtitles"
                >
                  −
                </button>
                <b>{config.subtitleSize}%</b>
                <button
                  onClick={() =>
                    void patchConfig({ subtitleSize: Math.min(220, config.subtitleSize + 10) })
                  }
                  aria-label="Larger subtitles"
                >
                  +
                </button>
              </div>
            </div>

            {/* Font Family Selector */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <span className="setting-hint" style={{ margin: 0 }}>Font Style</span>
              <select
                className="input"
                style={{ width: 180 }}
                value={config.subtitleFontFamily ?? "sans-serif"}
                onChange={(event) =>
                  void patchConfig({ subtitleFontFamily: event.target.value as SubtitleFontFamily })
                }
              >
                {SUBTITLE_FONT_FAMILIES.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Text Color Swatches */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <span className="setting-hint" style={{ margin: 0 }}>Text Colour</span>
              <div className="cue-swatches">
                {SUBTITLE_COLORS.map((option) => (
                  <button
                    key={option.value}
                    className="cue-swatch"
                    style={{ background: option.value }}
                    data-active={config.subtitleColor === option.value}
                    title={option.label}
                    aria-label={option.label}
                    onClick={() => void patchConfig({ subtitleColor: option.value })}
                  />
                ))}
              </div>
            </div>

            {/* Background Style */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <span className="setting-hint" style={{ margin: 0 }}>Background</span>
              <div className="cue-segments">
                {(["box", "window", "semi-transparent", "none"] as const).map((option) => (
                  <button
                    key={option}
                    data-active={config.subtitleBackground === option}
                    onClick={() => void patchConfig({ subtitleBackground: option })}
                  >
                    {option === "box" ? "Solid" : option === "window" ? "Window" : option === "semi-transparent" ? "Translucent" : "None"}
                  </button>
                ))}
              </div>
            </div>

            {/* Edge Style (Shadow/Outline) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <span className="setting-hint" style={{ margin: 0 }}>Edge Style</span>
              <select
                className="input"
                style={{ width: 180 }}
                value={config.subtitleEdgeStyle ?? "drop-shadow"}
                onChange={(event) =>
                  void patchConfig({ subtitleEdgeStyle: event.target.value as SubtitleEdgeStyle })
                }
              >
                {SUBTITLE_EDGE_STYLES.map((edge) => (
                  <option key={edge.value} value={edge.value}>
                    {edge.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Live Subtitle Preview Box */}
            <div
              style={{
                width: "100%",
                height: 70,
                borderRadius: "var(--radius)",
                background: "#050608 url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 20 20\"><rect width=\"20\" height=\"20\" fill=\"%23101219\"/><circle cx=\"10\" cy=\"10\" r=\"2\" fill=\"%231c1f2b\"/></svg>')",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 6,
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  fontSize: `${Math.round((config.subtitleSize ?? 100) * 0.16)}px`,
                  color: config.subtitleColor ?? "#ffffff",
                  backgroundColor:
                    config.subtitleBackground === "box"
                      ? "rgba(0, 0, 0, 0.85)"
                      : config.subtitleBackground === "window"
                        ? "rgba(16, 18, 25, 0.95)"
                        : config.subtitleBackground === "semi-transparent"
                          ? "rgba(0, 0, 0, 0.45)"
                          : "transparent",
                  padding: config.subtitleBackground !== "none" ? "2px 8px" : "0",
                  borderRadius: 4,
                  fontFamily:
                    config.subtitleFontFamily === "serif"
                      ? "Georgia, serif"
                      : config.subtitleFontFamily === "monospace"
                        ? "'Courier New', monospace"
                        : config.subtitleFontFamily === "casual"
                          ? "'Comic Sans MS', sans-serif"
                          : config.subtitleFontFamily === "cursive"
                            ? "'Brush Script MT', cursive"
                            : "sans-serif",
                  fontVariant: config.subtitleFontFamily === "small-caps" ? "small-caps" : "normal",
                  textShadow:
                    config.subtitleEdgeStyle === "outline"
                      ? "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000"
                      : config.subtitleEdgeStyle === "raised"
                        ? "1px 1px 2px #000"
                        : config.subtitleEdgeStyle === "depressed"
                          ? "-1px -1px 2px #000"
                          : config.subtitleEdgeStyle === "none"
                            ? "none"
                            : "0 2px 4px rgba(0,0,0,0.95)",
                }}
              >
                Sample Subtitle Text
              </span>
            </div>
          </div>
        </div>

        <div className="setting">
          <div>
            <div className="setting-label">Autoplay next episode</div>
            <div className="setting-hint">Continues to the next episode when one finishes.</div>
          </div>
          <button
            className="switch"
            data-on={config.autoplayNext}
            aria-pressed={config.autoplayNext}
            aria-label="Autoplay next episode"
            onClick={() => void patchConfig({ autoplayNext: !config.autoplayNext })}
          />
        </div>
      </section>

      <section className="panel panel-section">
        <div className="panel-title">Legal streaming availability</div>
        <div className="setting">
          <div>
            <div className="setting-label">TMDB read token</div>
            <div className="setting-hint">Used locally to request JustWatch availability. It does not unlock or proxy any service.</div>
          </div>
          <input className="input" type="password" autoComplete="off" placeholder="TMDB v4 read token" value={tmdbToken} onChange={(event) => setTmdbToken(event.target.value)} style={{ minWidth: 280 }} />
        </div>
        <div className="setting">
          <div>
            <div className="setting-label">Watch region</div>
            <div className="setting-hint">Two-letter country code used for provider results.</div>
          </div>
          <input className="input" value={config.watchRegion} maxLength={2} onChange={(event) => void patchConfig({ watchRegion: event.target.value.toUpperCase() })} style={{ width: 72, textTransform: "uppercase" }} aria-label="Watch region" />
        </div>
        <button className="btn btn-sm" onClick={() => void patchConfig({ tmdbReadToken: tmdbToken.trim() })}>Save availability token</button>
      </section>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-title">Live TV playlists</div>

        {config.playlists.map((playlist) => (
          <div className="playlist-row" key={playlist.url}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="setting-label">{playlist.name}</div>
              <div className="playlist-url">{playlist.url}</div>
              <div className="setting-hint">{playlist.trust === "official" ? "Verified free source" : playlist.trust === "community" ? "Community-maintained links" : "Added by you"}{playlist.epgUrl ? " · XMLTV guide attached" : ""}</div>
            </div>
            <button
              className="icon-button"
              aria-label={`Remove ${playlist.name}`}
              onClick={() =>
                void patchConfig({
                  playlists: config.playlists.filter((entry) => entry.url !== playlist.url),
                })
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Name"
            value={playlistName}
            onChange={(event) => setPlaylistName(event.target.value)}
            style={{ width: 150 }}
          />
          <input
            className="input"
            placeholder="Optional XMLTV guide URL"
            value={playlistEpgUrl}
            onChange={(event) => setPlaylistEpgUrl(event.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <input
            className="input"
            placeholder="https://… .m3u"
            value={playlistUrl}
            onChange={(event) => setPlaylistUrl(event.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button className="btn btn-sm" onClick={() => addPlaylist(playlistName, playlistUrl)}>
            <Plus size={14} /> Add
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => void pickFile()}>
            <FolderOpen size={14} /> From file
          </button>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-title">My IPTV subscriptions · Xtream</div>
        <div className="setting-hint" style={{ marginBottom: 12 }}>
          Connect only a service you are authorized to use. Credentials stay in InfinityPlay's local configuration and are never bundled with the app.
        </div>
        {config.xtreamSources.map((source) => (
          <div className="playlist-row" key={source.id}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="setting-label">{source.name}</div>
              <div className="playlist-url">{source.serverUrl}</div>
              <div className="setting-hint">User {source.username} · password stored locally</div>
            </div>
            <button className="icon-button" aria-label={`Remove ${source.name}`} onClick={() => void patchConfig({ xtreamSources: config.xtreamSources.filter((entry) => entry.id !== source.id) })}><Trash2 size={16} /></button>
          </div>
        ))}
        <div className="xtream-form">
          <input className="input" placeholder="Name" value={xtreamName} onChange={(event) => setXtreamName(event.target.value)} />
          <input className="input" placeholder="https://provider.example:port" value={xtreamServer} onChange={(event) => setXtreamServer(event.target.value)} />
          <input className="input" placeholder="Username" autoComplete="off" value={xtreamUsername} onChange={(event) => setXtreamUsername(event.target.value)} />
          <input className="input" placeholder="Password" type="password" autoComplete="off" value={xtreamPassword} onChange={(event) => setXtreamPassword(event.target.value)} />
          <button className="btn btn-sm" onClick={addXtream}><Plus size={14} /> Add IPTV login</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">Data</div>
        <div className="setting">
          <div>
            <div className="setting-label">Clear catalog cache</div>
            <div className="setting-hint">Drops cached search, detail and homepage responses.</div>
          </div>
          <button
            className="btn btn-sm"
            onClick={async () => {
              await unwrap(api.catalog.clearCache());
              notify({ kind: "info", title: "Cache cleared" });
            }}
          >
            Clear
          </button>
        </div>
      </section>
    </div>
  );
}
