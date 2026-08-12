import type { InfinityPlayApi } from "./index";

declare global {
  interface Window {
    infinityplay: InfinityPlayApi;
  }
}

export {};
