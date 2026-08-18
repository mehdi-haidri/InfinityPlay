import { app, BrowserWindow, dialog, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppInfo } from "@shared/types";
import { toolAvailable, ffmpegVersion } from "../media-tools";
import { isAutoUpdateSupported } from "../updater";
import { setDiscordActivity, clearDiscordActivity } from "../discord";
import { handle } from "./handle";

function packageType(): string {
  if (!app.isPackaged) return "development";
  if (process.platform === "darwin") return "macOS DMG (unsigned)";
  if (process.platform === "win32") return "Windows NSIS";
  if (process.env.APPIMAGE) return "AppImage";

  const marker = join(process.resourcesPath, "package-type");
  if (existsSync(marker)) return readFileSync(marker, "utf8").trim() || "Linux package";
  return "DEB/RPM package";
}

export function registerSystemIpc(getWindow: () => BrowserWindow | null): void {
  handle("app:info", async (): Promise<AppInfo> => {
    const gpuInfo = await app.getGPUInfo("basic").catch(() => null) as {
      gpuDevice?: { vendorId?: number }[];
    } | null;
    const vendorId = Number(gpuInfo?.gpuDevice?.[0]?.vendorId ?? 0);
    const vendor = vendorId === 0x10de
      ? "NVIDIA"
      : vendorId === 0x1002 || vendorId === 0x1022
        ? "AMD"
        : vendorId === 0x8086
          ? "Intel"
          : vendorId
            ? `GPU vendor 0x${vendorId.toString(16)}`
            : "GPU not detected";
    const decode = app.getGPUFeatureStatus().video_decode;
    return {
      name: app.getName(),
      version: app.getVersion(),
      runtime: "electron",
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform}-${process.arch}`,
      packageType: packageType(),
      ffmpeg: toolAvailable("ffmpeg"),
      ffmpegVersion: ffmpegVersion(),
      updatable: isAutoUpdateSupported(),
      gpu: `${vendor} · video decode ${decode}`,
    };
  });

  handle("shell:openExternal", (url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only web links can be opened outside InfinityPlay.");
    }
    return shell.openExternal(parsed.toString());
  });

  handle("window:toggleFullScreen", (value: boolean) => {
    const window = getWindow();
    if (!window) return false;
    window.setFullScreen(value);
    return window.isFullScreen();
  });

  handle("app:restart", () => {
    app.relaunch();
    app.quit();
    return true;
  });

  handle("dialog:pickPlaylistFile", async () => {
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: "Add an M3U playlist",
      filters: [{ name: "Playlists", extensions: ["m3u", "m3u8"] }],
      properties: ["openFile"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle("dialog:pickDirectory", async (title?: string) => {
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: title || "Select Directory",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle(
    "discord:setActivity",
    (params: {
      details: string;
      state?: string;
      startTimestamp?: number;
      endTimestamp?: number;
      largeImageKey?: string;
      largeImageText?: string;
    }) => setDiscordActivity(params),
  );

  handle("discord:clearActivity", () => clearDiscordActivity());
}
