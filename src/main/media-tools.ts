/**
 * Locates the FFmpeg and FFprobe binaries.
 *
 * Windows and macOS packages ship their own tools under `resources/bin`. Linux always
 * uses the maintained `ffmpeg` and `ffprobe` installed by the distribution on `PATH`.
 */
import fs from "node:fs";
import path from "node:path";
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

function findLinuxBinary(tool: Tool): string {
  const standardPaths = [
    `/usr/bin/${tool}`,
    `/usr/local/bin/${tool}`,
    `/bin/${tool}`,
    `/opt/homebrew/bin/${tool}`,
  ];
  for (const candidate of standardPaths) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const envPath = process.env.PATH || "";
  for (const dir of envPath.split(path.delimiter)) {
    if (dir.includes("node_modules")) continue;
    const candidate = path.join(dir, tool);
    if (fs.existsSync(candidate)) return candidate;
  }

  return tool;
}

function locate(tool: Tool): string {
  const executable = process.platform === "win32" ? `${tool}.exe` : tool;

  // On Linux, always use the real system binary (/usr/bin/ffmpeg), never node_modules/.bin npm stubs
  if (process.platform === "linux") return findLinuxBinary(tool);

  // Packaged app: tools reside under resources/bin/
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "bin", executable);
    if (fs.existsSync(bundled)) return bundled;
  } else {
    // Development mode on Windows / macOS: check package binaries directly without triggering @rse/ffmpeg top-level throw
    try {
      if (tool === "ffmpeg") {
        const candidateFile =
          process.platform === "win32"
            ? "ffmpeg-win-x64.exe"
            : process.arch === "arm64"
              ? "ffmpeg-mac-a64"
              : "ffmpeg-mac-x64";
        const candidatePath = path.join(
          process.cwd(),
          "node_modules",
          "@rse",
          "ffmpeg",
          "ffmpeg.d",
          candidateFile,
        );
        if (fs.existsSync(candidatePath)) return candidatePath;
      } else {
        const candidateFile = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
        const candidatePath = path.join(
          process.cwd(),
          "node_modules",
          "@ffprobe-installer",
          "ffprobe",
          candidateFile,
        );
        if (fs.existsSync(candidatePath)) return candidatePath;
      }
    } catch {
      // Fall through to PATH
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

/** Whether the tool can actually be executed, probed once per run with timeout safety. */
export function toolAvailable(tool: Tool): boolean {
  const cached = availability.get(tool);
  if (cached !== undefined) return cached;
  try {
    const available = spawnSync(toolPath(tool), ["-version"], { stdio: "ignore", timeout: 3_000 }).status === 0;
    availability.set(tool, available);
    return available;
  } catch {
    availability.set(tool, false);
    return false;
  }
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
