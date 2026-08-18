import { useState, useRef } from "react";
import { Download, Upload, Trash2, Database, QrCode } from "lucide-react";
import { useApp } from "../../store";
import type { AppBackupData } from "../../store/types";
import { QrSyncModal } from "./QrSyncModal";

export function DataManagementSection() {
  const exportUserData = useApp((state) => state.exportUserData);
  const importUserData = useApp((state) => state.importUserData);
  const clearWatchHistory = useApp((state) => state.clearWatchHistory);
  const clearWatchLater = useApp((state) => state.clearWatchLater);
  const notify = useApp((state) => state.notify);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);

  const handleExport = () => {
    try {
      const data = exportUserData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `infinityplay-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      notify({ kind: "info", title: "User data exported", body: "Backup JSON file downloaded." });
    } catch (error) {
      notify({ kind: "error", title: "Export failed", body: error instanceof Error ? error.message : undefined });
    }
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text) as AppBackupData;
        await importUserData(data);
      } catch (err) {
        notify({ kind: "error", title: "Invalid JSON backup file", body: err instanceof Error ? err.message : undefined });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  return (
    <section className="setting-block">
      <h2 className="setting-title">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Database size={18} /> Data & Backup
        </span>
      </h2>

      <div className="setting-row">
        <div>
          <div className="setting-label">Cross-device sync</div>
          <div className="setting-hint">
            Display a QR code or paste a sync code to transfer your watch history, favorites, and settings between your PC, Phone, and TV.
          </div>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => setQrModalOpen(true)}>
          <QrCode size={14} /> Sync via QR
        </button>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Export user data</div>
          <div className="setting-hint">
            Save a backup file containing your favorites, watch history, settings, and watch later queue.
          </div>
        </div>
        <button className="btn btn-sm" onClick={handleExport}>
          <Download size={14} /> Export backup
        </button>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Restore from backup</div>
          <div className="setting-hint">
            Import user data from a previously exported InfinityPlay JSON backup file.
          </div>
        </div>
        <div>
          <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Restore backup
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Clear watch history</div>
          <div className="setting-hint">
            Removes all resume points and completed watches from this device.
          </div>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            if (confirm("Are you sure you want to clear your entire watch history?")) {
              void clearWatchHistory();
            }
          }}
        >
          <Trash2 size={14} /> Clear history
        </button>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Clear Watch later</div>
          <div className="setting-hint">
            Removes all titles currently saved in your Watch later list.
          </div>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            if (confirm("Are you sure you want to clear your Watch later list?")) {
              void clearWatchLater();
            }
          }}
        >
          <Trash2 size={14} /> Clear list
        </button>
      </div>

      <QrSyncModal isOpen={qrModalOpen} onClose={() => setQrModalOpen(false)} />
    </section>
  );
}
