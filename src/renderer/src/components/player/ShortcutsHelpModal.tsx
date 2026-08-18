import { X, Keyboard } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: "Space / K", description: "Play / Pause playback" },
  { key: "← / J", description: "Seek backward 10 seconds" },
  { key: "→ / L", description: "Seek forward 10 seconds" },
  { key: "↑ / ↓", description: "Increase / decrease volume" },
  { key: "M", description: "Mute / unmute audio" },
  { key: "F", description: "Toggle fullscreen" },
  { key: "0 – 9", description: "Jump to 0% – 90% of video" },
  { key: "Home / End", description: "Jump to start / near end" },
  { key: "Esc", description: "Exit fullscreen or close player" },
  { key: "?", description: "Show / hide keyboard shortcuts" },
];

export function ShortcutsHelpModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.88)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0c0e15",
          border: "1px solid var(--border-strong, #2a3040)",
          borderRadius: "var(--radius-lg, 16px)",
          padding: "24px 28px",
          maxWidth: 500,
          width: "92%",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
            paddingBottom: 12,
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 700, color: "#ffffff" }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: "var(--accent-soft, rgba(168, 85, 247, 0.2))",
                color: "var(--accent-strong, #c084fc)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Keyboard size={19} />
            </div>
            <span>Keyboard Shortcuts</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close shortcuts">
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              <span style={{ color: "var(--text, #eef1f7)", fontSize: 13, fontWeight: 500 }}>
                {shortcut.description}
              </span>
              <kbd
                style={{
                  background: "#161922",
                  border: "1px solid #32384a",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "monospace",
                  color: "#ffffff",
                  boxShadow: "0 2px 5px rgba(0, 0, 0, 0.5)",
                }}
              >
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
