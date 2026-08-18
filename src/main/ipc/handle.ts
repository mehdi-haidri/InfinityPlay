import { ipcMain } from "electron";
import type { Result } from "@shared/types";

/** Wraps a handler so the renderer always receives a Result instead of a rejected promise. */
export function handle<A extends unknown[], R>(
  channel: string,
  handler: (...args: A) => Promise<R> | R,
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...(args as A)) } satisfies Result<R>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message } satisfies Result<R>;
    }
  });
}
