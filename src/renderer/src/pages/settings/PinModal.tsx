import { useState, useRef, useEffect } from "react";
import { Lock, X, KeyRound, ShieldAlert, Check } from "lucide-react";

interface Props {
  isOpen: boolean;
  mode: "set" | "verify" | "remove";
  title?: string;
  description?: string;
  onClose: () => void;
  onSuccess: (pin?: string) => void;
  savedPin?: string;
  notify: (toast: { kind: "info" | "error"; title: string; body?: string }) => void;
}

export function PinModal({
  isOpen,
  mode,
  title: customTitle,
  description: customDescription,
  onClose,
  onSuccess,
  savedPin,
  notify,
}: Props) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPin("");
      setConfirmPin("");
      setError("");
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "set") {
      if (pin.length < 4) {
        setError("PIN must be at least 4 digits");
        return;
      }
      if (pin !== confirmPin) {
        setError("PINs do not match");
        return;
      }
      onSuccess(pin);
      onClose();
    } else {
      // verify or remove
      if (pin === savedPin) {
        onSuccess();
        onClose();
      } else {
        setError("Incorrect PIN. Please try again.");
      }
    }
  };

  const title =
    customTitle ??
    (mode === "set"
      ? savedPin
        ? "Change Parental PIN"
        : "Set Parental PIN"
      : mode === "remove"
        ? "Remove Parental PIN"
        : "Enter Parental PIN");

  const description =
    customDescription ??
    (mode === "set"
      ? "Create a 4-8 digit numeric code to restrict access to adult content filters."
      : mode === "remove"
        ? "Enter your current PIN to remove parental lock protection."
        : "Enter your PIN to change mature content settings.");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card pin-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-modal-title"
      >
        <div className="pin-modal-header">
          <div className="pin-modal-title-wrap">
            <div className="pin-modal-icon">
              <Lock size={18} />
            </div>
            <div>
              <h3 id="pin-modal-title" className="pin-modal-title">
                {title}
              </h3>
              <p className="pin-modal-sub">{description}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="pin-modal-body">
          <div className="pin-input-group">
            <label className="pin-input-label">
              {mode === "set" ? "New 4-8 Digit PIN" : "Current PIN"}
            </label>
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              placeholder="••••"
              value={pin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "");
                setPin(val);
                setError("");
              }}
              className="input pin-number-input"
              autoComplete="off"
            />
          </div>

          {mode === "set" && (
            <div className="pin-input-group">
              <label className="pin-input-label">Confirm New PIN</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                placeholder="••••"
                value={confirmPin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setConfirmPin(val);
                  setError("");
                }}
                className="input pin-number-input"
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <div className="pin-error-text" role="alert">
              <ShieldAlert size={14} /> {error}
            </div>
          )}

          <div className="pin-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pin.length < 4}>
              <Check size={16} />
              {mode === "set" ? "Save PIN" : mode === "remove" ? "Remove Lock" : "Unlock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
