# Release Notes

## 0.3.3 (Latest update)

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
