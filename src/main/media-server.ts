/**
 * A short-lived HTTP server that lends media to a TV.
 *
 * It covers two cases. A downloaded file cannot be handed over as `ipmedia://` or a local path, so
 * it is republished on the LAN. And a stream from the CDN cannot be fetched by the TV at all: that
 * host answers 428 to any client that is not sending the app's substitute User-Agent — measured,
 * the same signed URL returns 206 for the app and 428 for a Chromecast's `CrKey/...` — so those
 * URLs are proxied, with this process doing the fetching and passing the bytes on.
 *
 * The server binds to the LAN, so it is deliberately narrow: it serves nothing but what has been
 * published for the current cast, each behind an unguessable token, and it refuses every other
 * path. Everything is revoked when the cast stops.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { STREAM_USER_AGENT, needsStreamHeaders } from "./stream-headers";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".vtt": "text/vtt",
  ".srt": "application/x-subrip",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

/** What a token stands for: a file on disk, or a remote URL this process fetches on the TV's behalf. */
type Publication = { kind: "file"; file: string } | { kind: "remote"; url: string };

/** token -> publication. Cleared when the cast stops. */
const published = new Map<string, Publication>();
let server: http.Server | null = null;
let origin = "";

/** The address a TV on the same network can reach. */
function lanAddress(): string | null {
  const candidates: string[] = [];

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      candidates.push(entry.address);
    }
  }

  // Private ranges first: a VPN or virtual adapter often sorts ahead of the real network card.
  const priv = candidates.find((address) => /^192\.168\./.test(address))
    ?? candidates.find((address) => /^10\./.test(address))
    ?? candidates.find((address) => /^172\.(1[6-9]|2\d|3[01])\./.test(address));

  return priv ?? candidates[0] ?? null;
}

/**
 * Passes one request upstream and mirrors the answer back.
 *
 * Every header that decides whether a TV will start or seek — status, `Content-Range`,
 * `Content-Length`, `Content-Type`, `Accept-Ranges` — is copied from upstream rather than
 * invented here, because a renderer that is told the wrong length simply stops.
 */
function proxy(target: string, request: http.IncomingMessage, response: http.ServerResponse, hop = 0): void {
  if (hop > 5) {
    response.writeHead(502).end();
    return;
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    response.writeHead(502).end();
    return;
  }

  const headers: Record<string, string> = { "User-Agent": STREAM_USER_AGENT, Accept: "*/*" };
  if (request.headers.range) headers.Range = request.headers.range;

  const transport = url.protocol === "http:" ? http : https;
  const upstream = transport.request(
    {
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      // A HEAD downstream stays a HEAD upstream; some renderers probe before committing.
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
    },
    (upstreamResponse) => {
      const status = upstreamResponse.statusCode ?? 502;

      // Signed CDN URLs redirect often, and a TV handed a 302 to a host it cannot authenticate
      // against is back where it started. Follow the hop here instead.
      if (status >= 300 && status < 400 && upstreamResponse.headers.location) {
        upstreamResponse.resume();
        proxy(new URL(upstreamResponse.headers.location, url).toString(), request, response, hop + 1);
        return;
      }

      const passed: Record<string, string> = {};
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = upstreamResponse.headers[name];
        if (typeof value === "string") passed[name] = value;
      }
      if (!passed["accept-ranges"]) passed["accept-ranges"] = "bytes";

      response.writeHead(status, passed);
      if (request.method === "HEAD") {
        upstreamResponse.resume();
        response.end();
        return;
      }
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });

  // TVs abandon range requests aggressively while seeking; without this the sockets pile up.
  response.on("close", () => upstream.destroy());
  upstream.end();
}

function serve(request: http.IncomingMessage, response: http.ServerResponse): void {
  const token = (request.url ?? "").replace(/^\/+/, "").split("?")[0];
  const entry = published.get(token);

  if (!entry) {
    response.writeHead(404).end();
    return;
  }

  if (entry.kind === "remote") {
    proxy(entry.url, request, response);
    return;
  }

  const file = entry.file;
  if (!fs.existsSync(file)) {
    response.writeHead(404).end();
    return;
  }

  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

  // Some renderers probe with HEAD before committing to the stream.
  if (request.method === "HEAD") {
    response.writeHead(200, {
      "Content-Length": size,
      "Content-Type": type,
      "Accept-Ranges": "bytes",
    });
    response.end();
    return;
  }

  // Range support is not optional: without it most TVs refuse to seek, and some refuse to start.
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number.parseInt(range[1], 10) : 0;
    const end = range[2] ? Number.parseInt(range[2], 10) : size - 1;

    if (Number.isNaN(start) || start >= size) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }

    const last = Math.min(end, size - 1);
    response.writeHead(206, {
      "Content-Range": `bytes ${start}-${last}/${size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": last - start + 1,
      "Content-Type": type,
    });
    fs.createReadStream(file, { start, end: last }).pipe(response);
    return;
  }

  response.writeHead(200, {
    "Content-Length": size,
    "Content-Type": type,
    "Accept-Ranges": "bytes",
  });
  fs.createReadStream(file).pipe(response);
}

async function ensureServer(): Promise<string> {
  if (server && origin) return origin;

  const address = lanAddress();
  if (!address) throw new Error("No network connection was found to share this file over.");

  return new Promise((resolve, reject) => {
    const created = http.createServer(serve);
    created.on("error", reject);
    // Port 0 lets the OS pick a free one; the receiver is told the full URL anyway.
    created.listen(0, address, () => {
      const bound = created.address();
      if (typeof bound === "string" || bound === null) {
        reject(new Error("The media server could not be started."));
        return;
      }
      server = created;
      origin = `http://${address}:${bound.port}`;
      resolve(origin);
    });
  });
}

/** Local path for the app's private media URL, or null when the URL is already remote. */
function localPath(url: string): string | null {
  if (url.startsWith("ipmedia://")) {
    const parsed = new URL(url);
    return parsed.searchParams.get("path");
  }
  if (url.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(url).pathname.replace(/^\/([a-zA-Z]:)/, "$1"));
    } catch {
      return null;
    }
  }
  // A bare Windows or POSIX path.
  if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith("/")) return url;
  return null;
}

/** The extension a receiver should see, so it can guess the container before it reads a byte. */
function remoteExtension(url: string): string {
  const found = /\.(mp4|m4v|mkv|webm|mov|m3u8|mpd)(?=$|[?#])/i.exec(url);
  return found ? `.${found[1].toLowerCase()}` : ".mp4";
}

/**
 * Returns a URL the receiver can fetch. Local files are published on the LAN behind a fresh token;
 * so are CDN streams, which a TV cannot fetch for itself. Everything else passes through untouched,
 * so IPTV and other ordinary sources still go straight from their host to the TV.
 */
export async function publicMediaUrl(url: string): Promise<string> {
  const file = localPath(url);

  if (!file) {
    if (!needsStreamHeaders(url)) return url;
    const base = await ensureServer();
    const token = `${randomUUID()}${remoteExtension(url)}`;
    published.set(token, { kind: "remote", url });
    return `${base}/${token}`;
  }

  if (!fs.existsSync(file)) throw new Error("That file is no longer on disk.");

  const base = await ensureServer();
  const token = `${randomUUID()}${path.extname(file)}`;
  published.set(token, { kind: "file", file });
  return `${base}/${token}`;
}

/** Revokes every published file and closes the server. Called when a cast ends. */
export function stopMediaServer(): void {
  published.clear();
  if (!server) return;
  try {
    server.close();
  } catch {
    // Already closed.
  }
  server = null;
  origin = "";
}
