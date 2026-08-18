import type { DownloadRequest, SeasonDownloadRequest } from "@shared/types";
import {
  cancelDownload,
  clearFinishedDownloads,
  clearSeasonQueue,
  listDownloads,
  openDownload,
  pauseDownload,
  pendingSeasonCount,
  removeDownload,
  resumeDownload,
  revealDownload,
  startDownload,
  startSeasonDownload,
} from "../downloads";
import { handle } from "./handle";

export function registerDownloadsIpc(): void {
  handle("download:start", (request: DownloadRequest) => startDownload(request));
  handle("download:startSeason", (request: SeasonDownloadRequest) =>
    startSeasonDownload(request),
  );
  handle("download:clearQueue", () => clearSeasonQueue());
  handle("download:queueSize", () => pendingSeasonCount());
  handle("download:list", () => listDownloads());
  handle("download:pause", (id: string) => pauseDownload(id));
  handle("download:resume", (id: string) => resumeDownload(id));
  handle("download:cancel", (id: string) => cancelDownload(id));
  handle("download:remove", (id: string, deleteFile: boolean) =>
    removeDownload(id, Boolean(deleteFile)),
  );
  handle("download:clearFinished", () => clearFinishedDownloads());
  handle("download:open", (id: string) => openDownload(id));
  handle("download:reveal", (id: string) => revealDownload(id));
}
