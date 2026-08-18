# Release Notes

## 0.3.5 (Latest update)

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
