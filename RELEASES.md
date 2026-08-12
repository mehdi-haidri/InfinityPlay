# Release notes

Updates install themselves. InfinityPlay checks on launch and on demand from the About
page, then offers **Restart & install** when a new version is ready.

---

## 0.2.0

### Playback

- Fixed adaptive streams failing with "Stream error" when running from source. The stream
  CDN only returns its CORS header to requests that carry an Origin and does not vary its
  cache on it, so a development build could be served a cached response the browser then
  refused. Packaged builds were never affected.
- Fixed titles whose adaptive stream refused to start with "Stream error", including
  House of the Dragon. Those manifests declare an incomplete video codec that Chromium
  rejects; they are now repaired before playback.
- Fixed adaptive (1080p/720p) playback dropping out and restarting every few seconds.
  Pinning the chosen quality was restarting the stream, which then pinned it again.
- Recoverable streaming hiccups no longer raise a "Stream error" over a video that is
  still playing.
- HEVC video now plays directly when the machine can decode it. It was always being
  re-encoded on the fly, which caused stuttering and pausing on files that play fine
  elsewhere. Compatibility mode is now used only when Chromium genuinely cannot decode.

### Live TV

- Four more channel sources alongside the full IPTV-org index: an Arabic list, Sports,
  News, and Free-TV — about 12,700 channels in total.
- Filter by country and by channel type. Both pickers have their own search field and
  show how many channels each option holds, busiest first — 180 countries are no longer a
  scrolling exercise.
- New sources are added automatically when upgrading, without touching playlists you
  added yourself.

### Downloads

- FFmpeg now ships with the app, so 720p and 1080p downloads work with nothing to install.
- Each download gets its own folder holding the video and its subtitles. Series are filed
  as `Show/Season 01/S01E02/`.
- Download a whole season in one click; episodes queue and run one at a time, and the
  queue can be stopped from the Downloads page.

### Packages

- Added Intel and Apple Silicon macOS DMGs, with ZIP companions for future signed updates.
- Added AppImage, DEB, RPM and Arch Linux packages for x64 systems.
- Added tagged GitHub Actions releases for Windows, macOS and Linux.
- Unsigned macOS builds direct users to GitHub Releases instead of attempting an update
  that macOS would reject.
- Added Tajeddine Bourhim to the project contributor metadata.

### Interface

- Bundled Outfit for consistent typography and introduced a single-accent brand mark.
- Reworked featured artwork so portrait posters are composed beside a blurred backdrop.
- Added collapsible navigation, clearer page context, stronger content hierarchy and
  resilient image fallbacks.
- Improved player slider and menu keyboard support, reduced-motion behavior, download
  announcements, empty states and package-specific update help.
- Added FFmpeg compatibility playback for MPEG-2 and HEVC sources that otherwise played
  audio over a black video surface on Linux.
- Fixed adaptive DASH manifests being saved as tiny completed downloads; downloads now
  select a real progressive file and reject non-media responses.
- Reduced scrolling work with off-screen row containment, asynchronous image decoding,
  indexed watch progress and narrower state subscriptions.
- Replaced legacy Linux updater metadata 404 stacks with concise manual-update guidance.
- Made the player timeline draggable and seekable for both native H.264 and FFmpeg-backed
  H.265/MPEG-2 playback, including signed adaptive movie streams.
- Added an in-player continue/start-over choice with configurable resume behaviour.
- Added exact 720p/1080p adaptive downloads instead of silently falling back to 480p.
- Hide stale source rows while a new episode loads and allow progress removal from title
  pages, Continue Watching cards, or the history library.
- Added Ocean, Forest and Plum themes, reduced-motion controls, and restart-aware
  NVIDIA/AMD/Intel hardware acceleration with detected GPU status.
- Made Linux adaptive HEVC playback deterministic by isolating the selected DASH
  representation and retrying software decode when a GPU driver produces no video.
- Added cached thumbnail previews above the player timeline, generated on demand so
  ordinary playback and scrolling do not pay a storyboard-generation cost.
- Cast portraits now open profiles with an optional biography plus provider-verified,
  separately grouped movie and series credits.

---

## 0.1.0

First release.

### Watching

- Search and stream movies, series and anime inside the app — no external player needed.
- Plays at up to 1080p, adjusting quality to your connection.
- Custom player: scrubbing, speed, volume, fullscreen, keyboard shortcuts.
- Remembers where you stopped, with a *Continue watching* row on Home.
- Autoplay next episode.

### Subtitles

- Up to 16 languages, listed under English names.
- Pick a default language that switches on automatically.
- Adjustable size, colour and background, with a live preview.

### Audio

- Defaults to original audio instead of a dubbed version.
- Switch tracks per title; set a preferred language in Settings.

### Downloads

- Download for offline viewing, with live progress you can dismiss.
- A Downloads section to play, open externally, pause, resume or delete.
- Subtitles saved alongside the video so other players pick them up.

### Home and catalog

- Trending, new releases, recommended and genre rows.
- Choose a catalog region — US, UK, Japan, Korea and more.
- Adult content filtered out by default.
- Search returns films and series only.

### Also

- Live TV from M3U playlists.
- Three themes, an About page, and an animated launch screen.

### Known limits

- Some titles have gaps in the catalog, or no release year.
- Windows builds are unsigned, so SmartScreen warns on first run.
