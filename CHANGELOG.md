# Changelog

All notable changes to the `@hopeplayer/*` packages (`core`, `react`, `vue`, `react-native` — always released together with the same version) are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning policy

From 1.1.0 on, the project follows [Semantic Versioning](https://semver.org/) strictly:

- **Patch** (`1.1.x`) — bug fixes only. Safe to update at any time.
- **Minor** (`1.x.0`) — new features and new options, fully backward compatible. Defaults never change in a way that alters existing pages; new features ship off by default unless stated.
- **Major** (`x.0.0`) — breaking changes (removed / renamed options, changed defaults, dropped browsers). Each one is listed under **Breaking** with a migration note, and deprecated options keep working with a console warning for at least one minor release before removal.

During the initial 1.0.x line, new features were released as patch versions; that ends with 1.1.0.

## [Unreleased]

## [1.0.18] — 2026-11-06

### Fixed
- `hp:ended`, `hp:error` and `hp:ratechange` were declared and documented but never dispatched, so React `onEnded` / `onError` / `onRateChange` and Vue `@ended` / `@error` / `@ratechange` never fired. `hp:error` is sent once when the error screen opens (`{ message, code }`) — not for errors the player recovers from (fallback sources, native HLS → hls.js).
- **Firefox fullscreen:** the fullscreen layout and the larger fullscreen controls / seek bar / captions were never applied in Firefox — the rules used the selector list `:host(:fullscreen), :host(:-webkit-full-screen)`, and Firefox drops the whole rule for the prefixed selector it does not know. They now use the forgiving `:host(:is(:fullscreen, :-webkit-full-screen))`.
- **Tracking pixels** (sponsorship, ad triggers) now get a cache-buster (`[CACHEBUSTING]` / `[timestamp]` macros are filled, otherwise `hp_cb` is added): a repeated impression of the same URL — e.g. the sponsor intro every N minutes — could be served from the browser's memory cache and never reach the server (Firefox).
- **Safari / iOS early seeks:** WebKit raises `readyState` before `loadedmetadata` and then resets a seek made in between back to 0. The QR resume `?vtime=` jump and the React Native `seek()` sent before the player is ready now verify the position on `seeked` and re-apply it. The same applies when a Cast session ends: playback continued locally from the start instead of the TV's position on WebKit, because `play()` was called before the seek had settled.
- **Taps could land on the wrong control:** when the player did not fit fully on screen, pressing any control focused the player and scrolled the page, so the release landed on whatever slid under the pointer (e.g. the story "next" button turned into a seek bar tap). The player now takes focus without scrolling.
- **Story mode:** a quick second "next" / "previous" tap while the previous item was still loading was silently dropped; it is now applied once the switch finishes.

### Project
- Docs: release notes page generated from this file; CDN install, browser support and accessibility sections on the install page; full event list.
- Examples (web component, React, Vue) updated to 1.0.17 with the redirect card and Cast.
- CI checks that every event declared in `HopePlayerEventMap` is actually dispatched.
- **Cross-browser tests:** the end-to-end suite now runs in Firefox and WebKit too (`npm run test:firefox` / `test:webkit`) — nightly, on demand and before every release (`cross-browser.yml`; publishing waits for it). Chromium runs on every push in 4 parallel shards (`run.mjs --shard`); CI skips documentation-only changes and cancels superseded runs. Engine-specific checks are guarded with `only()` (Playwright's WebKit has no HLS, Web Audio or Media Session, and stops a looping video at its end).

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
