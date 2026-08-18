import type { AppConfig, CatalogItem, WatchHistoryItem } from "@shared/types";
import {
  clearHistory,
  clearWatchLater,
  getConfig,
  getHistory,
  getFavorites,
  getWatchLater,
  recordHistory,
  removeHistory,
  toggleFavorite,
  toggleWatchLater,
  updateConfig,
} from "../store";
import { handle } from "./handle";

export function registerSettingsIpc(): void {
  handle("config:get", () => getConfig());
  handle("config:update", (patch: Partial<AppConfig>) => updateConfig(patch));

  handle("history:list", () => getHistory());
  handle("history:record", (item: WatchHistoryItem) => recordHistory(item));
  handle("history:remove", (subjectId: string) => removeHistory(subjectId));
  handle("history:clear", () => clearHistory());
  handle("favorites:list", () => getFavorites());
  handle("favorites:toggle", (item: CatalogItem) => toggleFavorite(item));
  handle("watchLater:list", () => getWatchLater());
  handle("watchLater:toggle", (item: CatalogItem) => toggleWatchLater(item));
  handle("watchLater:clear", () => clearWatchLater());
}
