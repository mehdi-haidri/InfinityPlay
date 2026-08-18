import { create } from "zustand";
import type { CatalogItem, WatchHistoryItem } from "@shared/types";
import type { AppState } from "./types";
import { createNavigationSlice } from "./navigationSlice";
import { createConfigSlice } from "./configSlice";
import { createHistorySlice } from "./historySlice";
import { createFavoritesSlice } from "./favoritesSlice";
import { createPlayerSlice } from "./playerSlice";
import { createDownloadSlice } from "./downloadSlice";
import { createToastSlice } from "./toastSlice";
import { createBackupSlice } from "./backupSlice";

export const useApp = create<AppState>((...args) => ({
  ...createNavigationSlice(...args),
  ...createConfigSlice(...args),
  ...createHistorySlice(...args),
  ...createFavoritesSlice(...args),
  ...createPlayerSlice(...args),
  ...createDownloadSlice(...args),
  ...createToastSlice(...args),
  ...createBackupSlice(...args),
}));

/** Resume point for a title, or `undefined` when it was never started. */
export function findProgress(
  history: WatchHistoryItem[],
  subjectId: string,
  season = 0,
  episode = 0,
): WatchHistoryItem | undefined {
  return history.find(
    (entry) =>
      entry.subjectId === subjectId && entry.season === season && entry.episode === episode,
  );
}

export const toHistoryEntry = (
  item: CatalogItem,
  season: number,
  episode: number,
  position: number,
  duration: number,
): WatchHistoryItem => ({
  provider: "moviebox",
  subjectId: item.id,
  title: item.title,
  posterUrl: item.posterUrl,
  mediaType: item.mediaType,
  year: item.year,
  season,
  episode,
  position,
  duration,
  timestamp: Date.now(),
});

export * from "./types";
