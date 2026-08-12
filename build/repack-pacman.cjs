const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");

const XZ_MAGIC = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function runRecompression(source, destination) {
  return new Promise((resolve, reject) => {
    const xz = spawn("xz", ["--decompress", "--stdout", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const zstd = spawn(
      "zstd",
      ["--quiet", "-19", "-T0", "--force", "-o", destination],
      { stdio: ["pipe", "ignore", "pipe"] },
    );

    const errors = [];
    xz.stderr.on("data", (chunk) => errors.push(chunk));
    zstd.stderr.on("data", (chunk) => errors.push(chunk));
    xz.on("error", reject);
    zstd.on("error", reject);
    zstd.stdin.on("error", (error) => {
      // A failed zstd process closes stdin first; its exit code and stderr below carry
      // the useful diagnostic, so do not let the pipe's EPIPE mask them.
      if (error.code !== "EPIPE") reject(error);
    });
    xz.stdout.pipe(zstd.stdin);

    let xzCode = null;
    let zstdCode = null;
    const finish = () => {
      if (xzCode === null || zstdCode === null) return;
      if (xzCode === 0 && zstdCode === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Could not recompress Arch package (xz=${xzCode}, zstd=${zstdCode}): ` +
            Buffer.concat(errors).toString("utf8").trim(),
        ),
      );
    };
    xz.on("close", (code) => {
      xzCode = code;
      finish();
    });
    zstd.on("close", (code) => {
      zstdCode = code;
      finish();
    });
  });
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}

exports.default = async function repackPacman(event) {
  if (event.target?.name !== "pacman" || !event.file.endsWith(".pkg.tar.zst")) return;

  const handle = await fs.open(event.file, "r");
  const header = Buffer.alloc(6);
  await handle.read(header, 0, header.length, 0);
  await handle.close();

  const alreadyZstd = header.subarray(0, ZSTD_MAGIC.length).equals(ZSTD_MAGIC);
  if (!alreadyZstd && !header.equals(XZ_MAGIC)) {
    throw new Error(`Unexpected compression format for ${path.basename(event.file)}`);
  }

  if (!alreadyZstd) {
    const temporary = `${event.file}.zstd-tmp`;
    try {
      await runRecompression(event.file, temporary);
      await fs.rename(temporary, event.file);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  // electron-builder 25 omits pacman from its update metadata even though the matching
  // electron-updater version has a PacmanUpdater. Add the recompressed artifact after its
  // final checksum and size are known so latest-linux.yml includes it.
  const info = await fs.stat(event.file);
  event.isWriteUpdateInfo = true;
  event.updateInfo = { sha512: await hashFile(event.file), size: info.size };
};
