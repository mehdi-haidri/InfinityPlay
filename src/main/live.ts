import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { protocol } from "electron";
import type { PreparedLiveStream } from "@shared/types";

export const LIVE_TRANSCODE_SCHEME = "iptranscode";

const PROBE_TIMEOUT_MS = 8_000;
const SUPPORTED_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const prepared = new Map<string, { source: string; createdAt: number }>();
const probeCache = new Map<string, { codec: string; checkedAt: number }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

function commandAvailable(command: string): boolean {
  return spawnSync(command, ["-version"], { stdio: "ignore" }).status === 0;
}

function probeCodec(source: string): Promise<string> {
  const cached = probeCache.get(source);
  if (cached && Date.now() - cached.checkedAt < CACHE_MS) return Promise.resolve(cached.codec);

  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-rw_timeout", "6000000",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "default=noprint_wrappers=1:nokey=1",
      source,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", () => resolve(""));
    child.once("close", () => {
      clearTimeout(timer);
      const codec = Buffer.concat(chunks).toString("utf8").trim().split(/\s+/)[0] ?? "";
      if (codec) probeCache.set(source, { codec, checkedAt: Date.now() });
      resolve(codec);
    });
  });
}

export async function prepareLiveStream(source: string): Promise<PreparedLiveStream> {
  let probeSource = source;
  if (source.startsWith("ipmedia://")) {
    probeSource = new URL(source).searchParams.get("path") ?? "";
  } else if (!/^https?:\/\//i.test(source)) {
    return { url: source, transcoded: false };
  }
  // DASH playback needs the session-level CloudFront signer in Electron. FFmpeg runs as
  // a separate process and cannot inherit those signed segment redirects.
  if (/\.mpd(?:$|\?)/i.test(source)) return { url: source, transcoded: false };
  if (!commandAvailable("ffprobe")) return { url: source, transcoded: false };

  const codec = await probeCodec(probeSource);
  if (!codec || SUPPORTED_VIDEO_CODECS.has(codec)) {
    return { url: source, transcoded: false, codec: codec || undefined };
  }
  if (!commandAvailable("ffmpeg")) {
    return {
      url: source,
      transcoded: false,
      codec,
      warning: `This video uses ${codec}, which Electron cannot decode directly. Install FFmpeg to enable compatibility playback.`,
    };
  }

  const token = randomUUID();
  prepared.set(token, { source: probeSource, createdAt: Date.now() });
  for (const [key, entry] of prepared) {
    if (Date.now() - entry.createdAt > CACHE_MS || prepared.size > 30) prepared.delete(key);
  }
  return {
    url: `${LIVE_TRANSCODE_SCHEME}://live/${token}`,
    transcoded: true,
    codec,
    warning: `Compatibility mode enabled for this ${codec} video.`,
  };
}

export function registerLiveTranscodeProtocol(): void {
  protocol.handle(LIVE_TRANSCODE_SCHEME, async (request) => {
    const token = new URL(request.url).pathname.replace(/^\//, "");
    const entry = prepared.get(token);
    if (!entry) return new Response("Stream session expired", { status: 404 });

    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "warning",
      "-fflags", "nobuffer", "-flags", "low_delay",
      "-analyzeduration", "2000000", "-probesize", "2000000",
      "-i", entry.source,
      "-map", "0:v:0?", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
      "-pix_fmt", "yuv420p", "-g", "50", "-sc_threshold", "0",
      "-c:a", "aac", "-b:a", "128k",
      "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) console.warn("[live-transcode]", message);
    });
    request.signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });

    return new Response(Readable.toWeb(child.stdout) as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
      },
    });
  });
}
