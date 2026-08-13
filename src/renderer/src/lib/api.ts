import type { Result } from "@shared/types";
import { createCapacitorApi } from "./capacitorApi";

/**
 * Unwraps the IPC Result envelope. Every main-process failure surfaces here as a
 * thrown Error, so callers use one try/catch instead of branching on `ok`.
 */
export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export const api = window.infinityplay ?? createCapacitorApi();
