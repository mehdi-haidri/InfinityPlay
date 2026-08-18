# Release Notes

## 0.3.7 (Latest update)

### OpenSubtitles & Community Subtitle Fallback
- **Community Subtitle Engine**: Integrated public OpenSubtitles REST API and community subtitle search in [`opensubtitles.ts`](file:///home/scorpiontaj/Desktop/Coding/InfinityPlay/src/main/providers/opensubtitles.ts) covering English, Arabic, French, Spanish, German, Italian, Turkish, Russian, Japanese, and Korean tracks.
- **Automatic Fallback for Subtitle-less Movies**: Titles with no default MovieBox subtitles now automatically fallback to OpenSubtitles community files.
- **On-Demand Search Button**: Added a "Search Online Subtitles" button in the Player subtitle menu allowing users to discover and download extra community subtitles on the fly.

### Player Supercharge & Playback Flow
- **Dedicated Resume Choice Modal**: Clicking "Resume" on a partially watched title opens a sleek prompt allowing instant continuation from the exact timestamp or starting from the beginning, bypassing redundant in-player prompts.
- **Next Episode Autoplay Countdown**: For TV series, an interactive countdown overlay appears during the last 15 seconds of an episode with `[Play Now]` and `[Dismiss]` actions.
- **Subtitle & Audio Sync Offset**: Added real-time subtitle sync timing control (`-10s` to `+10s` in `0.5s` steps) inside the Subtitles menu with instant playback adjustment.
- **Sleep Timer**: Added sleep timer (15 min, 30 min, 60 min) with automatic pause and gentle notification.
- **Discord Rich Presence**: Integrated Discord Rich Presence in the Desktop app, displaying current title, season/episode, time elapsed, and cover art.
- **OS Media Session Integration**: Full hardware media key support (`Play/Pause`, `Next`, `Previous`, `Seek`) with artwork metadata.

### Mobile & Android Enhancements
- **Gesture Auto-PiP**: Picture-in-Picture mode automatically activates when swiping home or switching apps during playback on Android devices.
- **Touch Double-Tap to Seek**: Double-tapping the left half of the video seeks backward 10s with an animated `◂◂ 10s` ripple badge; double-tapping the right half seeks forward 10s with `10s ▸▸`.
- **Auto-Landscape Orientation**: Video playback automatically switches mobile devices to landscape orientation and restores portrait on exit.

### Netflix-Style Downloads & Offline Playback
- **Show & Session Grouping**: Redesigned [`DownloadsPage.tsx`](file:///home/scorpiontaj/Desktop/Coding/InfinityPlay/src/renderer/src/pages/DownloadsPage.tsx) to group downloaded series episodes inside sleek TV session cards with expandable drawers, episode counters, total disk size, and 1-click offline play.
- **Robust Multi-Episode & Single-Episode Downloads**: Fixed DASH manifest segment template signing preserving XML tree integrity, ensuring both single episode downloads and full season downloads stream-copy to disk without interruption.
- **Automatic Subtitle Attachment & Language Preference**: Downloads now automatically save caption files (`.srt`) matching your configured language preference (with fallback to OpenSubtitles if no catalog captions exist), and added a "Download subtitles with media" setting control in [`SubtitleSettingsSection.tsx`](file:///home/scorpiontaj/Desktop/Coding/InfinityPlay/src/renderer/src/pages/settings/SubtitleSettingsSection.tsx).
- **Safe FFmpeg Binary Resolution**: Fixed media binary lookup in [`media-tools.ts`](file:///home/scorpiontaj/Desktop/Coding/InfinityPlay/src/main/media-tools.ts) to resolve system binaries directly without triggering unhandled npm package exceptions on Linux.
- **Interrupted Download Recovery**: Added retry action `[ ↺ Retry ]` for interrupted transfers that fetches fresh CloudFront signatures, and filtered out non-fatal process stderr noise.
- **Storage & Offline Readiness Banner**: Displays total downloaded size with a confirmation badge that media is 100% playable offline without internet or mobile data.

### Cinematic Details Page & Recommendations
- **Cinematic Clean Layout**: Redesigned [`DetailsPage.tsx`](file:///home/scorpiontaj/Desktop/Coding/InfinityPlay/src/renderer/src/pages/DetailsPage.tsx) with ambient hero banner, floating poster card, IMDb rating badge, audio switcher, and unified specifications panel.
- **"More Like This" Carousel**: Added related media recommendations powered by [`SimilarTitlesSection.tsx`](file:///home/scorpiontaj/Desktop/Coding/InfinityPlay/src/renderer/src/pages/details/SimilarTitlesSection.tsx), dynamically recommending relevant movies and TV shows matching the current title's genre.
- **Interactive Episode Picker Views**: Enhanced [`EpisodePicker.tsx`](file:///home/scorpiontaj/Desktop/Coding/InfinityPlay/src/renderer/src/pages/details/EpisodePicker.tsx) with a view switcher between a compact **Grid View** and a rich **Detailed List View** (featuring episode titles, watched progress bars, and direct episode play actions).
- **Resume Progress Hero Bar**: Displays an exact watched timestamp and percentage progress bar on partially watched titles.
- **One-Tap Share**: Added clipboard share action copying title and release info.
- **Fixed React Hooks Ordering**: Resolved "Rendered more hooks than during previous render" bug by ensuring unconditional top-level hook execution.

## 0.3.6

### Architecture & Modularity
- **Sliced State Management**: Refactored the core Zustand store into dedicated domain slices (`navigation`, `config`, `history`, `favorites`, `player`, `downloads`, `toasts`, `backup`) for predictable state updates and fine-grained reactivity.
- **Domain IPC Layer**: Modularized Electron IPC handlers by domain (`catalog`, `tv`, `media`, `downloads`, `settings`, `cast`, `updates`, `system`), improving code maintainability and testability.
- **Modular Pages**: Decomposed `DetailsPage` and `SettingsPage` into specialized subcomponents (`EpisodePicker`, `AudioTrackSelector`, `SourceList`, `SubtitleSection`, `CastSection`, and settings panels).

### Data Backup & Migration
- **Export & Restore**: Added full user data backup export and import in JSON format via Settings. Users can easily backup or transfer their favorites, watch history, configuration, and Watch Later queue across devices.

### Parental Controls & Content Filtering
- **PIN-Protected Adult Screening**: Added optional PIN protection to lock adult content filtering settings, preventing unauthorized access to mature categories or keywords.

### Discovery, Search & Home Filter
- **Home Screen Movies/Series Filter**: Added dedicated **All / Movies / TV Series** quick filter tabs directly on the home page, dynamically filtering the hero carousel, continue watching queue, and catalog rows in real time.
- **Advanced Search Filters**: Overhauled the Search page with an interactive advanced filter panel:
  - **Sorting**: Relevance, Newest Year First, Oldest Year First, Alphabetical (A-Z), Alphabetical (Z-A).
  - **Release Era**: All Years, 2025–2026+ (Latest), 2020–2024, 2010–2019, 2000–2009, and Classics (Pre-2000).
  - **Audio Language**: English, Arabic, French, Japanese, and Original tracks.
  - **Quality Filter**: One-tap toggle to hide CAM / cinema recordings.
  - **Active Filter Counter & Reset**: Real-time counter of active filter parameters with a one-click Reset button.

### UX, Accessibility & Playback Flow
- **1-Click Play & Quality Selector Modal**: Upgraded the details page playback trigger to a sleek combo button (`Play` / `Resume`). Clicking Play opens a modal allowing direct selection of 4K/1080p/720p qualities, audio tracks, and subtitles before starting.
- **Keyboard Shortcuts Overlay (`?`)**: Added a discoverable shortcut help overlay accessible anytime during video playback by pressing `?` or clicking the keyboard icon in the control bar.
- **Actionable Empty States**: Enhanced empty states across Favorites, History, and Watch Later pages with direct contextual call-to-action buttons to discover movies, explore series, and browse catalog rows.
- **Undo Support**: Added instant "Undo" actions in toast notifications when removing titles from favorites, Watch Later, or watch history.

### Build & Platform Support
- **ARM64 Desktop Builds**: Added ARM64 targets for both Windows (`win-arm64`) and Linux (`linux-arm64` AppImage, DEB, RPM, Pacman) in addition to existing macOS Apple Silicon binaries.

### Reliability, Parsers & Testing
- **Arabic & Translated Subtitle Normalization**: Fixed literal `/n`, `\n`, `\N`, and `\\n` escaping artifacts in Arabic and machine-translated subtitle tracks by converting them into clean newlines, stripping residual ASS/SSA tags, and adding automatic bidirectional text alignment (`dir="auto"`).
- **EPG & XMLTV Resilience**: Improved XML entity decoding, CDATA parsing, and time formatting resilience for malformed IPTV XMLTV feeds.
- **Expanded Test Suite**: Added comprehensive Vitest unit test coverage for MovieBox catalog adapters, subtitle cleaning, title cleaning, audio detection, XMLTV parsing, M3U playlists, and formatting utilities.
- **Biome Quality Linting**: Configured fast Biome linting and formatting rules.

## 0.3.5

### Reliable Android TV casting

- Fixed Android DLNA casting to webOS and similar televisions: the local relay now uses the active Wi-Fi address, so the TV can reach the shared video instead of failing to fetch it.
- LG webOS now receives the video resource before its caption resource, waits for the receiver to be ready, and retries the initial play request from a clean state when needed. This resolves the receiver's “Transition not available” failure.
- A Chromecast session that was already connected before the native player opens now receives the selected title immediately. Casting also chooses a direct stream a receiver can actually play instead of handing it a protected adaptive manifest.

### Captions that carry over

- Android DLNA captions are converted to SRT and published with the same base name as the video, which is the format expected by LG webOS televisions.
- The subtitle menu remains available after changing episodes, and the selected language is saved before the next episode starts.
- The player and detail page use the same subtitle preference, so the chosen language is applied automatically when the next episode offers it.

### Casting controls while you browse

- The active casting controller now floats above the app instead of squeezing into a title's action row.
- It remains available while navigating to other pages, with play/pause, seeking, volume, and episode controls still connected to the TV session.

### Next episode playback everywhere

- Added Previous and Next episode controls to desktop playback, Android's native player, Chromecast, and DLNA casting.
- When an episode ends, the next episode starts automatically. Navigation continues across season boundaries when a series has another season.
- The Android player also responds to media next/previous buttons from headphones, remotes, and the system.

### Cleaner mobile player controls

- Android's quality, audio, episode, cast, and playback-options row now follows the normal player controls: it fades away during playback and returns when the controls are shown.

### Android in-app updater and APK self-update

- Android phones, tablets, and Android TV can now download and install updates directly from within the app.
- When a new release is available on GitHub, the app detects it, displays update prompts, downloads the APK with pause/resume support, and seamlessly launches the package installer to update in place.
- The About page provides full update status, download progress, and manual check/install controls on Android.

## 0.3.4

### Subtitles on the television

- Fixed the cause of captions never appearing on a television. The subtitle button showed while the text never arrived, because a receiver fetches a side-loaded caption track under cross-origin rules the app was not answering.

### Cast without opening the player

- The cast button is on the film page itself, so a title can be sent to a television without starting playback first. It resumes where you left off and carries your subtitle track.

### Player keyboard shortcuts

- Arrows, space, `J`/`L`, `M`, `F` and the number keys work again. Every shortcut stopped responding as soon as you clicked any control, because the focused button swallowed the key.
- New: number keys jump to that tenth of the film, `Home` and `End` go to the start and end.

### Checking for a new version on Android

- The About page now asks GitHub whether a newer release exists and says which version it found, since the Android build has no in-app updater and cannot replace itself.
- A Release page button opens that release directly, so the new version can be downloaded and installed without hunting for the address.

### Android downloads

- Downloads are handled by the app instead of the system download manager, which could not send the identification the stream host requires and had no way to pause.
- Pause and resume are now on the downloads screen on the phone, and a paused file continues from where it stopped.
- Choosing an adaptive quality saves the matching standard-quality file instead of an unplayable placeholder, and says so plainly when a title has no such file.
- Android TV no longer offers downloads at all, having nowhere useful to put them.

### Mobile player controls

- One cast button instead of two. DLNA moved into the options menu, so casting starts in one place rather than asking which button your television answers on.
- The control bar uses the same icons as the desktop player.

### Mobile casting that works with more TVs

- Android now includes Google's standard Chromecast sender and route picker alongside the existing DLNA option.
- Protected streams are shared through a local relay when a television cannot use the original provider URL directly.
- Chromecast and compatible DLNA televisions receive the selected WebVTT subtitle track from both desktop and mobile.
- Casting keeps play, pause, seek, volume, and session state synchronized with the television.

### Native mobile playback and PiP

- Android playback stays in the Media3 player for reliable HLS, DASH, HEVC, headers, quality selection, audio tracks, and subtitles.
- Entering Android Picture-in-Picture now leaves the movie detail page underneath instead of mounting the desktop/web player a second time.
- The native player exposes Chromecast, DLNA, quality, additional playback options, and PiP in a touch-friendly layout.

### Reliability and safety

- Local media paths are validated before Electron serves them, including real-path checks that prevent traversal through symbolic links.
- Interrupted settings writes no longer replace valid saved data with an empty fallback.
- FFmpeg jobs detect stalls and reuse probe results, while route-level error recovery and network status keep failures understandable.
- Added automated tests for the media server and persisted store, and made them a required release-build gate.

## 0.3.3

### Cast to a TV

- Send anything you are watching to a TV on the same network, from the player's new cast button.
- Chromecast and DLNA are both supported, so a TV works whether or not it has Google services. Android uses DLNA only, since the Chromecast sender needs Play Services.
- A TV that answers on both protocols now appears once in the list, and a refusal on the first is retried on the second automatically.
- Streams are relayed by the app itself. The CDN rejects any player but this one, so handing the address to a TV showed an idle receiver screen and nothing else.
- Play, pause, seek, and volume from the app while the TV plays; local playback pauses so the two do not run at once.
- The TV refusing a stream is now reported instead of leaving the receiver blank.

### Full rows again

- Genre rows were arriving nearly empty — Thriller offered eighteen titles and showed one — because most films are listed only as a Hindi dub and those are filtered out. Rows now keep paging while they are short, and a title the catalog carries only as a dub is shown in its original audio instead.
- A row with only a handful of titles lays its cards out plainly rather than pretending to be a slider with an empty track.

### Anime

- A section of its own, beside Free Library, with series and films and a filter for each.
- Loads a page at a time as you scroll, rather than all at once.

### Faster Home and long seasons

- Home no longer waits for every row before showing anything. The hero and the first rows appear on their own, and each row below loads as you reach it.
- Seasons with hundreds of episodes are drawn in blocks of fifty with a range picker instead of every episode button at once, and the block containing the episode you are on is the one that opens.

## 0.3.2

### Audio language control

- English is now the default and universal fallback, followed by Arabic and French.
- Removed Hindi and other unsupported dubbed variants from catalog results and audio pickers.
- Android Media3 now receives real language tags (`en`, `ar`, `fr`) and selects the preferred supported track instead of the first manifest track.
- Applied the same supported-language filtering to HLS and DASH playback on desktop.

### Linux media tools

- Linux now uses the maintained `ffmpeg` and `ffprobe` installed by the distribution instead of bundled static executables.
- Restored dedicated FFprobe codec and duration inspection.
- DEB, RPM, and Arch packages declare FFmpeg as a dependency; AppImage users install it once on the host.

### About and updates

- Fixed developer names, email addresses, GitHub handles, and build metadata overflowing narrow mobile screens.
- The in-app changelog now shows only the main updates for the running or incoming latest version, without the historical release archive.
- Kept the user-controlled download, pause, resume, cancel, and install-later update flow.

### Mobile experience

- Preserved the adaptive phone, tablet, and Android TV interface, native Media3 playback, Picture-in-Picture, quality controls, subtitles, and D-pad support.
