import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { app, BrowserWindow, protocol, shell, session } from "electron";
import { registerIpcHandlers } from "./ipc";
import { initUpdater } from "./updater";
import { initDownloads } from "./downloads";
import { installStreamSigner } from "./streams";

const isDev = !app.isPackaged;

/**
 * The renderer is served from `file://`, and Chromium refuses to load `file://`
 * subresources from a file-origin document — a downloaded video fails with "the source
 * rejected the request". Rather than switching off `webSecurity`, local media is served
 * over a private scheme that streams the file and forwards Range headers, which the
 * `<video>` element needs for seeking.
 */
const LOCAL_MEDIA_SCHEME = "ipmedia";

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const MEDIA_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".vtt": "text/vtt",
};

/**
 * Serves the file with byte-range support. Range is not optional here: without a 206 and
 * a `Content-Range`, `<video>` treats the source as unseekable and the scrub bar does
 * nothing, which is why this is handled explicitly rather than delegated to `net.fetch`.
 */
function registerLocalMediaProtocol(): void {
  protocol.handle(LOCAL_MEDIA_SCHEME, async (request) => {
    const target = new URL(request.url).searchParams.get("path");
    if (!target) return new Response("Missing path", { status: 400 });

    let size: number;
    try {
      size = (await fs.promises.stat(target)).size;
    } catch {
      return new Response("Not found", { status: 404 });
    }

    const contentType = MEDIA_MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
    const range = request.headers.get("Range");
    const match = range?.match(/bytes=(\d*)-(\d*)/);

    if (!match) {
      return new Response(Readable.toWeb(fs.createReadStream(target)) as ReadableStream, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
        },
      });
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (Number.isNaN(start) || start >= size || end < start) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    return new Response(
      Readable.toWeb(fs.createReadStream(target, { start, end })) as ReadableStream,
      {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
        },
      },
    );
  });
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#08090d",
    icon: path.join(__dirname, "../../build/icon.png"),
    // Keep the native macOS title bar. The previous hidden inset placed the traffic-light
    // controls over the sidebar brand and left no reliable drag region.
    titleBarStyle: "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  // External links open in the user's browser, never inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
}

/**
 * The stream CDN answers 428 to any Chrome-looking User-Agent, so a plain <video>
 * request fails even though the signed URL is valid. Verified behaviour: the same URL
 * returns 206 with the app's own Android UA, or with any non-browser UA. Rewrite the UA
 * (and drop the browser-only headers that go with it) for the media hosts only, leaving
 * image and API traffic untouched.
 */
const STREAM_USER_AGENT =
  "com.community.oneroom/50020042 (Linux; U; Android 13; en_US; 2201117TY; " +
  "Build/TQ2A.230405.003; Cronet/135.0.7012.3)";

function rewriteMediaRequestHeaders(): void {
  const filter = { urls: ["*://*.hakunaymatata.com/*"] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers: Record<string, string> = { ...details.requestHeaders };
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      if (lower === "origin" || lower === "referer" || lower.startsWith("sec-fetch-")) {
        delete headers[name];
      }
      if (lower === "user-agent") delete headers[name];
    }
    headers["User-Agent"] = STREAM_USER_AGENT;
    callback({ requestHeaders: headers });
  });
}

app.whenReady().then(() => {
  rewriteMediaRequestHeaders();
  installStreamSigner();
  registerLocalMediaProtocol();
  registerIpcHandlers(() => mainWindow);
  mainWindow = createWindow();
  initDownloads(() => mainWindow);
  initUpdater(() => mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
