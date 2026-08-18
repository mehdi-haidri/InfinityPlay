import {
  checkForUpdates,
  declineUpdate,
  getUpdateStatus,
  installUpdate,
  pauseUpdateDownload,
  startUpdateDownload,
} from "../updater";
import { handle } from "./handle";

export function registerUpdatesIpc(): void {
  handle("update:status", () => getUpdateStatus());
  handle("update:check", () => checkForUpdates());
  handle("update:download", () => startUpdateDownload());
  handle("update:pause", () => pauseUpdateDownload());
  handle("update:decline", () => declineUpdate());
  handle("update:install", () => installUpdate());
}
