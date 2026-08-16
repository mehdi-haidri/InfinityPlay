# Contributing to InfinityPlay

Thanks for taking an interest. This file covers how the project is put together and what a
change needs to clear before it can be merged. Installing and running the app is covered in the
[README](README.md#development); this document assumes you already have it running.

## Getting set up

Node.js 24 or newer, matching the Node that Electron 43 bundles.

```bash
git clone https://github.com/ELhadratiOth/InfinityPlay.git
cd InfinityPlay
npm install
npm run dev
```

Working on the Android app additionally needs a JDK and the Android SDK (Android Studio
supplies both). `npm run cap:sync` builds the shared renderer and copies it into the Android
project; `npm run cap:open` opens that project in Android Studio.

## How the code is arranged

The app is one renderer running in two very different hosts, which is the single most useful
thing to understand before changing anything.

| Directory           | Runs in                     | Notes                                                        |
| ------------------- | --------------------------- | ------------------------------------------------------------ |
| `src/main`          | Electron main process       | Node. Network, filesystem, casting, downloads, updates.        |
| `src/preload`       | Electron preload bridge     | The only channel between renderer and main.                    |
| `src/renderer/src`  | Electron window and Android | Plain React. No Node APIs, no direct filesystem access.        |
| `src/shared`        | Both                        | Types and protocol code with no host-specific imports.         |
| `android/app/src`   | Android                     | Capacitor host plus native plugins in Java.                    |

On the desktop the renderer talks to `src/main` over IPC. On Android there is no main process:
`src/renderer/src/lib/capacitorApi.ts` implements the same `InfinityPlayApi` interface directly
in the WebView, calling native plugins where it needs to leave the browser sandbox.

**Adding or changing anything on that API surface means touching four places**, and forgetting
one produces a build that works on one platform and not the other:

1. `src/shared/types.ts` — the `InfinityPlayApi` interface.
2. `src/main/ipc.ts` — the handler.
3. `src/preload/index.ts` — the bridge method.
4. `src/renderer/src/lib/capacitorApi.ts` — the Android implementation.

Anything genuinely unavailable on a platform should say so in its return value rather than
silently resolving with a falsy result. A control that appears to work and does nothing is worse
than one that explains itself.

## Before you open a pull request

Run what CI runs, in this order. `.github/workflows/release.yml` gates every release on the
first three.

```bash
npm run typecheck   # main + preload, then the renderer
npm test            # vitest
npm run build
```

There is no linter; the type-checker and review are the gates.

Verify Android changes on a device or emulator. Java is not covered by `npm run typecheck`, so a
Java change that has not been compiled has not been checked at all.

## Code conventions

Match the surrounding code — naming, structure, and comment density. A few habits are
load-bearing here:

- **Comments explain why, not what.** The code already says what it does. Comments earn their
  place by recording the constraint that made the code look strange: a device that refuses a
  request, a header a CDN requires, a measurement that ruled out the obvious approach. Several
  bugs in this codebase were fixed twice because the reason was not written down the first time.
- **Prefer a measurement to an assumption**, and put the number in the comment when it is the
  justification.
- **Name the failure in user-facing strings.** Error text is read by someone trying to watch a
  film, not by a developer reading a stack trace.
- No new abbreviations in identifiers. Existing ones stay.

## Things that will surprise you

Real constraints that are easy to trip over, each of which cost a debugging session:

- **The stream CDN rejects ordinary clients.** It answers `428` to anything not sending the
  app's substitute User-Agent (`src/main/stream-headers.ts`). Anything that fetches media —
  playback, downloads, casting — has to go through a path that sets it. A television or a system
  download manager fetching the URL directly will fail.
- **Adaptive and progressive releases are not interchangeable.** A DASH manifest's segments are
  signed by the app's own request hook, so nothing outside the app can play one. Casting and
  Android downloads deliberately pick a progressive release instead.
- **Chromecast enforces CORS on side-loaded subtitle tracks.** Anything serving a caption track
  to a receiver must answer preflight `OPTIONS` and send the allow headers, or the subtitle
  button appears on the TV with nothing behind it.
- **The Android WebView cannot talk to UPnP devices.** A SOAP call carries a `SOAPAction` header,
  so the browser preflights it, and a television answers UPnP rather than CORS. Those requests go
  through a native plugin method instead.
- **Android has no FFmpeg.** Anything that depends on remuxing is desktop-only and needs an
  honest alternative on mobile.
- **The renderer is one codebase across phone, tablet, desktop, and TV.** Device shape comes from
  `document.documentElement.dataset.device` (see `src/renderer/src/lib/device.ts`). Check it
  before assuming a pointer, a keyboard, or a screen size.

## Reporting a bug

Include the platform and how you installed the app (Windows installer, AppImage, Android APK,
Android TV), the version from the About page, and what you expected instead. For playback or
casting problems, the title and quality involved, and the exact text of any message the app
showed, are usually what makes the report actionable.

## Licence

By contributing you agree that your contributions are licensed under the
[MIT Licence](LICENSE) that covers this project.
