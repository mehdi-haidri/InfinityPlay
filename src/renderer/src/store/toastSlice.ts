import type { StateCreator } from "zustand";
import type { AppState, ToastSlice } from "./types";

let toastSeq = 0;

export const createToastSlice: StateCreator<AppState, [], [], ToastSlice> = (set, get) => ({
  toasts: [],

  notify: (toast) => {
    const id = ++toastSeq;
    const existing = toast.tag
      ? get().toasts.filter((entry) => entry.tag !== toast.tag)
      : get().toasts;
    set({ toasts: [...existing, { ...toast, id }] });
    if (!toast.sticky) {
      setTimeout(() => get().dismissToast(id), toast.kind === "error" ? 6000 : 3500);
    }
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
});
