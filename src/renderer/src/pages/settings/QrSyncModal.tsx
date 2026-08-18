import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { QrCode, X, Copy, Check, ArrowRightLeft, Upload } from "lucide-react";
import { useApp } from "../../store";
import type { AppBackupData } from "../../store/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function QrSyncModal({ isOpen, onClose }: Props) {
  const exportUserData = useApp((state) => state.exportUserData);
  const importUserData = useApp((state) => state.importUserData);
  const notify = useApp((state) => state.notify);

  const [tab, setTab] = useState<"export" | "import">("export");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [syncCode, setSyncCode] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [importInput, setImportInput] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      try {
        const data = exportUserData();
        // Compact JSON
        const rawJson = JSON.stringify(data);
        const encoded = btoa(unescape(encodeURIComponent(rawJson)));
        setSyncCode(encoded);

        // Generate QR (use raw JSON if small, or sync code)
        QRCode.toDataURL(rawJson.length < 2000 ? rawJson : encoded, {
          width: 260,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        })
          .then((url) => setQrDataUrl(url))
          .catch(() => setQrDataUrl(""));
      } catch {
        setQrDataUrl("");
      }
    }
  }, [isOpen, exportUserData]);

  if (!isOpen) return null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(syncCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notify({ kind: "info", title: "Sync code copied to clipboard" });
    } catch {
      notify({ kind: "error", title: "Failed to copy" });
    }
  };

  const handleApplyImport = async () => {
    if (!importInput.trim()) return;
    setImporting(true);
    try {
      let parsed: AppBackupData;
      const text = importInput.trim();
      if (text.startsWith("{")) {
        parsed = JSON.parse(text) as AppBackupData;
      } else {
        const decoded = decodeURIComponent(escape(atob(text)));
        parsed = JSON.parse(decoded) as AppBackupData;
      }
      await importUserData(parsed);
      notify({ kind: "info", title: "Data synced successfully", body: "Favorites, history, and settings imported." });
      onClose();
    } catch (err) {
      notify({
        kind: "error",
        title: "Invalid sync code",
        body: err instanceof Error ? err.message : "Unable to decode sync data",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card qr-sync-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-sync-title"
      >
        <div className="pin-modal-header">
          <div className="pin-modal-title-wrap">
            <div className="pin-modal-icon">
              <ArrowRightLeft size={18} />
            </div>
            <div>
              <h3 id="qr-sync-title" className="pin-modal-title">
                Cross-Device Sync
              </h3>
              <p className="pin-modal-sub">Transfer settings, favorites & history</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="qr-sync-tabs">
          <button
            className="qr-sync-tab-btn"
            data-active={tab === "export"}
            onClick={() => setTab("export")}
          >
            <QrCode size={14} /> Show QR / Code
          </button>
          <button
            className="qr-sync-tab-btn"
            data-active={tab === "import"}
            onClick={() => setTab("import")}
          >
            <Upload size={14} /> Enter Sync Code
          </button>
        </div>

        <div className="qr-sync-body">
          {tab === "export" ? (
            <div className="qr-sync-export-view">
              <p className="qr-sync-desc">
                Scan this QR code from your phone or copy the sync code to import your data on another device.
              </p>

              {qrDataUrl ? (
                <div className="qr-code-frame">
                  <img src={qrDataUrl} alt="InfinityPlay Sync QR Code" className="qr-code-img" />
                </div>
              ) : (
                <div className="qr-code-placeholder">Generating QR code…</div>
              )}

              <div className="qr-sync-code-bar">
                <input
                  type="text"
                  readOnly
                  value={syncCode.slice(0, 32) + "..."}
                  className="input qr-sync-code-input"
                  aria-label="Sync code"
                />
                <button className="btn btn-sm btn-primary" onClick={handleCopyCode}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? "Copied" : "Copy Code"}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="qr-sync-import-view">
              <p className="qr-sync-desc">
                Paste the sync code or raw JSON exported from your other device to import your favorites and history.
              </p>

              <textarea
                className="input qr-sync-textarea"
                placeholder="Paste sync code or JSON backup here…"
                rows={5}
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
              />

              <button
                className="btn btn-primary"
                style={{ width: "100%", justifyContent: "center" }}
                disabled={importing || !importInput.trim()}
                onClick={handleApplyImport}
              >
                <Upload size={15} />
                <span>{importing ? "Importing…" : "Apply Sync Data"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
