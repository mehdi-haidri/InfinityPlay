import type { CastRequest } from "@shared/types";
import {
  castPause,
  castPlay,
  castSeek,
  castSetVolume,
  discoverCastDevices,
  getCastSession,
  startCast,
  stopCast,
} from "../cast";
import { handle } from "./handle";

export function registerCastIpc(): void {
  handle("cast:discover", () => discoverCastDevices());
  handle("cast:start", (request: CastRequest) => startCast(request));
  handle("cast:play", () => castPlay());
  handle("cast:pause", () => castPause());
  handle("cast:seek", (seconds: number) => castSeek(seconds));
  handle("cast:volume", (level: number) => castSetVolume(level));
  handle("cast:stop", () => stopCast());
  handle("cast:session", () => getCastSession());
}
