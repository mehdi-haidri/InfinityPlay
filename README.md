# InfinityPlay

[![Release](https://github.com/ELhadratiOth/InfinityPlay/actions/workflows/release.yml/badge.svg)](https://github.com/ELhadratiOth/InfinityPlay/actions/workflows/release.yml)

A desktop app for finding and streaming movies, TV shows, anime and live TV, with an
in-app player, offline downloads and configurable subtitles.

Built with Electron, React and TypeScript.

User-facing changes are in [RELEASES.md](RELEASES.md).

## Install

Download the package for your system from the
[latest GitHub release](https://github.com/ELhadratiOth/InfinityPlay/releases/latest).

### Windows

Choose `x64` for Intel/AMD PCs or `arm64` for Windows on ARM (Snapdragon / Surface Pro). Run the `.exe` installer. Windows builds are unsigned, so SmartScreen shows
_"Windows protected your PC"_ on first run — choose **More info → Run anyway**.

### macOS

Choose the `x64` DMG for Intel Macs or the `arm64` DMG for Apple Silicon (M1, M2, M3, M4). Open the DMG
and drag InfinityPlay into Applications.

The first macOS releases are intentionally unsigned. On first launch, Control-click the
app in Finder, choose **Open**, then confirm **Open**. Automatic updates are disabled on
these unsigned builds; download later versions from GitHub Releases. Signing and
notarization are planned once Apple Developer credentials are available.

### Linux

Linux packages are available for both `x64` (x86_64) and `arm64` (aarch64 / Raspberry Pi / ARM PCs).

```bash
# Portable package: no installation required (replace x64 with arm64 on ARM systems)
chmod +x InfinityPlay-*-linux-*.AppImage
# AppImage cannot install host dependencies; install FFmpeg first:
# Fedora: sudo dnf install ffmpeg
# Ubuntu/Debian: sudo apt install ffmpeg
# Arch: sudo pacman -S ffmpeg
./InfinityPlay-*-linux-*.AppImage

# Debian, Ubuntu, Linux Mint
sudo apt install ./InfinityPlay-*-linux-*.deb

# Fedora, RHEL, openSUSE
sudo dnf install ./InfinityPlay-*-linux-*.rpm

# Arch Linux, Manjaro, EndeavourOS
sudo pacman -U ./InfinityPlay-*-linux-*.pkg.tar.zst
```

DEB, RPM, and Arch packages declare `ffmpeg` as an installation dependency; it also
provides `ffprobe`. InfinityPlay uses these maintained distribution tools on Linux and
does not ship obsolete static Linux binaries. AppImage users install FFmpeg once because
the portable format cannot install host packages.

### Android phones, tablets, and TV

The same universal APK adapts to touch phones, tablets, and D-pad Android TV devices.
Download `InfinityPlay-*-android-universal.apk` from the latest release. On phones and
tablets, allow installation from your browser or file manager when Android asks. On TV,
send the APK with ADB or a trusted file-transfer app, install it, then launch InfinityPlay
from the TV apps row. The TV interface requires only D-pad, Select, and Back.

Release APKs are signed. Android accepts an update over an existing installation only when
both APKs use the same signing key; keep that key private and backed up.

Installed Windows builds, AppImages, and Android APK installations can update from GitHub Releases through About or automatic in-app update prompts.
DEB, RPM, and Arch builds are updated through their package manager.

## FFmpeg

Windows and macOS packages ship FFmpeg and FFprobe beside the app. Linux intentionally
uses `ffmpeg` and `ffprobe` from the system `PATH`; install the distro package shown above
when using AppImage. The DEB, RPM, and Arch installers request it automatically.

They are needed for:

- **Downloading 720p and 1080p.** Those qualities are published only as adaptive (DASH)
  streams — a manifest of segments rather than one file. Playing them needs nothing, but
  saving one means remuxing the segments into an MP4. Sources marked _Adaptive_ take this
  path; entries showing a file size are direct downloads.
- **Live TV and downloads** whose MPEG-2 or HEVC video Chromium cannot decode directly.
- **Player timeline thumbnails**, generated on demand and cached in memory.

When the tools are unavailable, adaptive downloads are marked as unavailable and a season
download takes the best direct file instead of failing silently.
Cast profiles use the MovieBox catalog for verified credits and may request an optional
English biography from Wikipedia; movies and series still appear if that service is offline.

## Free and legal sources

InfinityPlay separates source provenance instead of treating every public URL as verified:

- **Free Library** browses the Library of Congress National Screening Room and freely
  licensed Wikimedia Commons video. Each card keeps its archive, creator, and rights label.
  A small public-domain Library of Congress selection remains available when its JSON API
  temporarily challenges automated requests.
- **Verified — beIN SPORTS XTRA** is the free FAST channel delivered through beIN's Amagi
  distribution feed. It is not a way to unlock premium beIN channels.
- **IPTV-org** and **Free-TV** entries are marked *Community link*. InfinityPlay removes
  non-XTRA beIN-branded entries from those lists because a community submission is not
  evidence that a premium feed is authorized.
- Focused IPTV-org playlists for movies, series, Morocco, French, sports, Arabic, and news
  are included alongside the full directory.

The **Watch legally** panel can show free, ad-supported, subscription, rental, and purchase
availability by region. Create a TMDB API read token, enter it in Settings, and choose the
two-letter region code. Availability is supplied by JustWatch through TMDB; InfinityPlay
opens the provider page and does not proxy or bypass the service.

### Your IPTV service and program guide

Settings accepts ordinary M3U/M3U8 playlists, an optional XMLTV guide URL, and Xtream API
credentials for a service you are authorized to use. Xtream credentials and the TMDB token
are stored only in the app's local configuration; they are never committed or included in
release packages. Prefer HTTPS providers, and do not reuse an important password.

XMLTV programmes are matched through `tvg-id`. Xtream sources use their own XMLTV endpoint.
The Live TV page shows the current programme when guide data exists and labels every channel
as **Verified free**, **Community link**, or **Your provider**.

Settings can enable or disable hardware acceleration for Electron and FFmpeg. InfinityPlay
uses the installed NVIDIA, AMD, or Intel driver when available and shows Chromium's detected
video-decode status; changing this setting requires an app restart.

## Development

Requires **Node.js 24+**, matching the Node version Electron 43 bundles.

Linux packaging also requires `bsdtar` (usually `libarchive-tools`), `rpm`, `xz` and
`zstd`. On Fedora, electron-builder 25's bundled FPM additionally needs
`libxcrypt-compat`; the GitHub Actions Ubuntu runner already has the compatible runtime.

```bash
git clone https://github.com/ELhadratiOth/InfinityPlay.git
cd InfinityPlay
npm install
npm run dev
```

| Command                   | What it does                                              |
| ------------------------- | --------------------------------------------------------- |
| `npm run dev`             | Hot-reloading dev build                                   |
| `npm start`               | Production preview                                        |
| `npm run typecheck`       | Type-checks main + preload and the renderer               |
| `npm run cap:sync`        | Builds the shared renderer and syncs the Android project  |
| `npm run dist:win`        | Build the x64 NSIS installer on Windows                   |
| `npm run dist:mac`        | Build unsigned x64 and arm64 DMG + ZIP packages on macOS  |
| `npm run dist:linux`      | Build x64 AppImage, DEB, RPM and Arch packages on Linux   |
| `npm run release:current` | Build and publish the current platform (needs `GH_TOKEN`) |

## Releases

The full release is built by `.github/workflows/release.yml`. Push a tag that exactly
matches the package version, for example `v0.2.0`. GitHub Actions type-checks and builds
the app, packages it on native Windows, macOS and Linux runners, then creates or updates
one public GitHub Release with all installers and updater metadata.

### Enabling signed macOS releases later

Unsigned mode is explicit in `electron-builder.yml`. To enable trusted distribution:

1. Join the Apple Developer Program and export a **Developer ID Application** certificate.
2. Remove `identity: null`, set `hardenedRuntime: true`, and set `notarize: true` under
   `mac` in `electron-builder.yml`.
3. Add `CSC_LINK` and `CSC_KEY_PASSWORD` to the macOS workflow. For notarization, add
   either App Store Connect API-key credentials (`APPLE_API_KEY`, `APPLE_API_KEY_ID`,
   `APPLE_API_ISSUER`) or Apple ID credentials (`APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) as GitHub Actions secrets.
4. Remove the unsigned-macOS guard in `src/main/updater.ts` only after a signed and
   notarized update has been verified end to end.

### Android release signing

The Android release job publishes an APK only when all four signing secrets are present.
When they are missing or incomplete, the workflow still tests, lints, and assembles the
debug Android build so Windows, macOS, and Linux releases are not blocked, but it does
not attach an unsafe debug or unsigned APK. Configure these GitHub Actions secrets before
tagging a release that must include Android:

- `ANDROID_KEYSTORE_BASE64`: the release JKS file encoded with `base64 -w0`.
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password.
- `ANDROID_KEY_ALIAS`: the signing-key alias.
- `ANDROID_KEY_PASSWORD`: the signing-key password.

Keep the original JKS backed up outside GitHub. Losing it prevents in-place updates for
users who installed an earlier signed APK.

All four secrets are one contract: setting only some of them intentionally follows the
unsigned-validation path. The Android job prints a warning explaining why no APK was
published.

## Project layout

```text
src/
  shared/types.ts   models shared by all three processes
  main/             network, disk, sessions, protocols
  preload/index.ts  the contextBridge surface
  renderer/src/     React UI (pages, components, zustand store)
```

**Every catalog call runs in the main process.** The signed requests set headers a renderer
is not allowed to send, so they cannot move to the UI side. `contextIsolation` stays on and
`nodeIntegration` off.

IPC handlers return a `Result` instead of rejecting, and the renderer unwraps with
`unwrap()`.

## Contributing

Issues and pull requests are welcome.

- Run `npm run typecheck` before submitting — there is no test suite, so the type checker
  and manual verification stand in for one.
- Check behaviour against the running app. The catalog API is undocumented and changes
  without notice; several past bugs were upstream changes rather than code errors.
- Match the surrounding style. TypeScript throughout, 2-space indentation.

### Notes on the catalog API

Worth knowing before debugging something that "returns nothing":

- `subject-api/resource` returns an empty list — use `resource/v2`.
- `se`/`ep` parameters are accepted and ignored, so episode lookup pages through an ordered
  list.
- 720p and 1080p exist only as DASH; the progressive rows for those qualities have empty
  links.
- The stream CDN answers 428 to browser-like `User-Agent` headers, so it is rewritten for
  media hosts only.

### Source policy

- Do not submit premium-channel restreams, extracted session tokens, DRM workarounds,
  credential dumps, Stalker/MAG device cloning, or torrent-backed catalog providers.
- A source may be called *official* only when it is published by the rights holder or a
  named authorized distributor. Community directories stay visibly marked as community.
- User-supplied IPTV access remains user-owned configuration. Never put real IPTV, TMDB,
  signing, or release credentials in source control.

## Authors & Developers

- **EL HADRATI Othman** — Lead Developer · [github.com/ELhadratiOth](https://github.com/ELhadratiOth) · <othmanelhadrati@gmail.com>
- **Tajeddine Bourhim** — Co-Author & Core Developer · [github.com/Scorpiontaj](https://github.com/Scorpiontaj) · <bourhimtajeddine@gmail.com>

## Licence

MIT. Catalog and stream data come from a third-party API; this is an unofficial client and
is not affiliated with or endorsed by its operators.

Windows and macOS packages bundle unmodified FFmpeg binaries, which carry their own
licence (GPL/LGPL depending on the build) and remain the work of the
[FFmpeg project](https://ffmpeg.org). They run as separate child processes, not linked
into the app. Linux uses the distribution's separately installed FFmpeg package.
