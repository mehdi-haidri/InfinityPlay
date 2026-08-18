import type { StateCreator } from "zustand";
import type { AppState, PlayerSlice } from "./types";

export const createPlayerSlice: StateCreator<AppState, [], [], PlayerSlice> = (set) => ({
  player: null,
  openPlayer: (request) => set({ player: request }),
  closePlayer: () => set({ player: null }),

  channels: [],
  setChannels: (channels) => set({ channels }),
});
