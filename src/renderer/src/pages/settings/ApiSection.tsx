import { Database, Trash2 } from "lucide-react";
import type { AppConfig } from "@shared/types";
import { api, unwrap } from "../../lib/api";

interface Props {
  config: AppConfig;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;
  notify: (toast: { kind: "info" | "error"; title: string; body?: string }) => void;
}

export function ApiSection({ notify }: Props) {
  return (
    <section className="setting-block">
      <h2 className="setting-title">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Database size={18} /> Catalog & Cache
        </span>
      </h2>

      <div className="setting-row">
        <div>
          <div className="setting-label">Catalog Cache</div>
          <div className="setting-hint">
            Clears locally cached search results, catalog listings, and cover art metadata.
          </div>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={async () => {
            try {
              await unwrap(api.catalog.clearCache());
              notify({ kind: "info", title: "Catalog cache cleared" });
            } catch {
              notify({ kind: "error", title: "Could not clear cache" });
            }
          }}
        >
          <Trash2 size={14} /> Clear Cache
        </button>
      </div>
    </section>
  );
}
