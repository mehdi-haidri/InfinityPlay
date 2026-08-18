import type { StateCreator } from "zustand";
import { DEFAULT_CONFIG } from "@shared/types";
import { api, unwrap } from "../lib/api";
import type { AppState, ConfigSlice } from "./types";

export const createConfigSlice: StateCreator<AppState, [], [], ConfigSlice> = (set, get) => ({
  config: DEFAULT_CONFIG,
  ffmpeg: true,

  loadCapabilities: async () => {
    try {
      const probe = document.createElement("video");
      const playable = (type: string) => probe.canPlayType(type) !== "";
      const decodable: string[] = [];
      if (
        playable('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
        playable('video/mp4; codecs="hev1.1.6.L93.B0"')
      ) {
        decodable.push("hevc", "h265");
      }
      if (playable('video/mp4; codecs="av01.0.05M.08"')) decodable.push("av1");
      if (playable('video/webm; codecs="vp9"')) decodable.push("vp9");
      await unwrap(api.media.reportDecodable(decodable));
    } catch {
      // Main keeps conservative defaults
    }

    try {
      const info = await unwrap(api.app.info());
      set({ ffmpeg: info.ffmpeg });
    } catch {
      // Leave optimistic default
    }
  },

  loadConfig: async () => {
    try {
      const config = await unwrap(api.config.get());
      set({ config });
      document.documentElement.dataset.theme = config.theme;
      document.documentElement.dataset.reducedMotion = String(config.reducedMotion);
    } catch {
      // Fall back to built-in defaults
    }
  },

  patchConfig: async (patch) => {
    const next = { ...get().config, ...patch };
    set({ config: next });
    if (patch.theme) document.documentElement.dataset.theme = patch.theme;
    if (patch.reducedMotion !== undefined) {
      document.documentElement.dataset.reducedMotion = String(patch.reducedMotion);
    }
    try {
      set({ config: await unwrap(api.config.update(patch)) });
    } catch (error) {
      get().notify({
        kind: "error",
        title: "Could not save settings",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  },
});
