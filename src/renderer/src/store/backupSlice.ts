import type { StateCreator } from "zustand";
import type { AppState, BackupSlice, AppBackupData } from "./types";

export const createBackupSlice: StateCreator<AppState, [], [], BackupSlice> = (set, get) => ({
  exportUserData: (): AppBackupData => {
    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      config: get().config,
      favorites: get().favorites,
      watchLater: get().watchLater,
      watchHistory: get().watchHistory,
    };
  },

  importUserData: async (data: AppBackupData): Promise<boolean> => {
    try {
      if (!data || typeof data !== "object") {
        throw new Error("Invalid backup data format.");
      }

      if (data.config) {
        await get().patchConfig(data.config);
      }

      if (Array.isArray(data.favorites)) {
        for (const item of data.favorites) {
          const exists = get().favorites.some((f) => f.id === item.id);
          if (!exists) {
            await get().toggleFavorite(item);
          }
        }
        await get().loadFavorites();
      }

      if (Array.isArray(data.watchLater)) {
        for (const item of data.watchLater) {
          const exists = get().watchLater.some((w) => w.id === item.id);
          if (!exists) {
            await get().toggleWatchLater(item);
          }
        }
        await get().loadWatchLater();
      }

      if (Array.isArray(data.watchHistory)) {
        for (const item of data.watchHistory) {
          await get().saveProgress(item);
        }
        await get().loadWatchHistory();
      }

      get().notify({
        kind: "info",
        title: "Backup restored successfully",
        body: `Imported ${data.favorites?.length ?? 0} favorites, ${data.watchLater?.length ?? 0} watch-later items, and ${data.watchHistory?.length ?? 0} history records.`,
      });
      return true;
    } catch (error) {
      get().notify({
        kind: "error",
        title: "Import failed",
        body: error instanceof Error ? error.message : "The backup file could not be read.",
      });
      return false;
    }
  },
});
