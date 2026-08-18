import type { StateCreator } from "zustand";
import { api, unwrap } from "../lib/api";
import type { AppState, FavoritesSlice } from "./types";

export const createFavoritesSlice: StateCreator<AppState, [], [], FavoritesSlice> = (set, get) => ({
  favorites: [],

  loadFavorites: async () => {
    try {
      set({ favorites: await unwrap(api.favorites.list()) });
    } catch {
      set({ favorites: [] });
    }
  },

  watchLater: [],

  loadWatchLater: async () => {
    try {
      set({ watchLater: await unwrap(api.watchLater.list()) });
    } catch {
      set({ watchLater: [] });
    }
  },

  toggleWatchLater: async (item) => {
    const previous = get().watchLater;
    const exists = previous.some((entry) => entry.id === item.id);
    set({
      watchLater: exists
        ? previous.filter((entry) => entry.id !== item.id)
        : [{ ...item, addedAt: Date.now() }, ...previous],
    });
    try {
      set({ watchLater: await unwrap(api.watchLater.toggle(item)) });
      if (exists) {
        get().notify({
          kind: "info",
          title: `Removed "${item.title}" from Watch later`,
          actions: [
            {
              label: "Undo",
              onClick: () => {
                void get().toggleWatchLater(item);
              },
            },
          ],
        });
      }
    } catch {
      set({ watchLater: previous });
      get().notify({ kind: "error", title: "Could not update Watch later" });
    }
  },

  clearWatchLater: async () => {
    const previous = get().watchLater;
    set({ watchLater: [] });
    try {
      set({ watchLater: await unwrap(api.watchLater.clear()) });
    } catch {
      set({ watchLater: previous });
      get().notify({ kind: "error", title: "Could not clear Watch later" });
    }
  },

  toggleFavorite: async (item) => {
    const previous = get().favorites;
    const exists = previous.some((entry) => entry.id === item.id);
    set({
      favorites: exists
        ? previous.filter((entry) => entry.id !== item.id)
        : [{ ...item, addedAt: Date.now() }, ...previous],
    });
    try {
      set({ favorites: await unwrap(api.favorites.toggle(item)) });
      if (exists) {
        get().notify({
          kind: "info",
          title: `Removed "${item.title}" from favorites`,
          actions: [
            {
              label: "Undo",
              onClick: () => {
                void get().toggleFavorite(item);
              },
            },
          ],
        });
      }
    } catch {
      set({ favorites: previous });
      get().notify({ kind: "error", title: "Could not update favorites" });
    }
  },
});
