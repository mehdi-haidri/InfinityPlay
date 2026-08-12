/**
 * Config and watch-history persistence under `app.getPath("userData")`, written
 * atomically so a crash mid-write cannot corrupt either file.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import {
  DEFAULT_CONFIG,
  type AppConfig,
  type DownloadRecord,
  type WatchHistoryItem,
} from "@shared/types";

const HISTORY_LIMIT = 200;

class JsonFile<T> {
  private cache: T | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filename: string,
    private readonly fallback: T,
    private readonly revive: (raw: unknown) => T,
  ) {}

  private get filePath(): string {
    return path.join(app.getPath("userData"), this.filename);
  }

  read(): T {
    if (this.cache !== null) return this.cache;
    try {
      this.cache = this.revive(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch {
      this.cache = this.fallback;
    }
    return this.cache;
  }

  write(value: T): T {
    this.cache = value;
    const target = this.filePath;
    const temp = `${target}.${process.pid}.tmp`;
    // Serialize writes so two rapid updates cannot interleave rename and unlink.
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
        await fsp.rename(temp, target);
      } catch {
        await fsp.rm(temp, { force: true }).catch(() => undefined);
      }
    });
    return value;
  }
}

const configFile = new JsonFile<AppConfig>("config.json", DEFAULT_CONFIG, (raw) => ({
  ...DEFAULT_CONFIG,
  ...(raw as Partial<AppConfig>),
  playlists: Array.isArray((raw as AppConfig)?.playlists)
    ? (raw as AppConfig).playlists
    : DEFAULT_CONFIG.playlists,
}));

const historyFile = new JsonFile<WatchHistoryItem[]>("history.json", [], (raw) =>
  Array.isArray(raw) ? (raw as WatchHistoryItem[]) : [],
);

export const getConfig = (): AppConfig => configFile.read();

export const updateConfig = (patch: Partial<AppConfig>): AppConfig =>
  configFile.write({ ...configFile.read(), ...patch });

export const getHistory = (): WatchHistoryItem[] =>
  [...historyFile.read()].sort((a, b) => b.timestamp - a.timestamp);

/** One entry per subject+season+episode; re-watching updates the position in place. */
export function recordHistory(item: WatchHistoryItem): WatchHistoryItem[] {
  const key = (candidate: WatchHistoryItem) =>
    `${candidate.subjectId}:${candidate.season}:${candidate.episode}`;

  const entries = historyFile.read().filter((candidate) => key(candidate) !== key(item));
  entries.unshift({ ...item, timestamp: Date.now() });
  return historyFile.write(entries.slice(0, HISTORY_LIMIT));
}

export const removeHistory = (subjectId: string): WatchHistoryItem[] =>
  historyFile.write(historyFile.read().filter((entry) => entry.subjectId !== subjectId));

export const clearHistory = (): WatchHistoryItem[] => historyFile.write([]);

const downloadsFile = new JsonFile<DownloadRecord[]>("downloads.json", [], (raw) =>
  Array.isArray(raw) ? (raw as DownloadRecord[]) : [],
);

export const getDownloadRecords = (): DownloadRecord[] => downloadsFile.read();

export const saveDownloadRecords = (records: DownloadRecord[]): DownloadRecord[] =>
  downloadsFile.write(records);
