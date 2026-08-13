# Release Notes

Updates install automatically. InfinityPlay checks on launch and on demand from the **About** page.

---

## 0.2.6 (Latest Update)

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
- Synchronized app, lockfile, Gradle, and APK metadata at version **0.2.5**.
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
