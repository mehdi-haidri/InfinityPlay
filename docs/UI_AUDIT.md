# InfinityPlay UI and UX audit

This audit covers the current Electron renderer. It deliberately does not prescribe a
framework rewrite: the existing React, Zustand and vanilla CSS stack is sufficient.

## 1. Highest-impact improvements

### Give the typography an identity

`styles.css` requests Inter but does not bundle it, so the actual face changes between
Windows, macOS and Linux. Bundle a variable font such as Outfit or Geist locally, define
its weights with `@font-face`, and use tighter display tracking for hero and page titles.
This is the lowest-risk way to make the interface feel more intentional and consistent.

### Stop stretching portrait posters into hero backdrops

The home hero uses `CatalogItem.posterUrl` as a cover background. Most catalog posters
are portrait images, so they become soft, heavily cropped wide banners. Prefer a real
backdrop from the provider. When none exists, compose the poster beside a blurred,
tinted copy instead of stretching it edge to edge.

### Simplify the brand palette

The infinity mark combines blue, purple and pink while the application uses rose, amber
or monochrome accents. Produce a single-accent version of the mark for each theme, or a
neutral master mark tinted by CSS. Keep the existing cool charcoal surfaces and use one
active accent at a time.

## 2. Navigation and hierarchy

- Reduce the fixed 232 px sidebar to a compact default or add a collapse control. The
  catalog benefits more from poster space than persistent text labels.
- Give non-home pages a clearer title/context area below the top bar. Search, Downloads,
  Settings and About currently share nearly identical page framing despite very different
  jobs.
- Make row headings and scroll affordances more prominent. The small 16 px labels can get
  lost between the large hero and dense poster rows.
- Keep the native macOS title bar unless a future custom title bar includes a dedicated
  draggable region, correctly offset traffic lights, and marks controls as `no-drag`.
- Constrain long-form settings and metadata text to a readable line length while letting
  poster grids use the available window width.

## 3. Accessibility and interaction

- Add Arrow keys, Home, End and Page Up/Down handling to the custom player seek slider;
  its ARIA slider role currently exposes values but the control is pointer-only.
- Pause hero rotation while the pointer is over it, while a dot has focus, and when the
  document is hidden. Disable the interval entirely for `prefers-reduced-motion`.
- Give download progress one polite live region instead of marking every toast as an
  independent status update. Announce completion and failure immediately, but throttle
  percentage announcements.
- Audit poster, cast and author images. Empty alternative text is correct when nearby
  text already names the item, but the author portrait and any informative image should
  have a useful description.
- Add visible text or tooltips for unfamiliar player icons and verify every menu can be
  opened, traversed and dismissed without a pointer.

## 4. Maintainability and product polish

- Move repeated inline layout declarations into named CSS utilities or small layout
  components. Dynamic values such as progress width and backdrop URLs should remain
  inline; fixed gaps, margins and widths should not.
- Consolidate repeated panel headings, setting rows, metadata lists and async status
  layouts so spacing and responsive behavior change in one place.
- Upgrade the Downloads empty state with the package location, a direct route back to
  discovery, and a brief explanation of offline playback.
- Add resilient image fallbacks that retain the title or initials instead of showing a
  blank charcoal rectangle when a remote image fails.
- Tailor update help to the installed package type: restart-to-install where supported,
  a release download for unsigned macOS, and package-manager guidance when appropriate.
- Replace the generic all-Lucide visual language gradually with a small custom set for
  the core InfinityPlay actions: watch, continue, download, live TV and audio/subtitles.

## Recommended order

1. Bundle the font and correct hero artwork.
2. Simplify the mark/accent relationship.
3. Fix seek-slider keyboard support and carousel motion behavior.
4. Refine sidebar density, page headers and row hierarchy.
5. Extract repeated layout styles and finish empty/error/image states.
