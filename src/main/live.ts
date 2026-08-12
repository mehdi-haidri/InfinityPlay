import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { app, protocol } from "electron";
import type { PreparedLiveStream } from "@shared/types";
import { getConfig } from "./store";

export const LIVE_TRANSCODE_SCHEME = "iptranscode";

const PROBE_TIMEOUT_MS = 8_000;
const SUPPORTED_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const prepared = new Map<string, { source: string; startAt: number; createdAt: number; temporary?: boolean }>();
const probeCache = new Map<string, { codec: string; duration: number; checkedAt: number }>();
const CACHE_MS = 6 * 60 * 60 * 1000;
const commandCache = new Map<string, boolean>();
const previewCache = new Map<string, { dataUrl: string; createdAt: number }>();
const PREVIEW_CACHE_MS = 30 * 60 * 1000;
const PREVIEW_CACHE_MAX = 140;

function prunePrepared(): void {
  for (const [key, entry] of prepared) {
    if (Date.now() - entry.createdAt > CACHE_MS || prepared.size > 30) {
      if (entry.temporary) {
        try { fs.rmSync(entry.source, { force: true }); } catch { /* ignored */ }
      }
      prepared.delete(key);
    }
  }
}

function commandAvailable(command: string): boolean {
  const cached = commandCache.get(command);
  if (cached !== undefined) return cached;
  const available = spawnSync(command, ["-version"], { stdio: "ignore" }).status === 0;
  commandCache.set(command, available);
  return available;
}

function probeMedia(source: string): Promise<{ codec: string; duration: number }> {
  const cached = probeCache.get(source);
  if (cached && Date.now() - cached.checkedAt < CACHE_MS) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-rw_timeout", "6000000",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name:format=duration",
      "-of", "json",
      source,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", () => resolve({ codec: "", duration: 0 }));
    child.once("close", () => {
      clearTimeout(timer);
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const codec = String(payload?.streams?.[0]?.codec_name ?? "");
        const parsedDuration = Number(payload?.format?.duration ?? 0);
        const duration = Number.isFinite(parsedDuration) ? parsedDuration : 0;
        const result = { codec, duration, checkedAt: Date.now() };
        if (codec) probeCache.set(source, result);
        resolve({ codec, duration });
      } catch {
        resolve({ codec: "", duration: 0 });
      }
    });
  });
}

export async function prepareLiveStream(
  source: string,
  startAt = 0,
  resolution = 0,
): Promise<PreparedLiveStream> {
  let probeSource = source;
  if (source.startsWith("ipmedia://")) {
    probeSource = new URL(source).searchParams.get("path") ?? "";
  } else if (!/^https?:\/\//i.test(source)) {
    return { url: source, transcoded: false };
  }
  if (/\.mpd(?:$|\?)/i.test(source)) return prepareDashStream(source, startAt, resolution);
  if (!commandAvailable("ffprobe")) return { url: source, transcoded: false };

  const { codec, duration } = await probeMedia(probeSource);
  if (!codec || SUPPORTED_VIDEO_CODECS.has(codec)) {
    return { url: source, transcoded: false, codec: codec || undefined, duration };
  }
  if (!commandAvailable("ffmpeg")) {
    return {
      url: source,
      transcoded: false,
      codec,
      duration,
      warning: `This video uses ${codec}, which Electron cannot decode directly. Install FFmpeg to enable compatibility playback.`,
    };
  }

  const token = randomUUID();
  prepared.set(token, { source: probeSource, startAt: Math.max(0, startAt), createdAt: Date.now() });
  prunePrepared();
  return {
    url: `${LIVE_TRANSCODE_SCHEME}://live/${token}`,
    transcoded: true,
    codec,
    duration,
    warning: `Compatibility mode enabled for this ${codec} video.`,
  };
}

function parseIsoDuration(value: string): number {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?([\d.]+)S$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

interface MaterializedDash {
  path: string;
  codec: string;
  duration: number;
  height: number;
}

async function materializeDash(
  source: string,
  resolution: number,
): Promise<MaterializedDash | null> {
  const response = await fetch(source, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const original = await response.text();
  const blocks = [...original.matchAll(/<Representation\b[\s\S]*?<\/Representation>/g)];
  const videoBlocks = blocks.filter((match) => /\bheight="\d+"/.test(match[0]));
  const selected =
    videoBlocks.find((match) => Number(match[0].match(/\bheight="(\d+)"/)?.[1]) === resolution) ??
    videoBlocks[0];
  if (!selected) return null;
  const codecValue = selected[0].match(/\bcodecs="([^"]+)"/)?.[1]?.toLowerCase() ?? "";
  const codec = codecValue.includes("hev") || codecValue.includes("hvc") ? "hevc" : "h264";
  const duration = parseIsoDuration(original.match(/mediaPresentationDuration="([^"]+)"/)?.[1] ?? "");
  const chosenHeight = Number(selected[0].match(/\bheight="(\d+)"/)?.[1] ?? 0);
  let chosenKept = false;
  const filtered = original.replace(/<Representation\b[\s\S]*?<\/Representation>/g, (block) => {
    const height = Number(block.match(/\bheight="(\d+)"/)?.[1] ?? 0);
    if (height === 0) return block;
    if (!chosenKept && block === selected[0]) {
      chosenKept = true;
      return block;
    }
    return "";
  });
  const parsed = new URL(source);
  const baseUrl = `${parsed.origin}${parsed.pathname.replace(/[^/]+$/, "")}`;
  const query = parsed.search.slice(1).replace(/&/g, "&amp;");
  const signed = query
    ? filtered.replace(
        /\b(initialization|media)="([^"]+)"/g,
        (_match, name: string, value: string) =>
          `${name}="${value}${value.includes("?") ? "&amp;" : "?"}${query}"`,
      )
    : filtered;
  const manifest = signed.replace(/(<Period\b[^>]*>)/, `$1\n<BaseURL>${baseUrl}</BaseURL>`);
  const token = randomUUID();
  const manifestPath = path.join(app.getPath("temp"), `infinityplay-${token}.mpd`);
  fs.writeFileSync(manifestPath, manifest, "utf8");
  return { path: manifestPath, codec, duration, height: chosenHeight };
}

async function prepareDashStream(
  source: string,
  startAt: number,
  resolution: number,
): Promise<PreparedLiveStream> {
  if (!commandAvailable("ffmpeg")) return { url: source, transcoded: false };
  try {
    const input = await materializeDash(source, resolution);
    if (!input) return { url: source, transcoded: false };
    if (SUPPORTED_VIDEO_CODECS.has(input.codec)) {
      fs.rmSync(input.path, { force: true });
      return { url: source, transcoded: false, codec: input.codec, duration: input.duration };
    }

    const token = randomUUID();
    prepared.set(token, { source: input.path, startAt: Math.max(0, startAt), createdAt: Date.now(), temporary: true });
    prunePrepared();
    return {
      url: `${LIVE_TRANSCODE_SCHEME}://live/${token}`,
      transcoded: true,
      codec: input.codec,
      duration: input.duration,
      warning: `Linux compatibility mode enabled for this ${input.codec} ${input.height}p adaptive stream.`,
    };
  } catch {
    return { url: source, transcoded: false };
  }
}

/** Generates one small, cached frame for the hover preview without loading a second video. */
export async function generateMediaPreview(
  source: string,
  position: number,
  resolution: number,
): Promise<string | null> {
  if (!commandAvailable("ffmpeg")) return null;
  const bucket = Math.max(0, Math.round(position / 5) * 5);
  const key = `${source}|${resolution}|${bucket}`;
  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.createdAt < PREVIEW_CACHE_MS) return cached.dataUrl;

  let input = source;
  let temporary: string | null = null;
  if (source.startsWith("ipmedia://")) {
    input = new URL(source).searchParams.get("path") ?? "";
  } else if (/\.mpd(?:$|\?)/i.test(source)) {
    try {
      const manifest = await materializeDash(source, resolution);
      if (!manifest) return null;
      input = manifest.path;
      temporary = manifest.path;
    } catch {
      return null;
    }
  }
  if (!input) return null;

  try {
    const dataUrl = await new Promise<string | null>((resolve) => {
      const child = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-ss", bucket.toFixed(3),
        "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
        "-i", input,
        "-map", "0:v:0?", "-frames:v", "1",
        "-vf", "scale=320:-2:force_original_aspect_ratio=decrease",
        "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
      ], { stdio: ["ignore", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(null);
      }, 12_000);
      child.stdout?.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2_000_000) {
          child.kill("SIGKILL");
          finish(null);
          return;
        }
        chunks.push(chunk);
      });
      child.once("error", () => finish(null));
      child.once("close", (code) => {
        const image = Buffer.concat(chunks);
        finish(code === 0 && image.length > 0 ? `data:image/jpeg;base64,${image.toString("base64")}` : null);
      });
    });
    if (!dataUrl) return null;
    previewCache.set(key, { dataUrl, createdAt: Date.now() });
    while (previewCache.size > PREVIEW_CACHE_MAX) {
      const oldest = previewCache.keys().next().value;
      if (oldest === undefined) break;
      previewCache.delete(oldest);
    }
    return dataUrl;
  } finally {
    if (temporary) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* ignored */ }
    }
  }
}

export function registerLiveTranscodeProtocol(): void {
  protocol.handle(LIVE_TRANSCODE_SCHEME, async (request) => {
    const token = new URL(request.url).pathname.replace(/^\//, "");
    const entry = prepared.get(token);
    if (!entry) return new Response("Stream session expired", { status: 404 });

    const acceleration = getConfig().hardwareAcceleration ? ["-hwaccel", "auto"] : [];
    const seek = entry.startAt > 0 ? ["-ss", entry.startAt.toFixed(3)] : [];
    const output = new PassThrough();
    let child: ReturnType<typeof spawn> | null = null;
    let aborted = false;

    const finish = () => {
      if (!entry.temporary) return;
      try { fs.rmSync(entry.source, { force: true }); } catch { /* ignored */ }
      prepared.delete(token);
    };

    const launch = (accelerationArgs: string[], mayFallback: boolean) => {
      let emitted = false;
      child = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "warning",
        "-fflags", "nobuffer", "-flags", "low_delay",
        "-analyzeduration", "2000000", "-probesize", "2000000",
        ...accelerationArgs,
        ...seek,
        "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
        "-i", entry.source,
        "-map", "0:v:0?", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
        "-pix_fmt", "yuv420p", "-g", "50", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "128k",
        "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1",
      ], { stdio: ["ignore", "pipe", "pipe"] });

      child.stdout?.on("data", (chunk: Buffer) => {
        emitted = true;
        if (!output.destroyed) output.write(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const message = chunk.toString("utf8").trim();
        if (message) console.warn("[live-transcode]", message);
      });
      child.once("close", () => {
        if (aborted) return;
        if (mayFallback && !emitted) {
          console.warn("[live-transcode] Hardware decode produced no video; retrying in software.");
          launch([], false);
          return;
        }
        output.end();
        finish();
      });
    };

    launch(acceleration, acceleration.length > 0);
    request.signal.addEventListener("abort", () => {
      aborted = true;
      child?.kill("SIGKILL");
      output.destroy();
      finish();
    }, { once: true });

    return new Response(Readable.toWeb(output) as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
      },
    });
  });
}
