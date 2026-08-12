# InfinityPlay

A desktop app for finding and streaming movies, TV shows, anime and live TV, with an
in-app player, offline downloads and configurable subtitles.

Built with Electron, React and TypeScript.

User-facing changes are in [RELEASES.md](RELEASES.md).

## Install

Download the package for your system from the
[latest GitHub release](https://github.com/ELhadratiOth/InfinityPlay/releases/latest).

### Windows

Run the x64 `.exe` installer. Windows builds are unsigned, so SmartScreen shows
*"Windows protected your PC"* on first run — choose **More info → Run anyway**.

### macOS

Choose the `x64` DMG for Intel Macs or the `arm64` DMG for Apple Silicon. Open the DMG
and drag InfinityPlay into Applications.

The first macOS releases are intentionally unsigned. On first launch, Control-click the
app in Finder, choose **Open**, then confirm **Open**. Automatic updates are disabled on
these unsigned builds; download later versions from GitHub Releases. Signing and
notarization are planned once Apple Developer credentials are available.

### Linux

All Linux packages currently target x64 systems.

```bash
# Portable package: no installation required
chmod +x InfinityPlay-*-linux-x64.AppImage
./InfinityPlay-*-linux-x64.AppImage

# Debian, Ubuntu, Linux Mint
sudo apt install ./InfinityPlay-*-linux-x64.deb

# Fedora, RHEL, openSUSE
sudo dnf install ./InfinityPlay-*-linux-x64.rpm

# Arch Linux, Manjaro, EndeavourOS
sudo pacman -U ./InfinityPlay-*-linux-x64.pkg.tar.zst
```

Installed Windows and supported Linux packages can update from GitHub Releases through
the About page.

On Linux, InfinityPlay uses the system `ffprobe` and `ffmpeg` when a Live TV channel or
download uses MPEG-2 or HEVC video that Chromium cannot decode directly. Install FFmpeg
from your distribution when compatibility playback is needed.

Settings can enable or disable hardware acceleration for Electron and FFmpeg. InfinityPlay
uses the installed NVIDIA, AMD, or Intel driver when available and shows Chromium's detected
video-decode status; changing this setting requires an app restart.

## Development

Requires **Node.js 20+**.

Linux packaging also requires `bsdtar` (usually `libarchive-tools`), `rpm`, `xz` and
`zstd`. On Fedora, electron-builder 25's bundled FPM additionally needs
`libxcrypt-compat`; the GitHub Actions Ubuntu runner already has the compatible runtime.

```bash
git clone https://github.com/ELhadratiOth/InfinityPlay.git
cd InfinityPlay
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Hot-reloading dev build |
| `npm start` | Production preview |
| `npm run typecheck` | Type-checks main + preload and the renderer |
| `npm run dist:win` | Build the x64 NSIS installer on Windows |
| `npm run dist:mac` | Build unsigned x64 and arm64 DMG + ZIP packages on macOS |
| `npm run dist:linux` | Build x64 AppImage, DEB, RPM and Arch packages on Linux |
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

## Author

**EL HADRATI Othman** — [github.com/ELhadratiOth](https://github.com/ELhadratiOth) ·
<othmanelhadrati@gmail.com>

## Contributors

- **Tajeddine Bourhim** — [@Scorpiontaj](https://github.com/Scorpiontaj) ·
  <bourhimtajeddine@gmail.com>

## Licence

MIT. Catalog and stream data come from a third-party API; this is an unofficial client and
is not affiliated with or endorsed by its operators.
