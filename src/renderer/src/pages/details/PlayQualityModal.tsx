import { useState, useEffect, useRef } from "react";
import { Play, X, Sliders, Check, Film, Tv, Captions, Volume2 } from "lucide-react";
import type { Release, SubtitleOption, AudioVariant } from "@shared/types";
import { qualityLabel, formatBytes, formatTime } from "../../lib/format";

interface Props {
  isOpen: boolean;
  title: string;
  subtitleLine?: string;
  releases: Release[];
  subtitles: SubtitleOption[];
  audioTracks: AudioVariant[];
  currentAudioId: string;
  selectedSubtitle: string;
  currentProgress?: { position: number; duration: number };
  defaultRelease: Release | null;
  onClose: () => void;
  onPlay: (release: Release, subtitle?: SubtitleOption | null) => void;
  onSwitchAudio: (targetId: string) => void;
  onSelectSubtitle: (subName: string) => void;
}

export function PlayQualityModal({
  isOpen,
  title,
  subtitleLine,
  releases,
  subtitles,
  audioTracks,
  currentAudioId,
  selectedSubtitle,
  currentProgress,
  defaultRelease,
  onClose,
  onPlay,
  onSwitchAudio,
  onSelectSubtitle,
}: Props) {
  const [chosenRelease, setChosenRelease] = useState<Release | null>(
    () => defaultRelease || releases[0] || null,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setChosenRelease(defaultRelease || releases[0] || null);
      // Autofocus the selected quality card or initial interactive element for TV remote D-Pad navigation
      setTimeout(() => {
        const activeBtn = containerRef.current?.querySelector<HTMLButtonElement>(".quality-option-card.selected")
          || containerRef.current?.querySelector<HTMLButtonElement>(".quality-option-card")
          || containerRef.current?.querySelector<HTMLButtonElement>("button");
        activeBtn?.focus();
      }, 60);
    }
  }, [isOpen, defaultRelease]);

  if (!isOpen) return null;

  const activeRelease = chosenRelease || defaultRelease || releases[0];

  const handleLaunch = (releaseToUse?: Release) => {
    const rel = releaseToUse || activeRelease;
    if (!rel) return;

    const subOption =
      selectedSubtitle === "Off"
        ? null
        : subtitles.find(
            (s) =>
              s.name.toLowerCase() === selectedSubtitle.toLowerCase() ||
              s.lang.toLowerCase() === selectedSubtitle.toLowerCase() ||
              s.nativeName.toLowerCase() === selectedSubtitle.toLowerCase(),
          ) || null;

    onPlay(rel, subOption);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        className="modal-card play-quality-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-modal-title"
      >
        <div className="pin-modal-header">
          <div className="pin-modal-title-wrap">
            <div className="pin-modal-icon">
              <Film size={18} />
            </div>
            <div>
              <h3 id="play-modal-title" className="pin-modal-title">
                {title}
              </h3>
              {subtitleLine && <p className="pin-modal-sub">{subtitleLine}</p>}
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="play-quality-modal-body">
          {/* Quality selection */}
          <div className="play-modal-section">
            <div className="play-modal-section-title">
              <Sliders size={14} /> Available Qualities
            </div>
            <div className="quality-options-grid">
              {releases.map((rel) => {
                const isSelected = activeRelease?.url === rel.url && activeRelease?.resolution === rel.resolution;
                return (
                  <button
                    key={`${rel.url}-${rel.resolution}`}
                    type="button"
                    className={`quality-option-card ${isSelected ? "selected" : ""}`}
                    onClick={() => setChosenRelease(rel)}
                    onDoubleClick={() => handleLaunch(rel)}
                  >
                    <div className="quality-card-head">
                      <span className="quality-card-badge">{qualityLabel(rel.resolution)}</span>
                      {isSelected && <Check size={14} className="quality-check-icon" />}
                    </div>
                    <div className="quality-card-meta">
                      <span>{rel.kind === "dash" ? "Adaptive stream" : "Direct stream"}</span>
                      {rel.sizeBytes ? <span> · {formatBytes(rel.sizeBytes)}</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audio Language Selection */}
          {audioTracks.length > 1 && (
            <div className="play-modal-section">
              <div className="play-modal-section-title">
                <Volume2 size={14} /> Audio Track
              </div>
              <div className="chip-row">
                {audioTracks.map((variant) => (
                  <button
                    key={variant.subjectId}
                    type="button"
                    className="chip chip-sm"
                    data-active={variant.subjectId === currentAudioId}
                    onClick={() => onSwitchAudio(variant.subjectId)}
                  >
                    {variant.language}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Subtitles Selection */}
          <div className="play-modal-section">
            <div className="play-modal-section-title">
              <Captions size={14} /> Subtitles & Captions
            </div>
            <select
              className="select"
              value={selectedSubtitle}
              onChange={(e) => onSelectSubtitle(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="Off">Subtitles Off</option>
              {subtitles.map((sub) => (
                <option key={sub.url} value={sub.name}>
                  {sub.name} {sub.nativeName && sub.nativeName !== sub.name ? `(${sub.nativeName})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Resume notification if applicable */}
          {currentProgress && currentProgress.position > 30 && (
            <div className="resume-progress-hint">
              <span>Resuming from <strong>{formatTime(currentProgress.position)}</strong></span>
            </div>
          )}

          {/* Footer action */}
          <div className="pin-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!activeRelease}
              onClick={() => handleLaunch()}
            >
              <Play size={16} fill="currentColor" /> Play {activeRelease ? qualityLabel(activeRelease.resolution) : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
