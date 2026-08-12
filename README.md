# InfinityPlay

A desktop app for finding and streaming movies, TV shows, anime and live TV, with an
in-app player, offline downloads and configurable subtitles.

Built with Electron, React and TypeScript.

User-facing changes are in [RELEASES.md](RELEASES.md).

## Install

Download the latest installer from the
[releases page](https://github.com/ELhadratiOth/InfinityPlay/releases) and run it. The app
updates itself from then on.

Windows builds are unsigned, so SmartScreen shows *"Windows protected your PC"* on first
run — **More info → Run anyway**.

## Development

Requires **Node.js 20+**.

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
| `npm run dist:win` | Packaged installer (also `dist:mac`, `dist:linux`) |
| `npm run release` | Build and publish to GitHub Releases (needs `GH_TOKEN`) |

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

## Licence

MIT. Catalog and stream data come from a third-party API; this is an unofficial client and
is not affiliated with or endorsed by its operators.
