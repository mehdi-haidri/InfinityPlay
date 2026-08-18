import {
  SUBTITLE_COLORS,
  SUBTITLE_FONT_FAMILIES,
  SUBTITLE_EDGE_STYLES,
  SUBTITLE_POSITIONS,
  SUBTITLE_LANGUAGES,
  SUBTITLE_OFF,
  type AppConfig,
  type DownloadSubtitlePolicy,
  type SubtitleFontFamily,
  type SubtitleEdgeStyle,
  type SubtitlePosition,
} from "@shared/types";

interface Props {
  config: AppConfig;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;
}

export function SubtitleSettingsSection({ config, patchConfig }: Props) {
  return (
    <section className="setting-block">
      <h2 className="setting-title">Subtitles & Captions</h2>

      <div className="setting-row">
        <div>
          <div className="setting-label">Default subtitle language</div>
          <div className="setting-hint">Automatically selected when playback begins.</div>
        </div>
        <select
          className="select"
          value={config.preferredSubtitle}
          onChange={(e) => void patchConfig({ preferredSubtitle: e.target.value })}
        >
          <option value={SUBTITLE_OFF}>{SUBTITLE_OFF}</option>
          {SUBTITLE_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.name}>
              {lang.name} ({lang.native})
            </option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Download subtitles with media</div>
          <div className="setting-hint">Save subtitle files automatically alongside downloaded movies and series for offline viewing.</div>
        </div>
        <select
          className="select"
          value={config.downloadSubtitles}
          onChange={(e) => void patchConfig({ downloadSubtitles: e.target.value as DownloadSubtitlePolicy })}
        >
          <option value="preferred">Preferred language only (Recommended)</option>
          <option value="all">All available languages</option>
          <option value="none">Do not download subtitles</option>
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Font size</div>
          <div className="setting-hint">Relative to player window size.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="range"
            min={14}
            max={36}
            step={2}
            value={config.subtitleSize}
            onChange={(e) => void patchConfig({ subtitleSize: Number(e.target.value) })}
            style={{ width: 140 }}
          />
          <span style={{ fontSize: 13, minWidth: 36, textAlign: "right" }}>{config.subtitleSize}px</span>
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Text color</div>
          <div className="setting-hint">Color of subtitle text.</div>
        </div>
        <div className="chip-row">
          {SUBTITLE_COLORS.map((col) => (
            <button
              key={col.value}
              className="chip chip-sm"
              data-active={config.subtitleColor === col.value}
              onClick={() => void patchConfig({ subtitleColor: col.value })}
            >
              {col.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Font family</div>
          <div className="setting-hint">Typeface for rendered captions.</div>
        </div>
        <select
          className="select"
          value={config.subtitleFontFamily}
          onChange={(e) => void patchConfig({ subtitleFontFamily: e.target.value as SubtitleFontFamily })}
        >
          {SUBTITLE_FONT_FAMILIES.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Edge outline style</div>
          <div className="setting-hint">Text edge treatment for maximum readability.</div>
        </div>
        <select
          className="select"
          value={config.subtitleEdgeStyle}
          onChange={(e) => void patchConfig({ subtitleEdgeStyle: e.target.value as SubtitleEdgeStyle })}
        >
          {SUBTITLE_EDGE_STYLES.map((edge) => (
            <option key={edge.value} value={edge.value}>
              {edge.label}
            </option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Vertical position</div>
          <div className="setting-hint">Screen placement for subtitle overlay.</div>
        </div>
        <div className="chip-row">
          {SUBTITLE_POSITIONS.map((pos) => (
            <button
              key={pos.value}
              className="chip chip-sm"
              data-active={config.subtitlePosition === pos.value}
              onClick={() => void patchConfig({ subtitlePosition: pos.value as SubtitlePosition })}
            >
              {pos.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
