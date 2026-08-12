import { useState } from "react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import {
  AUDIO_PREFERENCES,
  CATALOG_COUNTRIES,
  ORIGINAL_AUDIO,
  SUBTITLE_COLORS,
  SUBTITLE_LANGUAGES,
  SUBTITLE_OFF,
  type AppConfig,
} from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useApp } from "../store";

const THEMES: { value: AppConfig["theme"]; label: string }[] = [
  { value: "midnight", label: "Midnight (rose accent)" },
  { value: "noir", label: "Noir (monochrome)" },
  { value: "ember", label: "Ember (amber accent)" },
];

const RESOLUTIONS = [0, 2160, 1080, 720, 480, 360];

export function SettingsPage() {
  const config = useApp((state) => state.config);
  const patchConfig = useApp((state) => state.patchConfig);
  const notify = useApp((state) => state.notify);

  const [playlistName, setPlaylistName] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");

  const addPlaylist = (name: string, url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    if (config.playlists.some((playlist) => playlist.url === trimmedUrl)) {
      notify({ kind: "error", title: "Already added", body: "That playlist is in the list." });
      return;
    }
    void patchConfig({
      playlists: [...config.playlists, { name: name.trim() || trimmedUrl, url: trimmedUrl }],
    });
    setPlaylistName("");
    setPlaylistUrl("");
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
    <div className="page" style={{ maxWidth: 780 }}>
      <h1 className="page-title">Settings</h1>

      <section className="panel" style={{ marginBottom: 20 }}>
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
              Many titles are published once per dub. This picks which one search and the
              home rows land on; every title still has a per-title audio switcher.
            </div>
          </div>
          <select
            className="input"
            value={config.preferredAudio}
            onChange={(event) => void patchConfig({ preferredAudio: event.target.value })}
          >
            {AUDIO_PREFERENCES.map((language) => (
              <option key={language} value={language}>
                {language === ORIGINAL_AUDIO ? "Original (undubbed)" : language}
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
              Size, colour and background for cue text. The same controls sit in the
              player's subtitle menu, so they can be adjusted while watching.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
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

            <div className="cue-segments">
              {(["box", "shadow", "none"] as const).map((option) => (
                <button
                  key={option}
                  data-active={config.subtitleBackground === option}
                  onClick={() => void patchConfig({ subtitleBackground: option })}
                >
                  {option === "box" ? "Box" : option === "shadow" ? "Outline" : "None"}
                </button>
              ))}
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

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-title">Live TV playlists</div>

        {config.playlists.map((playlist) => (
          <div className="playlist-row" key={playlist.url}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="setting-label">{playlist.name}</div>
              <div className="playlist-url">{playlist.url}</div>
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
