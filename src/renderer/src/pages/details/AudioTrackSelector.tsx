import { AudioLines } from "lucide-react";
import type { AudioVariant } from "@shared/types";

interface Props {
  audioTracks: AudioVariant[];
  currentId: string;
  onSelect: (variant: AudioVariant) => void;
}

export function AudioTrackSelector({ audioTracks, currentId, onSelect }: Props) {
  if (audioTracks.length <= 1) return null;

  return (
    <div className="chip-row" style={{ marginBottom: 16, alignItems: "center" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-faint)",
        }}
      >
        <AudioLines size={14} /> Audio
      </span>
      {audioTracks.map((variant) => (
        <button
          key={variant.subjectId}
          className="chip"
          data-active={variant.subjectId === currentId}
          onClick={() => onSelect(variant)}
          title={variant.rawTitle}
        >
          {variant.language}
        </button>
      ))}
    </div>
  );
}
