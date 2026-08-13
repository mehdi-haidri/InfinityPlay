/**
 * Stages the FFmpeg and FFprobe binaries that get shipped inside the app.
 *
 * FFmpeg comes from `@rse/ffmpeg`, which stores platform-specific binaries under its
 * `ffmpeg.d/` directory with names like `ffmpeg-lnx-x64`, `ffmpeg-mac-a64`, etc.
 *
 * FFprobe comes from `@ffprobe-installer/ffprobe`, which publishes one package per
 * platform/arch and npm installs only the one matching the build machine. The macOS CI
 * job builds both x64 and arm64 from a single arm64 runner, so the cross-arch package
 * must be installed explicitly (handled in the CI workflow).
 *
 * Runs as electron-builder's `beforePack` hook, once per target arch, and writes into
 * `build/bin` which `extraResources` then copies to `resources/bin`.
 */
const fs = require("node:fs");
const path = require("node:path");

/** electron-builder's Arch enum. */
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

/**
 * Maps electron-builder's platform/arch to the `@rse/ffmpeg` binary filename stored
 * under `node_modules/@rse/ffmpeg/ffmpeg.d/`.
 */
const RSE_FFMPEG_BINARIES = {
  "win32-x64":    "ffmpeg-win-x64.exe",
  "darwin-x64":   "ffmpeg-mac-x64",
  "darwin-arm64": "ffmpeg-mac-a64",
  "linux-x64":    "ffmpeg-lnx-x64",
  "linux-arm64":  "ffmpeg-lnx-a64",
};

/** Resolves the FFmpeg binary from `@rse/ffmpeg` for the given target. */
function resolveFFmpeg(platform, arch) {
  const key = `${platform}-${arch}`;
  const filename = RSE_FFMPEG_BINARIES[key];
  if (!filename) return null;

  const candidate = path.join(
    __dirname, "..", "node_modules", "@rse", "ffmpeg", "ffmpeg.d", filename,
  );
  return fs.existsSync(candidate) ? candidate : null;
}

/** Resolves the FFprobe binary from `@ffprobe-installer/ffprobe` for the given target. */
function resolveFFprobe(platform, arch) {
  const executable = platform === "win32" ? "ffprobe.exe" : "ffprobe";

  try {
    const pkg = `@ffprobe-installer/${platform}-${arch}/package.json`;
    return path.join(path.dirname(require.resolve(pkg)), executable);
  } catch {
    // Not installed for this target.
  }

  try {
    const host = require("@ffprobe-installer/ffprobe");
    if (host?.path && fs.existsSync(host.path)) {
      console.warn(
        `  • ffprobe: no ${platform}-${arch} package installed, using the host binary. ` +
          `Install @ffprobe-installer/${platform}-${arch} for a correct cross-arch build.`,
      );
      return host.path;
    }
  } catch {
    // Handled by the caller.
  }
  return null;
}

exports.default = async function prepareFfmpeg(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH_NAMES[context.arch] ?? "x64";
  const destination = path.join(__dirname, "bin");

  // Cleared each time: the folder is reused across arch passes, and a stale binary would
  // be shipped silently for the wrong architecture.
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  // --- FFmpeg (from @rse/ffmpeg) ---
  const ffmpegSource = resolveFFmpeg(platform, arch);
  if (!ffmpegSource || !fs.existsSync(ffmpegSource)) {
    throw new Error(
      `Cannot bundle ffmpeg for ${platform}-${arch}: the @rse/ffmpeg binary is missing. ` +
        `Ensure @rse/ffmpeg is installed and the binary for this platform has been downloaded.`,
    );
  }
  const ffmpegExe = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const ffmpegTarget = path.join(destination, ffmpegExe);
  fs.copyFileSync(ffmpegSource, ffmpegTarget);
  if (platform !== "win32") fs.chmodSync(ffmpegTarget, 0o755);
  const ffmpegSize = Math.round(fs.statSync(ffmpegTarget).size / 1048576);
  console.log(`  • bundling ${ffmpegExe} for ${platform}-${arch} (${ffmpegSize} MB)`);

  // --- FFprobe (from @ffprobe-installer/ffprobe) ---
  const ffprobeSource = resolveFFprobe(platform, arch);
  if (!ffprobeSource || !fs.existsSync(ffprobeSource)) {
    throw new Error(
      `Cannot bundle ffprobe for ${platform}-${arch}: install @ffprobe-installer/${platform}-${arch}.`,
    );
  }
  const ffprobeExe = platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const ffprobeTarget = path.join(destination, ffprobeExe);
  fs.copyFileSync(ffprobeSource, ffprobeTarget);
  if (platform !== "win32") fs.chmodSync(ffprobeTarget, 0o755);
  const ffprobeSize = Math.round(fs.statSync(ffprobeTarget).size / 1048576);
  console.log(`  • bundling ${ffprobeExe} for ${platform}-${arch} (${ffprobeSize} MB)`);
};
