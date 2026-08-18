import type { AppConfig } from "@shared/types";

const THEMES: { value: AppConfig["theme"]; label: string }[] = [
  { value: "midnight", label: "Midnight (rose accent)" },
  { value: "noir", label: "Noir (monochrome)" },
  { value: "ember", label: "Ember (amber accent)" },
  { value: "ocean", label: "Ocean (teal accent)" },
  { value: "forest", label: "Forest (green accent)" },
  { value: "plum", label: "Plum (violet accent)" },
];

interface Props {
  config: AppConfig;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;
}

export function AppearanceSection({ config, patchConfig }: Props) {
  return (
    <section className="setting-block">
      <h2 className="setting-title">Appearance</h2>
      <div className="setting-row">
        <div>
          <div className="setting-label">Theme</div>
          <div className="setting-hint">Color accents for buttons, focus rings, and badges.</div>
        </div>
        <select
          className="select"
          value={config.theme}
          onChange={(e) => void patchConfig({ theme: e.target.value as AppConfig["theme"] })}
        >
          {THEMES.map((theme) => (
            <option key={theme.value} value={theme.value}>
              {theme.label}
            </option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Reduce motion</div>
          <div className="setting-hint">Disables ambient glows, transitions, and animations.</div>
        </div>
        <button
          className="toggle"
          data-on={config.reducedMotion}
          aria-pressed={config.reducedMotion}
          onClick={() => void patchConfig({ reducedMotion: !config.reducedMotion })}
        >
          <span className="toggle-handle" />
        </button>
      </div>
    </section>
  );
}
