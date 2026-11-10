# Changelog

All notable changes to the `@hopeplayer/*` packages (`core`, `react`, `vue`, `react-native` — always released together with the same version) are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning policy

From 1.1.0 on, the project follows [Semantic Versioning](https://semver.org/) strictly:

- **Patch** (`1.1.x`) — bug fixes only. Safe to update at any time.
- **Minor** (`1.x.0`) — new features and new options, fully backward compatible. Defaults never change in a way that alters existing pages; new features ship off by default unless stated.
- **Major** (`x.0.0`) — breaking changes (removed / renamed options, changed defaults, dropped browsers). Each one is listed under **Breaking** with a migration note, and deprecated options keep working with a console warning for at least one minor release before removal.

During the initial 1.0.x line, new features were released as patch versions; that ends with 1.1.0.

## [Unreleased]

### Added
- **Public plugin API.** `definePlugin({ name, setup(player, options) })`, registered with `options.plugins`, `player.use()` or page-wide `registerPlugin()` (React / Vue: `plugins` prop); plugins can be loaded lazily (`() => import('./x')`). The `player` object offers state and playback, events (`on` / `emit`), control-bar buttons, layers over the video, settings-menu toggles / selects / submenus, keyboard shortcuts (listed in the `?` panel), i18n, namespaced storage, timers and logging. Everything a plugin adds is removed automatically with it; errors inside a plugin are logged and never break playback. Versioned as `PLUGIN_API_VERSION` 1. The runner is a separate chunk loaded only when a plugin is used. Guide: `docs/PLUGIN_API.md`.

### Changed
- "Skip intro" buttons (`skipSegments`) now run on the public plugin API.

## [1.3.1] — 2026-11-10

### Added
- **`pipButton: false` / `fullscreenButton: false`** hide the Picture-in-Picture / fullscreen button in the control bar (both shown by default; also in the narrow layout). Only the button goes away — the `F` shortcut and `tapGestures` fullscreen keep working.

### Fixed
- **`playbackRates` was ignored.** The option was typed and documented, but the settings menu was always built with the default speeds, so neither a custom list nor `[]` had any effect. The menu now uses your list (sorted, duplicates dropped), and `playbackRates: []` removes the "Playback speed" row.

## [1.3.0] — 2026-11-09

### Added
- **`liveSeekBar: false`** hides the progress (DVR) bar on live streams. The `● LIVE` badge and keyboard seeking stay; VOD is unaffected. Default `true`.

### Fixed
- **Live: the seek bar thumb sat short of the right end while watching live.** The bar ended at the very end of the seekable window, but hls.js deliberately plays a few segments behind it, so even at live the thumb looked behind — while the `● LIVE` badge said live. The bar now ends at the player's live target (hls.js `liveSyncPosition`), and while the viewer counts as live (the same 15 s tolerance as the badge) the thumb sits at the right end.

## [1.2.1] — 2026-11-08

### Fixed
- **Vue: options that were not passed were sent to the player as `false`.** Vue turns an absent `boolean` prop into `false` (boolean casting), and `@hopeplayer/vue` passed every prop through. In Vue apps clicking the video did not play / pause (`tapToPlay: false`), the cursor never hid (`cursorHideDelayMs: false`) and the quality badge never showed (`qualityBadge: false`). Only the props you pass now reach the player. Covered by a new end-to-end test with real Vue (`vue-wrapper`).

## [1.2.0] — 2026-11-07

### Added
- **Playback history (`history`, off by default):** a video left halfway starts where the viewer stopped, with a "Resumed at 0:42 · Start over" notice (Start over goes back to 0 and forgets the position). Volume and mute are remembered on the site; `muted: true` (muted autoplay) always wins. Stored in the viewer's browser (localStorage): positions are saved after `minWatched` seconds (10), a video within `endMargin` seconds (15) of its end counts as watched and is forgotten, at most `maxEntries` (50) videos for `ttlDays` (30). Not saved for live streams or during ads. A QR resume link (`?vtime=`) wins over the saved position. `id` identifies the video when its address changes (signed URLs). New `hp:history` event (`resumed` / `restart`). Loaded only when enabled (~2 KB gzip).
- **Accessibility menu (`accessibility`, off by default):** an "Accessibility" submenu in the settings menu.
  - **Zoom** (100–300%): from the menu, with `+` / `−` / `0`, two-finger pinch on touch screens; move around the zoomed picture by dragging or with Shift + arrow keys (plain arrows still seek / change the volume).
  - **Picture filters:** natural, black and white, daylight (brighter, more contrast for bright rooms), night light (warm, less blue light), high contrast, and red- / green- / blue-blind modes (daltonization — colors the viewer cannot tell apart are shifted to ones they can).
  - **Mono audio** and **volume boost** (up to 300%) through Web Audio. Shown as "Unavailable" for a cross-origin source loaded without CORS, where Web Audio would mute it.
  - **Large controls:** bigger buttons, seek bar, touch targets and captions.
  - **Keyboard shortcuts** list (menu row or `?`): a dialog, closed with Esc.
  - **Quick access:** each feature that is on gets its own button right of the settings button (zoom, filter, mono audio, volume boost, large controls). Pressing it opens that feature's settings directly; turning the feature off removes the button.
  - The viewer's choices (except zoom) are remembered on the site (`remember`). Each part can be turned off (`zoom`, `filters`, `audio`, `largeControls`, `shortcuts`) and the zoom / boost levels and the filter list can be set. New `hp:accessibility` event. Loaded only when enabled (~5 KB gzip).
  - Settings menu: submenus can now nest, and quick-access buttons next to the settings button can open a submenu directly.

## [1.1.0] — 2026-11-06

### Added
- **Skip intro / recap / credits buttons (`skipSegments`):** a button shows in a corner while a part plays and jumps to its end when pressed. Per part: `start`, `end` (omitted = end of the video, so skipping the credits ends it and a playlist moves on), `type` (`intro` / `recap` / `credits` / `custom` — sets the default text), `label`, `position` (four corners), `showFrom` / `showUntil` (when the button appears and leaves), `hideAfter` (fades out, returns with the controls), `autoSkip` (`true` or a countdown in seconds; not when the viewer seeked into the part). New `hp:skip` event (`shown` / `skip`, cancelable). Hidden during ads, keyboard accessible, `::part(skip-segment)`. Loaded only when used (~2 KB gzip).
- **Quality badge on the settings icon:** shows the quality of the picture that is actually playing — `HD` (720p+), `2K` (1440p), `4K` (2160p), `8K`; below HD the height (`480` / `360` / `240`, dimmed). Read from the decoded video, so it also follows ABR on Auto quality, with MP4, hls.js and Safari's own HLS player. On by default; `qualityBadge: false` hides it. Colors: `--hp-quality-badge-bg` / `--hp-quality-badge-color` (default: the accent color), `::part(quality-badge)`.
- **`hls.build: 'light'`:** loads hls.js's light build — ~119 KB instead of ~186 KB gzip. Quality menu, ABR, live / DVR, SCTE-35 and the wall clock work the same. It has no stream subtitles (WebVTT / IMSC1 / CEA-608), alternate audio tracks, DRM (EME), CMCD or interstitials; captions from `options.subtitles` are unaffected. Off by default (`'full'`). Only the chosen build is downloaded. `player.playbackEngine` reports it as `build`.

### Changed
- **Smaller hls.js download:** the hls.js chunk is now minified — it was bundled with its whitespace (Vite does not minify whitespace in library builds). 228.6 → 186.5 KB gzip for the same hls.js 1.7.4 code (the latest stable release).

## [1.0.18] — 2026-11-06

### Fixed
- `hp:ended`, `hp:error` and `hp:ratechange` were declared and documented but never dispatched, so React `onEnded` / `onError` / `onRateChange` and Vue `@ended` / `@error` / `@ratechange` never fired. `hp:error` is sent once when the error screen opens (`{ message, code }`) — not for errors the player recovers from (fallback sources, native HLS → hls.js).
- **Firefox fullscreen:** the fullscreen layout and the larger fullscreen controls / seek bar / captions were never applied in Firefox — the rules used the selector list `:host(:fullscreen), :host(:-webkit-full-screen)`, and Firefox drops the whole rule for the prefixed selector it does not know. They now use the forgiving `:host(:is(:fullscreen, :-webkit-full-screen))`.
- **Tracking pixels** (sponsorship, ad triggers) now get a cache-buster (`[CACHEBUSTING]` / `[timestamp]` macros are filled, otherwise `hp_cb` is added): a repeated impression of the same URL — e.g. the sponsor intro every N minutes — could be served from the browser's memory cache and never reach the server (Firefox).
- **Safari / iOS early seeks:** WebKit raises `readyState` before `loadedmetadata` and then resets a seek made in between back to 0. The QR resume `?vtime=` jump and the React Native `seek()` sent before the player is ready now verify the position on `seeked` and re-apply it. The same applies when a Cast session ends: on WebKitGTK / WPE local playback did not continue from the TV's position (the seek was lost or undone by the engine) — the player now starts playback first, then seeks, and re-applies the seek if the engine jumps back.
- **No audio output device (Firefox):** Firefox reports a missing or unavailable audio output (no sound card, a disconnected Bluetooth headset) as a decode error while the video keeps playing silently. The player showed the error screen over the playing video, skipped to the next playlist item, and reloaded the track from the start on the next option change. This error is now treated as non-fatal.
- **`hp:ready` could be missed:** it was dispatched synchronously while `import '@hopeplayer/core'` upgraded the element, so a listener added right after the import (as in the README) never fired. It is now dispatched a microtask later; listeners attached earlier (the React and Vue wrappers) still receive it.
- **Ad triggers:** with `closeDelay: 0` the close button appeared one frame after the box (it was shown from a `setTimeout`); it now appears together with the box.
- **Seeking to the very end on WebKitGTK / WPE** (Linux browsers, WPE-based TVs and devices) jumped back to 0 when the end was not buffered yet. Skip buttons, the seek bar and the keyboard now stop 0.05 s before the end.
- **Taps could land on the wrong control:** when the player did not fit fully on screen, pressing any control focused the player and scrolled the page, so the release landed on whatever slid under the pointer (e.g. the story "next" button turned into a seek bar tap). The player now takes focus without scrolling.
- **Story mode:** a quick second "next" / "previous" tap while the previous item was still loading was silently dropped; it is now applied once the switch finishes.

### Project
- Docs: release notes page generated from this file; CDN install, browser support and accessibility sections on the install page; full event list.
- Examples (web component, React, Vue) updated to 1.0.17 with the redirect card and Cast.
- CI checks that every event declared in `HopePlayerEventMap` is actually dispatched.
- **Cross-browser tests:** the end-to-end suite now runs in Firefox and WebKit too (`npm run test:firefox` / `test:webkit`) — nightly, on demand and before every release (`cross-browser.yml`; publishing waits for it). Chromium runs on every push in 4 parallel shards (`run.mjs --shard`); CI skips documentation-only changes and cancels superseded runs. Engine-specific checks are guarded with `only()` (Playwright's WebKit has no HLS, Web Audio or Media Session, and stops a looping video at its end). `npm run test:linux` runs the same Linux environment locally with Docker (the official Playwright image, no audio device, the steps of `cross-browser.yml`); the test summary repeats each failed suite's `FAIL` and error lines.
- **Real Safari tests:** smoke tests in real macOS Safari (`safaridriver`) and in Safari on the iOS Simulator (Appium XCUITest) on GitHub's macOS machines — startup, playback, pause / resume, seeking, captions without `<track>`, native HLS, QR resume, audio mode, fullscreen and AirPlay (`apple.yml`, nightly and on demand; not yet a release gate). Dependency-free W3C WebDriver client.

## [1.0.17] — 2026-11-05

### Added
- **Redirect screen `mode: 'card'`:** an "Up next" card appears in a corner `showBefore` seconds before the end, with image, duration badge, title, subtitle and a countdown ring that runs with the video; it redirects when the video ends, clicking the card goes immediately, X cancels.
- New redirect options: `position`, `label`, `subtitle`, `duration`, `newTab`; `duration` on suggestions.
- `hp:redirect` event (`shown` / `cancel` / `redirect`) — the `redirect` state is cancelable (`preventDefault()`) so SPAs can navigate themselves.
- `ads.prebid.custParams` (and `midroll.custParams`): extra GAM `cust_params` key-values sent to the GAM ad unit whether the auction is won or not, also on the fallback tag, on retries and on Cast TV tags. `hb_*` keys cannot be overridden.

### Changed
- Redesigned the full-area redirect screen (blurred backdrop, poster with countdown ring) and the suggestions grid.

### Fixed
- Suggestion titles were rendered as HTML (XSS) — now plain text.
- The redirect screen never showed after a postroll; the redirect now waits for the postroll to finish.
- Changing the `redirectScreen` option after the first apply had no effect.
- **Keyboard access:** the player host got `tabindex="-1"` instead of `0`, which removed every control from the Tab order — keyboard users could not reach play, volume, settings or fullscreen. A `tabindex` set by the page is still respected.
- Accessibility: the rewarded-ad dialog has an accessible name, the "Unlock 720p" button and the redirect card's accessible names match their visible text, the vinyl slider exposes its value from the start, and the time display has a visible focus ring.

### Changed
- Plugin chunks are named after their plugin (`ads-…js`, `cast-…js`) instead of `index-…js`.

### Project
- `CHANGELOG.md` with a versioning policy, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates.
- npm `keywords` for all packages; README with a one-line CDN quick start, browser support table and a comparison with other players.
- CI runs the full Playwright end-to-end suite, an axe-core accessibility scan (WCAG 2.1 A / AA) and a bundle-size budget on every push and pull request; GitHub Actions moved to Node 24 runtimes.

## [1.0.16] — 2026-11-03

### Added
- **Cast to TV (`cast`):** Google Cast (Chromecast, Google TV) with the player as a remote, ads played on the TV (VMAP or preroll / midroll / postroll), subtitles and metadata; AirPlay; Remote Playback API fallback. All off by default. `hp:cast` event.
- **Ad triggers (`adTriggers`):** rule-driven Ad Manager out-of-page ads — rules from your API or `config`; triggers for seconds, intervals, percent, fullscreen enter / exit, start, pause, resume, end; `mode`, `layout` (`'none'` by default: only the request is sent), `custParams`, frequency caps, tracking. `closeAdTrigger()` method.
- **Fallback sources:** mixed-format `sources` are grouped by format; `sourcePriority` sets the order and the next format is tried on a fatal error, keeping the position. `hp:sourcefallback` event (React `onSourceFallback`, Vue `@sourcefallback`).

### Changed
- Rewarded ads close themselves once watched and granted; when no ad is available the quality unlocks anyway with a notice (`grantOnNoFill` now defaults to `true`).
- The "Preparing ad" dialog has a timeout and a "No thanks" button.
- On mobile the sponsor logo moves to the corner while the controls are hidden.

### Fixed
- GPT is loaded from `securepubads.g.doubleclick.net` (certificate errors on some networks).
- Quality menu mixing HLS levels and MP4 qualities in combined source lists.

## [1.0.15] — 2026-11-01

### Added
- **Rewarded quality unlock (`rewardedUnlock`):** start at a capped quality, unlock higher qualities by watching a rewarded ad (GPT or your own provider).
- **Sponsorship layer (`sponsorship`):** player colors, corner logo and a "Presented by" intro from your own API, with repeat intervals and tracking pixels.

## [1.0.14] — 2026-11-01

### Added
- `audio.layout: 'compact'` — a thin, controls-only audio player.

### Fixed
- Cover and vinyl were left-aligned on iOS in the audio player.

## [1.0.13] — 2026-10-31

### Added
- **Audio player (`audio`):** cover, vinyl with scratch-to-seek, optional scratch sound, hold to stop, tonearm, Media Session metadata, audio ads.
- Generic `aspectRatio` option.
- Caption settings moved into their own submenu.

## [1.0.12] — 2026-10-31

### Added
- OM SDK (Open Measurement) access mode for IMA, preroll gate (content waits for the preroll), ad-host preconnect.
- Ads resize with the player (fullscreen / window changes); iOS fullscreen guard for ad breaks.

## [1.0.6 – 1.0.11] — 2026-10-29 / 2026-10-30

### Added
- React Native wrapper (`@hopeplayer/react-native`) and Expo example.
- StackBlitz / Expo Snack examples for the web component, React, Vue and React Native.
- Pause ad plugin, skip back / forward buttons, `tapToPlay`.

### Fixed
- Options set before the element was connected were lost.
- Android touch jitter and caption animation smoothness.

## [1.0.0 – 1.0.5] — 2026-10-28

Initial public release: the `<hope-player>` custom element with Shadow DOM, HLS via hls.js (lazy), Google IMA ads, Prebid, consent, playlist, story mode, markers, segments, sprite thumbnails, countdown / geo / redirect screens, QR resume, dubbing, live wall clock, SCTE-35, DAI, theming presets and i18n; React and Vue wrappers.

[Unreleased]: https://github.com/umutyaldiz/hopecoreplayer/compare/v1.0.18...HEAD
[1.0.18]: https://github.com/umutyaldiz/hopecoreplayer/releases/tag/v1.0.18
[1.0.17]: https://github.com/umutyaldiz/hopecoreplayer/releases/tag/v1.0.17
[1.0.16]: https://github.com/umutyaldiz/hopecoreplayer/releases/tag/v1.0.16
[1.0.15]: https://github.com/umutyaldiz/hopecoreplayer/releases/tag/v1.0.15
[1.0.14]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.14
[1.0.13]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.13
[1.0.12]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.12
