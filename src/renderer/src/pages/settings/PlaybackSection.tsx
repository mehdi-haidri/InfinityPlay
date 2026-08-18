import { RotateCw } from "lucide-react";
import { AUDIO_PREFERENCES, CATALOG_COUNTRIES, type AppConfig } from "@shared/types";
import { api, unwrap } from "../../lib/api";

const RESOLUTIONS = [0, 2160, 1080, 720, 480, 360];

interface Props {
  config: AppConfig;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;
  restartNeeded: boolean;
  setRestartNeeded: (needed: boolean) => void;
}

export function PlaybackSection({ config, patchConfig, restartNeeded, setRestartNeeded }: Props) {
  return (
    <section className="setting-block">
      <h2 className="setting-title">Playback & Catalog</h2>

      <div className="setting-row">
        <div>
          <div className="setting-label">Default quality</div>
          <div className="setting-hint">Used for initial playback and download buttons.</div>
        </div>
        <select
          className="select"
          value={config.defaultResolution}
          onChange={(e) => void patchConfig({ defaultResolution: Number(e.target.value) })}
        >
          {RESOLUTIONS.map((res) => (
            <option key={res} value={res}>
              {res === 0 ? "Automatic (highest available)" : `${res}p`}
            </option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Preferred audio language</div>
          <div className="setting-hint">Chooses this dub automatically whenever a title offers it.</div>
        </div>
        <select
          className="select"
          value={config.preferredAudio}
          onChange={(e) => void patchConfig({ preferredAudio: e.target.value })}
        >
          {AUDIO_PREFERENCES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Catalog region</div>
          <div className="setting-hint">Shows trending movies and series popular in this region.</div>
        </div>
        <select
          className="select"
          value={config.catalogCountry}
          onChange={(e) => void patchConfig({ catalogCountry: e.target.value })}
        >
          {CATALOG_COUNTRIES.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Hardware video acceleration</div>
          <div className="setting-hint">Uses your GPU for video decoding. Requires restart to apply.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {restartNeeded && (
            <button className="btn btn-sm btn-primary" onClick={() => void unwrap(api.system.restart())}>
              <RotateCw size={14} /> Restart now
            </button>
          )}
          <button
            className="toggle"
            data-on={config.hardwareAcceleration}
            aria-pressed={config.hardwareAcceleration}
            onClick={() => {
              void patchConfig({ hardwareAcceleration: !config.hardwareAcceleration });
              setRestartNeeded(true);
            }}
          >
            <span className="toggle-handle" />
          </button>
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Discord Rich Presence</div>
          <div className="setting-hint">
            Show what you are currently watching on your Discord profile status.
          </div>
        </div>
        <button
          className="toggle"
          data-on={config.discordRpc !== false}
          aria-pressed={config.discordRpc !== false}
          onClick={() => {
            void patchConfig({ discordRpc: config.discordRpc === false ? true : false });
          }}
        >
          <span className="toggle-handle" />
        </button>
      </div>
    </section>
  );
}
