# Release Notes

Updates install automatically. InfinityPlay checks on launch and on demand from the **About** page.

---

## 0.2.2 (Latest Update)

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
