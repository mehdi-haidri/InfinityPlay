export type DeviceProfile = "phone" | "tablet" | "tv" | "desktop";
export type InputMode = "touch" | "remote" | "pointer";

const TV_MARKERS = /InfinityPlay-TV|Android TV|GoogleTV|SMART-TV|BRAVIA|AFT\w*/i;

export function detectDeviceProfile(): DeviceProfile {
  if (TV_MARKERS.test(navigator.userAgent)) return "tv";

  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const nativeAndroid = /Android/i.test(navigator.userAgent) && Boolean((window as any).Capacitor?.isNativePlatform?.());
  const shortestSide = Math.min(window.innerWidth, window.innerHeight);

  // Width is authoritative for the phone shell. Pointer media queries can report
  // `fine` in emulators, desktop touch devices, and automated checks; leaving those in
  // the desktop shell squeezes content beside the sidebar at real phone widths.
  if (shortestSide < 600) return "phone";
  if ((nativeAndroid || coarse) && shortestSide < 1100) return "tablet";
  return "desktop";
}

export function applyDeviceProfile(): DeviceProfile {
  const profile = detectDeviceProfile();
  const root = document.documentElement;
  root.dataset.device = profile;
  root.dataset.input = profile === "tv" ? "remote" : window.matchMedia("(pointer: coarse)").matches ? "touch" : "pointer";
  return profile;
}

const FOCUSABLE = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visibleFocusable(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => {
    if (node.closest("[hidden], [aria-hidden='true']")) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  });
}

function focusSignature(node: HTMLElement): string {
  return node.dataset.focusKey ?? node.getAttribute("aria-label") ?? node.getAttribute("title") ?? node.textContent?.trim().slice(0, 80) ?? "";
}

function directionalCandidate(current: HTMLElement, direction: string): HTMLElement | undefined {
  const origin = current.getBoundingClientRect();
  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;
  let best: { node: HTMLElement; score: number } | undefined;

  for (const node of visibleFocusable()) {
    if (node === current || node.closest(".player-root")) continue;
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - ox;
    const dy = y - oy;
    const valid =
      (direction === "ArrowRight" && dx > 8) ||
      (direction === "ArrowLeft" && dx < -8) ||
      (direction === "ArrowDown" && dy > 8) ||
      (direction === "ArrowUp" && dy < -8);
    if (!valid) continue;

    const primary = direction === "ArrowLeft" || direction === "ArrowRight" ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === "ArrowLeft" || direction === "ArrowRight" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2.35;
    if (!best || score < best.score) best = { node, score };
  }
  return best?.node;
}

export function installTvSpatialNavigation(getRoute: () => string): () => void {
  const remembered = new Map<string, string>();

  const onFocus = (event: FocusEvent) => {
    if (document.documentElement.dataset.device !== "tv") return;
    const node = event.target as HTMLElement;
    const signature = focusSignature(node);
    if (signature) remembered.set(getRoute(), signature);
    node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  };

  const onKey = (event: KeyboardEvent) => {
    if (document.documentElement.dataset.device !== "tv" || document.querySelector(".player-root")) return;
    document.documentElement.dataset.input = "remote";
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const current = document.activeElement as HTMLElement | null;
    if (!current || !current.matches(FOCUSABLE)) return;
    const next = directionalCandidate(current, event.key);
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
  };

  const focusRoute = () => {
    if (document.documentElement.dataset.device !== "tv") return;
    window.requestAnimationFrame(() => {
      const nodes = visibleFocusable().filter((node) => !node.closest(".player-root"));
      const wanted = remembered.get(getRoute());
      const target =
        nodes.find((node) => wanted && focusSignature(node) === wanted) ??
        nodes.find((node) => node.hasAttribute("data-focus-initial")) ??
        nodes.find((node) => node.getAttribute("aria-current") === "page") ??
        nodes[0];
      target?.focus({ preventScroll: true });
    });
  };

  document.addEventListener("focusin", onFocus);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("infinityplay:focus-route", focusRoute);
  return () => {
    document.removeEventListener("focusin", onFocus);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("infinityplay:focus-route", focusRoute);
  };
}
