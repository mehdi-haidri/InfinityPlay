/**
 * Locates the FFmpeg and FFprobe binaries.
 *
 * Windows and macOS packages ship their own tools under `resources/bin`. Linux always
 * uses the maintained `ffmpeg` and `ffprobe` installed by the distribution on `PATH`.
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
const resolved = new Map<Tool, string>();

function locate(tool: Tool): string {
  const executable = process.platform === "win32" ? `${tool}.exe` : tool;

  // Never run the obsolete Linux static binaries shipped by the npm packages. Current
  // distribution builds receive security/codec fixes and support current kernels.
  if (process.platform === "linux") return executable;

  // Shipped with the app. `process.resourcesPath` is only meaningful once packaged.
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "bin", executable);
    if (fs.existsSync(bundled)) return bundled;
  } else {
    // Development on Windows/macOS: resolve each tool from its own package.
    try {
      const require = createRequire(import.meta.url);
      if (tool === "ffmpeg") {
        const FFmpeg = require("@rse/ffmpeg") as { supported: boolean; binary: string };
        if (FFmpeg.supported && fs.existsSync(FFmpeg.binary)) return FFmpeg.binary;
      } else {
        const FFprobe = require("@ffprobe-installer/ffprobe") as { path: string };
        if (FFprobe.path && fs.existsSync(FFprobe.path)) return FFprobe.path;
      }
    } catch {
      // Not installed; fall through to PATH.
    }
  }

  return executable;
}

/** Absolute path to a bundled binary, or the bare command name when relying on `PATH`. */
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
