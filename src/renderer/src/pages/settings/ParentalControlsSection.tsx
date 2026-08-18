import { useState } from "react";
import { Lock, KeyRound, ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import type { AppConfig } from "@shared/types";
import { PinModal } from "./PinModal";

interface Props {
  config: AppConfig;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;
  notify: (toast: { kind: "info" | "error"; title: string; body?: string }) => void;
}

export function ParentalControlsSection({ config, patchConfig, notify }: Props) {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    mode: "set" | "verify" | "remove";
  }>({
    isOpen: false,
    mode: "set",
  });

  const savedPin = localStorage.getItem("infinityplay_parental_pin") || "";

  const handleToggleHideAdult = () => {
    if (savedPin) {
      // When PIN lock is active, changing adult filter (activating or deactivating) requires PIN
      setModalState({
        isOpen: true,
        mode: "verify",
      });
    } else {
      void patchConfig({ hideAdultContent: !config.hideAdultContent });
    }
  };

  const handleModalSuccess = (newPinValue?: string) => {
    if (modalState.mode === "set" && newPinValue) {
      localStorage.setItem("infinityplay_parental_pin", newPinValue);
      // Auto-enable adult content protection when setting PIN
      void patchConfig({ hideAdultContent: true });
      notify({ kind: "info", title: "Parental PIN saved", body: "Adult content filter is now active and locked." });
    } else if (modalState.mode === "verify") {
      const nextState = !config.hideAdultContent;
      void patchConfig({ hideAdultContent: nextState });
      notify({
        kind: "info",
        title: nextState ? "Adult content screening enabled" : "Adult content screening disabled",
      });
    } else if (modalState.mode === "remove") {
      localStorage.removeItem("infinityplay_parental_pin");
      notify({ kind: "info", title: "Parental PIN removed" });
    }
  };

  return (
    <section className="setting-block">
      <h2 className="setting-title">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={18} /> Parental Controls
        </span>
      </h2>

      <div className="setting-row">
        <div>
          <div className="setting-label">Screen adult content</div>
          <div className="setting-hint">
            Hides adult and erotic categories and titles across catalog queries and search results.
          </div>
        </div>
        <button
          className="toggle"
          data-on={config.hideAdultContent}
          aria-pressed={config.hideAdultContent}
          onClick={handleToggleHideAdult}
          aria-label="Toggle adult content filter"
        >
          <span className="toggle-handle" />
        </button>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>PIN Lock Protection</span>
            {savedPin ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--accent-soft)",
                  color: "var(--accent-strong)",
                  fontWeight: 600,
                }}
              >
                <Lock size={10} /> Active
              </span>
            ) : null}
          </div>
          <div className="setting-hint">
            {savedPin
              ? "A 4-digit PIN protects adult content filter settings from being altered."
              : "Set a numeric PIN code to prevent unauthorized changes to content filtering."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {savedPin ? (
            <>
              <button
                className="btn btn-sm"
                onClick={() => setModalState({ isOpen: true, mode: "set" })}
              >
                <KeyRound size={14} /> Change PIN
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setModalState({ isOpen: true, mode: "remove" })}
              >
                Remove
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setModalState({ isOpen: true, mode: "set" })}
            >
              <Lock size={14} /> Set PIN
            </button>
          )}
        </div>
      </div>

      <PinModal
        isOpen={modalState.isOpen}
        mode={modalState.mode}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={handleModalSuccess}
        savedPin={savedPin}
        notify={notify}
      />
    </section>
  );
}
