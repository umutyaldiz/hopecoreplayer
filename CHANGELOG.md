# Changelog

All notable changes to the `@hopeplayer/*` packages (`core`, `react`, `vue`, `react-native` — always released together with the same version) are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning policy

From 1.1.0 on, the project follows [Semantic Versioning](https://semver.org/) strictly:

- **Patch** (`1.1.x`) — bug fixes only. Safe to update at any time.
- **Minor** (`1.x.0`) — new features and new options, fully backward compatible. Defaults never change in a way that alters existing pages; new features ship off by default unless stated.
- **Major** (`x.0.0`) — breaking changes (removed / renamed options, changed defaults, dropped browsers). Each one is listed under **Breaking** with a migration note, and deprecated options keep working with a console warning for at least one minor release before removal.

During the initial 1.0.x line, new features were released as patch versions; that ends with 1.1.0.

## [Unreleased]

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

### Project
- `CHANGELOG.md` with a versioning policy, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates.
- npm `keywords` for all packages; README with a one-line CDN quick start and a comparison with other players.
- CI runs the full Playwright end-to-end suite on every push and pull request.

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

[Unreleased]: https://github.com/umutyaldiz/hopecoreplayer/compare/v1.0.17...HEAD
[1.0.17]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.17
[1.0.16]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.16
[1.0.15]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.15
[1.0.14]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.14
[1.0.13]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.13
[1.0.12]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.12
