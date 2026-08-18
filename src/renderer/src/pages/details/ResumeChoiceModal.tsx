import { useEffect, useRef } from "react";
import { Play, RotateCcw, SlidersHorizontal, X, Clock } from "lucide-react";
import { formatTime } from "../../lib/format";

interface Props {
  isOpen: boolean;
  title: string;
  subtitleLine?: string;
  position: number;
  duration: number;
  onClose: () => void;
  onResume: () => void;
  onRestart: () => void;
  onOpenQualityModal: () => void;
}

export function ResumeChoiceModal({
  isOpen,
  title,
  subtitleLine,
  position,
  duration,
  onClose,
  onResume,
  onRestart,
  onOpenQualityModal,
}: Props) {
  const resumeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        resumeBtnRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const percent = duration > 0 ? Math.round((position / duration) * 100) : 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card resume-choice-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-choice-title"
      >
        <div className="pin-modal-header">
          <div className="pin-modal-title-wrap">
            <div className="pin-modal-icon">
              <Clock size={18} />
            </div>
            <div>
              <h3 id="resume-choice-title" className="pin-modal-title">
                {title}
              </h3>
              <p className="pin-modal-sub">{subtitleLine || "Resume playback"}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="resume-choice-body">
          <div className="resume-choice-preview">
            <div className="resume-choice-time-row">
              <span className="resume-choice-label">Paused at</span>
              <span className="resume-choice-time">
                {formatTime(position)} {duration > 0 && `/ ${formatTime(duration)}`}
              </span>
            </div>
            {duration > 0 && (
              <div className="resume-progress-bar-wrap">
                <div className="resume-progress-bar" style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>

          <div className="resume-choice-actions">
            <button
              ref={resumeBtnRef}
              className="btn btn-primary resume-action-btn"
              onClick={onResume}
              data-focus-initial
            >
              <Play size={17} fill="currentColor" />
              <span>Resume ({formatTime(position)})</span>
            </button>

            <button className="btn resume-action-btn" onClick={onRestart}>
              <RotateCcw size={16} />
              <span>Start from Beginning</span>
            </button>
          </div>

          <div className="resume-choice-footer">
            <button
              className="btn-link resume-quality-link"
              onClick={() => {
                onClose();
                onOpenQualityModal();
              }}
            >
              <SlidersHorizontal size={13} />
              <span>Choose Quality & Subtitles</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
