/**
 * Stages the FFmpeg binaries that get shipped inside the app.
 *
 * `@ffmpeg-installer` publishes one package per platform/arch and npm installs only the
 * one matching the build machine. That is right for Windows and Linux, which are built on
 * their own runners, but macOS produces both x64 and arm64 from a single arm64 runner, so
 * the package for the *target* arch is resolved here rather than trusting the host's.
 *
 * Runs as electron-builder's `beforePack` hook, once per target arch, and writes into
 * `build/bin` which `extraResources` then copies to `resources/bin`.
 */
const fs = require("node:fs");
const path = require("node:path");

/** electron-builder's Arch enum. */
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

const TOOLS = [
  { name: "ffmpeg", scope: "@ffmpeg-installer" },
  { name: "ffprobe", scope: "@ffprobe-installer" },
];

/** Locates the binary for an exact platform/arch, else falls back to the host's. */
function resolveBinary(tool, platform, arch) {
  const executable = platform === "win32" ? `${tool.name}.exe` : tool.name;

  try {
    const pkg = `${tool.scope}/${platform}-${arch}/package.json`;
    return path.join(path.dirname(require.resolve(pkg)), executable);
  } catch {
    // Not installed for this target.
  }

  try {
    const host = require(`${tool.scope}/${tool.name}`);
    if (host?.path && fs.existsSync(host.path)) {
      console.warn(
        `  • ${tool.name}: no ${platform}-${arch} package installed, using the host binary. ` +
          `Install ${tool.scope}/${platform}-${arch} for a correct cross-arch build.`,
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

  for (const tool of TOOLS) {
    const source = resolveBinary(tool, platform, arch);
    if (!source || !fs.existsSync(source)) {
      throw new Error(
        `Cannot bundle ${tool.name} for ${platform}-${arch}: install ${tool.scope}/${platform}-${arch}.`,
      );
    }
    const executable = platform === "win32" ? `${tool.name}.exe` : tool.name;
    const target = path.join(destination, executable);
    fs.copyFileSync(source, target);
    // The npm tarball does not always preserve the executable bit on macOS and Linux.
    if (platform !== "win32") fs.chmodSync(target, 0o755);
    const size = Math.round(fs.statSync(target).size / 1048576);
    console.log(`  • bundling ${executable} for ${platform}-${arch} (${size} MB)`);
  }
};
