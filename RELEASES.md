# Release Notes

InfinityPlay checks for updates on launch and asks before downloading one. You can also check on demand from the **About** page.

---

## 0.3.0 (Latest Update)

### Updates you control
- Updates are no longer fetched behind your back. A launch-time check now **offers** the update and waits: accept it, or decline and take it later from **About**.
- Added **pause** and **resume** for an update in progress, plus a **Cancel** that returns the update to the offer state.
- When a download finishes you are asked whether to **restart now or later**, both as a toast and on the **About** page. Choosing later installs it the next time you close the app.
- Removed every "view the releases page" link from the update card. Updates are downloaded and installed inside the app; builds that cannot replace themselves say so plainly instead of sending you to a browser.
- Toasts can now carry actions, and a repeated notification about the same subject replaces the previous card instead of stacking.

### Mobile navigation
- Replaced the bottom-bar overflow sheet with a dedicated **More** page: destinations grouped under **Browse** and **System**, each with a description, live counts for Continue watching and Favorites, and the app version in its header.
- The bottom bar carries **Home**, **Search**, **Live TV**, **Downloads** and **More**. The More tab stays highlighted while you are inside any destination it owns.
- Redrew the active-tab indicator as a fixed 52x28 pill behind the icon. The previous indicator was sized from the icon plus padding, which produced a blob that crowded the label.
- Downloads shows a badge on its icon while a transfer is running.

### Mobile layout
- Fixed the search field overflowing the top bar on every phone width. The field and its input could not shrink below their intrinsic minimum, pushing the row past the screen edge.
- Search suggestions now truncate long titles instead of pushing the year and media type out of view, and the phone placeholder drops the meaningless `Ctrl+K` hint.
- The featured poster is now shown sharp as the phone hero backdrop. It was previously blurred and dimmed to near-black, which read as a missing image.
- Details actions stay on one line: **Play** and **Download** keep their labels while Favorite and Remove progress collapse to icons.
- Fixed the **Add IPTV login** button rendering outside its panel; the form's fixed column widths exceeded the panel and pushed the button out.
- Fixed poster art sitting 6px inset from its own card, caused by the browser's default button padding.

### Favorites
- Added a heart to every poster across the app, so a title can be saved without opening it. It fills when saved and animates on the press.

### Downloads
- **Pausing an adaptive download now works on Windows.** It previously did nothing at all: pausing an adaptive transfer means suspending its FFmpeg process, which needs POSIX signals that Windows does not provide to Node. Suspend and resume now go through the same `ntdll` entry points a native module would use.
- Pause and resume now report why they refused, rather than leaving a control that looks like it worked.
- A suspended transfer is terminated when the app closes, instead of remaining in the process list holding its output file.

### Stability
- InfinityPlay now runs as a single instance. A second copy shared the same user-data directory, and the two raced over the disk cache — the source of repeated `Failed to write the temporary index file` errors — and over the download ledger. Launching again focuses the window already open.

### Android
- Added `viewport-fit=cover`, without which the safe-area insets were always zero. The bottom bar rendered under the gesture bar and the top bar under the status bar.
- Fixed page content running underneath the bottom bar once a status-bar inset is present. The reserved space is now derived from the bar's real height at any inset.

### Validation
- Passed TypeScript checking across the Electron main, preload, renderer, and Capacitor provider paths, plus a full production renderer build.
- Measured the phone layout at 320, 360, 390, 412 and 430 px: no top-bar or page overflow, and the active-tab pill fits inside its tab at every width.
- Verified Windows process suspension against a live process: output frozen while suspended and resumed afterwards.
- Verified single-instance behaviour by log comparison — nine disk-cache errors with two instances running, none with one.
- Verified update toasts render their actions, fire the chosen handler, and replace rather than stack.
- The update download, pause, and resume flow itself is **not** verified end to end: development builds report updates as unsupported because there is no installer to replace, so the flow needs a packaged build with a newer published release to exercise.

---

## 0.2.9

### Free media and legal availability
- Added a dedicated **Free Library** for Library of Congress National Screening Room films and freely licensed Wikimedia Commons video, including archive rights and creator labels.
- Added resilient curated Library of Congress fallbacks for temporary API challenges and selected streamable Wikimedia renditions instead of multi-gigabyte originals.
- Added regional legal watch availability through TMDB and JustWatch, covering free, ad-supported, subscription, rental, and purchase options without proxying protected services.

### Live TV sources, beIN, and program guides
- Added the authorized free **beIN SPORTS XTRA** FAST feed while explicitly filtering non-XTRA beIN-branded entries from community playlists.
- Added focused IPTV-org playlists for movies, series, Morocco, and French alongside the existing all-channel, Arabic, sports, and news lists.
- Added visible **Verified free**, **Community link**, and **Your provider** provenance labels.
- Added optional XMLTV program guides matched by `tvg-id`, with current-programme titles on channel cards.
- Added user-owned Xtream IPTV accounts, live categories, channel logos, and provider XMLTV support. Credentials remain local and are never bundled with InfinityPlay.

### Validation
- Passed TypeScript checking for Electron, preload, renderer, and Capacitor provider paths.
- Passed the Android Studio/Gradle unit tests, debug lint, and debug APK build; Android version metadata is synchronized as `0.2.9` (`versionCode 209`).
- Inspected the Android build on the `Medium_Phone` emulator and checked startup logs for fatal crashes.

### Android About page
- Added an Android-specific build panel with the native app version and version code.
- Removed Electron, Node, Chromium, GPU, and FFmpeg rows from Android instead of displaying desktop-only or unavailable values.
- Replaced the desktop auto-update status on Android with clear manual APK update guidance and a link to GitHub Releases.

---

## 0.2.8

### Desktop Live TV reliability
- Fixed the desktop/Electron Live TV page failing with `localStorage is not defined` before IPTV channels could load.
- Added a runtime-safe playlist cache: Electron uses an in-process cache, while Android and browser builds continue using browser storage.
- Verified M3U parsing and cache reuse in the same Node.js environment used by Electron's main process, including a representative **2M** channel entry.
- Protected Android release keystores and local signing credentials with enforced Git ignore rules.

## 0.2.7

### Release workflow reliability
- Fixed release tags failing when Android signing secrets are unavailable. CI now runs the complete Android test, lint, and debug-build validation while skipping only the publishable APK.
- Signed Android publishing remains enabled when all four signing secrets are configured; missing or partial credentials can no longer block the Windows, macOS, and Linux release jobs.
- Added decoded-keystore validation and ensured that CI never uploads an unsigned or debug APK as a public release asset.

### Richer Android and cross-platform playback controls
- Added Android Picture-in-Picture support with a native **PiP** action, 16:9 mini-player sizing, uninterrupted playback when the activity enters PiP, and automatic hiding of full controls inside the floating window.
- Added native Android audio-language discovery and switching based on the tracks actually exposed by HLS, DASH, or the selected file. The saved preferred audio language is applied when a matching track is available.
- Added a consolidated native playback options panel for audio, subtitles, playback speed, and fit/fill/stretch picture modes without overcrowding the main controller.
- Added native headset and hardware media-key handling for play, pause, 10-second forward, and 10-second rewind.
- Added HLS and DASH audio-track discovery and language switching to the desktop/mobile web player, with a dedicated language control that only appears when multiple tracks exist.
- Enabled browser Picture-in-Picture on supported phones instead of hiding it by device class.
- Added Media Session metadata and actions for headset keys, desktop media overlays, and supported lock-screen controls.
- Added a screen wake lock during active web playback and automatic release while paused or hidden to prevent accidental battery drain.
- Made dense phone secondary controls horizontally scrollable, keeping every advanced action touch-accessible without shrinking targets below a usable size.

### Final performance, lifecycle, and security pass
- Split the large HLS/DASH player engine into an on-demand renderer chunk. Home and catalog screens now load an approximately **831 KB** main renderer instead of eagerly parsing the previous approximately **3.2 MB** combined bundle; the player chunk loads only when playback opens.
- Replaced subtitle polling five times per second with native `cuechange` events, removing continuous caption work while playback is paused or no cue changes.
- Added Media Session playback-state and bounded position updates, keeping supported lock-screen and operating-system seek surfaces synchronized without updating them on every video frame.
- Removed the Android main activity's permanent keep-awake flag. Browsing the catalog can now dim normally while the native player and web wake lock still keep the screen awake only during playback.
- Fixed native Android lifecycle resume so backgrounding and restoring a non-PiP player continues from the most recently reached timestamp instead of the original launch position.
- Enabled Media3 audio-focus management and automatic noisy-output handling, so another audio app can duck/pause playback and disconnecting headphones does not continue loudly through the speaker.
- Added a defensive native-player release during activity destruction to avoid retaining decoders after unusual lifecycle exits.
- Restricted Electron external navigation and shell opening to validated HTTP/HTTPS URLs and blocked renderer-driven top-level navigation away from the app shell.
- Enabled Chromium renderer sandboxing while retaining the context-isolated preload bridge, reducing the impact of a renderer compromise without exposing Node.js APIs.
- Aligned the Linux desktop filename with Electron's app ID/WM class so launchers group the running window under the correct InfinityPlay icon.

### Android Movie & Series Playback
- Added a dedicated Android Media3 player for Movies and Series, bypassing WebView's `MEDIA_ELEMENT_ERROR: Format error` on HEVC/H.265 releases while leaving IPTV on its separate live-stream path.
- Added native seeking, 5/15-second skip controls, playback speed, subtitle selection, track settings, buffering feedback, immersive landscape playback, and predictive-back support.
- Native playback now returns the exact position and duration to InfinityPlay history, and reopening the title resumes from that saved position.
- Automatic quality now selects the highest available source, so a title with a 1080p release displays **Play · 1080p** instead of being capped at 480p on Android.
- Passed every Movie/Series release into the Android bridge and added a native quality picker for adaptive 1080p/720p/480p and direct-file sources; switching keeps the current timestamp.
- Prefer progressive movie and episode sources on Android phones, tablets, and TV devices so the native player can open a signed file directly when available.
- Fetch signed DASH manifests through Capacitor's native HTTP transport to avoid Android WebView CORS failures.
- Automatically retry a failed Android movie or episode with an alternate progressive source while preserving the playback timestamp.
- Keep the screen awake during Android playback and retain immersive landscape behavior on Android TV.
- Added Android-friendly player options for playback speed, picture fit/fill/stretch, sleep timers, orientation, captions, quality, episode navigation, and media keys.

### Live TV Reliability
- Fixed Android `manifestLoadError` failures by routing HLS channels through Android's native media pipeline instead of WebView `hls.js` requests that are subject to CORS.
- Enabled user-selected HTTP IPTV manifests and segments inside the HTTPS Capacitor shell, which is required by many public M3U sources.
- Added bounded manifest, level, fragment, network, and media recovery for desktop HLS, followed by a clear offline/expired-channel error when retries are exhausted.
- Preserved `http-referrer`, `http-user-agent`, and matching `#EXTVLCOPT` directives from M3U playlists, then applied them to native manifests, renditions, and media segments.
- Expanded the Android Media3 path to HLS, DASH, progressive files, and RTSP. This fixes header-protected IPTV channels such as **2M Monde**, whose manifest returned HTTP 403 without its broadcaster headers.

### Playback Continuity & Desktop Performance
- Quality changes now capture and persist the exact current timestamp before switching sources, then resume at that timestamp instead of restarting from the beginning.
- Switching representations inside one DASH manifest no longer tears down and recreates the player.
- Desktop DASH playback keeps adaptive bitrate recovery enabled, uses longer long-form buffers, and avoids buffer-discarding fast switches to reduce recurring stalls.
- VOD HLS now uses a larger forward/back buffer while IPTV retains its low-latency settings.
- Added automatic alternate-quality recovery and clearer inline playback errors.

### Favorites
- Added persistent Favorites storage on Electron and Capacitor Android.
- Added a dedicated **Favorites** destination with **All**, **Movies**, and **Series** filters.
- Added Favorite/Favorited controls to movie and series details, with removal directly from the Favorites grid.

### Subtitle Reliability
- Replaced the pointer-draggable caption overlay with stable **Top**, **Middle**, and **Bottom** positions.
- Subtitle position is now stored with the rest of the caption appearance preferences and no longer follows the mouse after selection.
- Improved responsive caption sizing, safe widths, backgrounds, font families, edge styles, and reset behavior.

### Phone, Tablet & Android TV Interface
- Added explicit phone, tablet, desktop, and TV device profiles rather than relying only on viewport width.
- Added responsive bottom navigation and a mobile More sheet, touch-sized controls, safe-area handling, and phone/tablet grid improvements.
- Added Android TV D-pad spatial navigation, focus restoration, overscan-safe layouts, larger 10-foot controls, a Leanback launcher entry, and a TV banner.
- Improved Android Back behavior so player menus close before playback exits.
- Added real Android `DownloadManager` downloads with progress, cancellation, persistence, and file opening.
- Fixed Android touch scrolling by restoring a viewport-constrained main scroll container, explicit vertical touch panning, momentum scrolling, and native WebView nested scrolling.
- Reworked the first Home viewport on phones: bounded dynamic hero height, mobile-centered artwork, balanced title wrapping, two-column actions, correctly positioned carousel indicators, and a responsive loading skeleton.

### Android Packaging & Release Engineering
- Synchronized app, lockfile, Gradle, and APK metadata at version **0.2.7**.
- Added optional Android hardware declarations for universal phone, tablet, and TV installation.
- Added conditional signed release APK generation in GitHub Actions and documented the required signing secrets.
- Added adaptive monochrome launcher icons, dark system bars, post-splash theming, and safer WebView settings.

### Validation
- Passed TypeScript type checking and renderer production builds.
- Passed Capacitor synchronization plus Android unit tests, lint, and debug APK assembly.
- Verified responsive phone, tablet, TV, D-pad, mobile menu, overflow, and landscape player behavior in automated browser checks.
- Reproduced the reported Amazing Spider-Man 2 480p failure in an Android Studio API 37 phone emulator, confirmed WebView rejected the HEVC source, then verified the same signed release plays through Android's native HEVC decoder with a detected duration of 2:21:35 and no playback exception.
- Verified in the API 37 Android emulator that the same title resolves to 1080p, exposes all five source choices in the native quality picker, and plays at 1080p.
- Verified the live 2M Monde manifest returns 403 without its playlist headers and 200 with them, then confirmed native HLS playback fetches its renditions and `.ts` segments without a Media3 playback exception.

---

## 0.2.2

### Authors & Project Credits
- Officially added **Tajeddine Bourhim** ([@Scorpiontaj](https://github.com/Scorpiontaj)) as Co-Author & Core Developer alongside **EL HADRATI Othman** ([@ELhadratiOth](https://github.com/ELhadratiOth)).

### Android & Capacitor Core Enhancements
- **DASH Stream Authentication & Interceptor**: Built a universal renderer network interceptor (`streamSigner.ts`) for Android Capacitor that intercepts `window.fetch` and `XMLHttpRequest.prototype.open` to automatically append CloudFront authentication parameters (`?Policy=...&Signature=...&Key-Pair-Id=...`) to all media segments (`init-stream0.m4s`, `chunk-stream0-00001.m4s`).
- **Expanded Manifest Segment Repair**: Updated `repairDashManifest` to sign all `sourceURL=`, `initialization=`, `media=`, and `url=` attribute templates inside DASH XML manifests.
- **Capacitor Memory Fix**: Fixed Capacitor Android `ArrayBuffer` data corruption by serving patched manifests via `Data URI` strings.
- **Restored Adaptive Quality**: Fully restored 1080p and 720p adaptive streaming choices on Android devices.

### Mobile & Tablet UI & Responsive Design
- **Automatic Horizontal View**: The player automatically requests landscape screen orientation when playing media on mobile or tablet devices (`<= 1024px`).
- **In-Player Orientation Toggle**: Added a dedicated **Rotate View button (`<RotateCw />`)** in the player control bar to seamlessly toggle between Landscape (Horizontal laptop-style view) and Portrait (Vertical view) on mobile/tablet screens.
- **Home Page Responsiveness**:
  - Optimized hero featured section on mobile by removing overlapping floating posters to maximize title & description readability.
  - Added fluid typography and full-width touch targets for "Watch now" and "More info" action buttons.
  - Touch-optimized poster rows with smooth horizontal scrolling (`-webkit-overflow-scrolling: touch`) and 2.5 visible cards per row on mobile screens.

### Performance & Desktop Optimizations
- **DASH Manifest Caching**: Implemented in-memory caching for materialized DASH manifests in `src/main/live.ts`, drastically speeding up desktop timeline scrubbing previews.
