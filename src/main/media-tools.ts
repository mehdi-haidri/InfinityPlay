/**
 * Locates the FFmpeg and FFprobe binaries.
 *
 * Packaged builds ship their own under `resources/bin`, so downloads and Live TV work
 * without the user installing anything. The lookup still falls back to a development
 * install and then to the bare command name, which keeps a `PATH` install working — and
 * matters when a platform build could not bundle one.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { app } from "electron";

type Tool = "ffmpeg" | "ffprobe";

/**
 * Development-mode lookup by npm package.
 *
 * FFmpeg comes from `@rse/ffmpeg`, which stores platform-specific binaries under
 * `ffmpeg.d/` inside the package and exposes `FFmpeg.binary`. FFprobe still comes from
 * `@ffprobe-installer/ffprobe`, which exposes `.path`.
 */
const INSTALLER_PACKAGES: Record<Tool, string> = {
  ffmpeg: "@rse/ffmpeg",
  ffprobe: "@ffprobe-installer/ffprobe",
};

const resolved = new Map<Tool, string>();

function locate(tool: Tool): string {
  const executable = process.platform === "win32" ? `${tool}.exe` : tool;

  // Shipped with the app. `process.resourcesPath` is only meaningful once packaged.
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "bin", executable);
    if (fs.existsSync(bundled)) return bundled;
  } else {
    // Development: resolve from the npm package.
    try {
      const require = createRequire(import.meta.url);
      if (tool === "ffmpeg") {
        // @rse/ffmpeg exposes a class with a static `binary` getter.
        const FFmpeg = require(INSTALLER_PACKAGES[tool]) as { supported: boolean; binary: string };
        if (FFmpeg.supported && fs.existsSync(FFmpeg.binary)) return FFmpeg.binary;
      } else {
        // @ffprobe-installer/ffprobe exposes { path: string }.
        const installed = require(INSTALLER_PACKAGES[tool]) as { path?: string };
        if (installed.path && fs.existsSync(installed.path)) return installed.path;
      }
    } catch {
      // Not installed; fall through to PATH.
    }
  }

  return tool;
}

/** Absolute path to the bundled binary, or the bare name when relying on `PATH`. */
export function toolPath(tool: Tool): string {
  const cached = resolved.get(tool);
  if (cached) return cached;
  const location = locate(tool);
  resolved.set(tool, location);
  return location;
}

const availability = new Map<Tool, boolean>();

/** Whether the tool can actually be executed, probed once per run. */
export function toolAvailable(tool: Tool): boolean {
  const cached = availability.get(tool);
  if (cached !== undefined) return cached;
  const available = spawnSync(toolPath(tool), ["-version"], { stdio: "ignore" }).status === 0;
  availability.set(tool, available);
  return available;
}

/**
 * Runs `ffmpeg -version` and extracts the human-readable version string (e.g. "7.0.2").
 * Returns an empty string when FFmpeg is not available or the output cannot be parsed.
 */
export function ffmpegVersion(): string {
  if (!toolAvailable("ffmpeg")) return "";
  try {
    const result = spawnSync(toolPath("ffmpeg"), ["-version"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    const output = result.stdout?.toString("utf8") ?? "";
    const match = output.match(/ffmpeg\s+version\s+(\d+\.\d+(?:\.\d+)?)/);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}
