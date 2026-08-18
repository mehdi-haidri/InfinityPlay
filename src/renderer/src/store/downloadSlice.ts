import type { StateCreator } from "zustand";
import { api, unwrap } from "../lib/api";
import type { AppState, DownloadSlice } from "./types";

let toastSeq = 0;

export const createDownloadSlice: StateCreator<AppState, [], [], DownloadSlice> = (set, get) => ({
  downloads: [],

  loadDownloads: async () => {
    try {
      set({ downloads: await unwrap(api.downloads.list()) });
    } catch {
      set({ downloads: [] });
    }
  },

  watchDownloads: () =>
    api.downloads.onProgress((record) => {
      const downloads = get().downloads.some((entry) => entry.id === record.id)
        ? get().downloads.map((entry) => (entry.id === record.id ? record : entry))
        : [record, ...get().downloads];
      set({ downloads });

      const toast = get().toasts.find((entry) => entry.downloadId === record.id);
      if (!toast) return;

      if (record.state === "completed") {
        set({
          toasts: get().toasts.map((entry) =>
            entry.id === toast.id
              ? { ...entry, kind: "info", title: "Download complete", body: record.filename, sticky: false }
              : entry,
          ),
        });
        setTimeout(() => get().dismissToast(toast.id), 6000);
        return;
      }

      if (record.state === "cancelled" || record.state === "interrupted") {
        set({
          toasts: get().toasts.map((entry) =>
            entry.id === toast.id
              ? {
                  ...entry,
                  kind: "error",
                  title: record.state === "cancelled" ? "Download cancelled" : "Download interrupted",
                  body: record.failureReason ?? record.filename,
                  sticky: false,
                }
              : entry,
          ),
        });
        setTimeout(() => get().dismissToast(toast.id), 6000);
      }
    }),

  beginDownload: async (request) => {
    try {
      const record = await unwrap(api.downloads.start(request));
      set({ downloads: [record, ...get().downloads.filter((entry) => entry.id !== record.id)] });
      const id = ++toastSeq;
      set({
        toasts: [
          ...get().toasts,
          {
            id,
            kind: "progress",
            title: "Download started",
            body: record.filename,
            downloadId: record.id,
            sticky: true,
          },
        ],
      });
    } catch (error) {
      get().notify({
        kind: "error",
        title: "Download failed to start",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  },

  removeDownload: async (id, deleteFile) => {
    try {
      set({ downloads: await unwrap(api.downloads.remove(id, deleteFile)) });
    } catch (error) {
      get().notify({
        kind: "error",
        title: "Could not remove the download",
        body: error instanceof Error ? error.message : undefined,
      });
    }
  },

  cancelDownload: async (id) => {
    try {
      await unwrap(api.downloads.cancel(id));
      await get().loadDownloads();
    } catch {
      /* the progress stream will correct the state */
    }
  },
});
