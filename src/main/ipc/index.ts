import type { BrowserWindow } from "electron";
import { registerCatalogIpc } from "./catalog";
import { registerTvIpc } from "./tv";
import { registerSettingsIpc } from "./settings";
import { registerDownloadsIpc } from "./downloads";
import { registerMediaIpc } from "./media";
import { registerCastIpc } from "./cast";
import { registerUpdatesIpc } from "./updates";
import { registerSystemIpc } from "./system";

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  registerCatalogIpc();
  registerTvIpc();
  registerSettingsIpc();
  registerDownloadsIpc();
  registerMediaIpc();
  registerCastIpc();
  registerUpdatesIpc();
  registerSystemIpc(getWindow);
}

export * from "./handle";
