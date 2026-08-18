import type { StateCreator } from "zustand";
import type { AppState, NavigationSlice } from "./types";

export const createNavigationSlice: StateCreator<AppState, [], [], NavigationSlice> = (set, get) => ({
  route: { name: "home" },
  history: [],
  future: [],

  navigate: (route, replace = false) => {
    const current = get().route;
    if (JSON.stringify(current) === JSON.stringify(route)) return;
    if (replace) {
      set({ route, future: [] });
      return;
    }
    set({ route, history: [...get().history, current], future: [] });
  },

  goBack: () => {
    const history = get().history;
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    set({
      route: previous,
      history: history.slice(0, -1),
      future: [get().route, ...get().future],
    });
  },

  goForward: () => {
    const future = get().future;
    if (future.length === 0) return;
    set({
      route: future[0],
      future: future.slice(1),
      history: [...get().history, get().route],
    });
  },
});
