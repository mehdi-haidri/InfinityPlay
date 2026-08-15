import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { app, BrowserWindow, protocol, shell, session } from "electron";
import { registerIpcHandlers } from "./ipc";
import { initUpdater } from "./updater";
import { initDownloads } from "./downloads";
import { initCast, stopCast } from "./cast";
import { installStreamSigner } from "./streams";
import { STREAM_HOST_FILTER, STREAM_USER_AGENT } from "./stream-headers";
import { LIVE_TRANSCODE_SCHEME, registerLiveTranscodeProtocol } from "./live";
import { getConfig } from "./store";

const isDev = !app.isPackaged;

// Electron must receive this before `ready`. FFmpeg reads the same preference when it
// starts compatibility playback. Changing it in Settings therefore offers a restart.
if (!getConfig().hardwareAcceleration) app.disableHardwareAcceleration();

/**
 * The renderer is served from `file://`, and Chromium refuses to load `file://`
 * subresources from a file-origin document — a downloaded video fails with "the source
 * rejected the request". Rather than switching off `webSecurity`, local media is served
 * over a private scheme that streams the file and forwards Range headers, which the
 * `<video>` element needs for seeking.
 */
const LOCAL_MEDIA_SCHEME = "ipmedia";

// `corsEnabled` is what lets the renderer read these with fetch/XHR at all. Without it
// Chromium rejects the request before the handler runs, whatever headers it would return
// — which blocks dash.js from loading a locally repaired manifest.
protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  {
    scheme: LIVE_TRANSCODE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
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
  ".mpd": "application/dash+xml",
};

/**
 * The renderer is a `file://` page, so its origin is `null` and every cross-scheme read is
 * a CORS request. Without this, `fetch`/XHR against this scheme fails outright — which is
 * how dash.js loads a manifest. The scheme only ever serves files this app wrote or was
 * pointed at, and only this app's own window can reach it.
 */
const LOCAL_MEDIA_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
};

/**
 * Serves the file with byte-range support. Range is not optional here: without a 206 and
 * a `Content-Range`, `<video>` treats the source as unseekable and the scrub bar does
 * nothing, which is why this is handled explicitly rather than delegated to `net.fetch`.
 */
function registerLocalMediaProtocol(): void {
  protocol.handle(LOCAL_MEDIA_SCHEME, async (request) => {
    const requested = new URL(request.url).searchParams.get("path");
    if (!requested) return new Response("Missing path", { status: 400 });

    // Resolve symlinks as well as `..`: a path that merely starts with Downloads is not enough
    // (for example, `Downloads-old`), and a symlink inside Downloads may point anywhere.
    let target: string;
    try {
      target = await fs.promises.realpath(requested);
      const roots = await Promise.all(
        [app.getPath("downloads"), app.getPath("temp"), app.getPath("userData")].map(async (root) =>
          fs.promises.realpath(root).catch(() => path.resolve(root)),
        ),
      );
      const allowed = roots.some((root) => {
        const relative = path.relative(root, target);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      });
      if (!allowed) return new Response("Forbidden", { status: 403 });
    } catch {
      return new Response("Not found", { status: 404 });
    }

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
          ...LOCAL_MEDIA_CORS,
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
          ...LOCAL_MEDIA_CORS,
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
      sandbox: true,
      /**
       * On in every packaged build. Off only under `npm run dev`.
       *
       * The stream CDN returns `Access-Control-Allow-Origin` only when a request carries
       * an `Origin`, and sends no `Vary: Origin`, so CloudFront serves one cached variant
       * to everyone — often the one without the header. A packaged build never notices:
       * its page is `file://`, whose opaque origin skips the check. The dev server gives
       * the renderer a real `http://localhost` origin, so the same streams fail CORS,
       * intermittently, depending on what happens to be in the CDN cache.
       */
      webSecurity: app.isPackaged,
    },
  });

  window.once("ready-to-show", () => window.show());

  // External links open in the user's browser, never inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // Malformed and non-web URLs stay blocked inside the app shell.
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const current = window.webContents.getURL();
    if (url !== current) event.preventDefault();
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
 * image and API traffic untouched. The UA itself lives in `stream-headers` because the
 * cast proxy has to send the identical one.
 */
function rewriteMediaRequestHeaders(): void {
  const filter = { urls: STREAM_HOST_FILTER };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers: Record<string, string> = { ...details.requestHeaders };
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      // `Origin` is deliberately kept. The CDN only answers with
      // `Access-Control-Allow-Origin` when the request carries an Origin, so stripping it
      // made every response fail the browser's CORS check — invisible in a packaged build,
      // where the page is `file://` and exempt, but it breaks all adaptive playback under
      // `npm run dev`, and only intermittently, since a cached response may already carry
      // the header from an earlier request that kept it.
      if (lower === "referer" || lower.startsWith("sec-fetch-")) {
        delete headers[name];
      }
      if (lower === "user-agent") delete headers[name];
    }
    headers["User-Agent"] = STREAM_USER_AGENT;
    callback({ requestHeaders: headers });
  });

}

/**
 * A second copy of the app shares this one's user-data directory, and the two then race over the
 * same disk-cache index and download ledger — which surfaces as
 * "Failed to write the temporary index file" and, worse, silently truncated download records.
 * Only one instance runs; launching again focuses the window that is already open.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  rewriteMediaRequestHeaders();
  installStreamSigner();
  registerLocalMediaProtocol();
  registerLiveTranscodeProtocol();
  registerIpcHandlers(() => mainWindow);
  mainWindow = createWindow();
  initDownloads(() => mainWindow);
  initUpdater(() => mainWindow);
  initCast((session) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("cast:session", session);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

// Leaving a cast running would keep the LAN file server listening after the window is gone.
app.on("before-quit", () => {
  void stopCast();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
