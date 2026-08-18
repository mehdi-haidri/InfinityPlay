import type { StateCreator } from "zustand";
import { api, unwrap } from "../lib/api";
import type { AppState, HistorySlice } from "./types";

export const createHistorySlice: StateCreator<AppState, [], [], HistorySlice> = (set, get) => ({
  watchHistory: [],

  loadWatchHistory: async () => {
    try {
      set({ watchHistory: await unwrap(api.history.list()) });
    } catch {
      set({ watchHistory: [] });
    }
  },

  saveProgress: async (entry) => {
    try {
      const known = get().watchHistory.find((item) => item.subjectId === entry.subjectId);
      const merged = {
        ...entry,
        year: entry.year || known?.year || "",
        posterUrl: entry.posterUrl ?? known?.posterUrl ?? null,
      };
      set({ watchHistory: await unwrap(api.history.record(merged)) });
    } catch {
      // Ignored
    }
  },

  forgetTitle: async (subjectId) => {
    const removedEntries = get().watchHistory.filter((item) => item.subjectId === subjectId);
    try {
      set({ watchHistory: await unwrap(api.history.remove(subjectId)) });
      if (removedEntries.length > 0) {
        get().notify({
          kind: "info",
          title: "Removed from history",
          actions: [
            {
              label: "Undo",
              onClick: () => {
                for (const entry of removedEntries) {
                  void get().saveProgress(entry);
                }
              },
            },
          ],
        });
      }
    } catch {
      /* ignored */
    }
  },

  clearWatchHistory: async () => {
    const previous = get().watchHistory;
    try {
      set({ watchHistory: await unwrap(api.history.clear()) });
      if (previous.length > 0) {
        get().notify({
          kind: "info",
          title: "Watch history cleared",
          actions: [
            {
              label: "Undo",
              onClick: () => {
                for (const entry of previous) {
                  void get().saveProgress(entry);
                }
              },
            },
          ],
        });
      }
    } catch {
      /* ignored */
    }
  },
});
