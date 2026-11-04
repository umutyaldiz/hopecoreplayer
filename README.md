# HopeCorePlayer

[Türkçe](./README.tr.md)

[![CI](https://github.com/umutyaldiz/hopecoreplayer/actions/workflows/ci.yml/badge.svg)](https://github.com/umutyaldiz/hopecoreplayer/actions/workflows/ci.yml)
[![npm @hopeplayer/core](https://img.shields.io/npm/v/%40hopeplayer%2Fcore.svg?label=%40hopeplayer%2Fcore)](https://www.npmjs.com/package/@hopeplayer/core)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**An open-source, monetization-first video player.** `<hope-player>` is a framework-agnostic Custom Element (Shadow DOM, TypeScript) with Google IMA, Prebid, rewarded ads, sponsorships, out-of-page ad triggers and Chromecast with TV ads built in — every feature is its own lazy-loaded chunk, so you only download what you configure. It works the same in plain HTML, React, Vue, Next.js and React Native.

**Docs, live demos and the full options reference:** **[umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer)**

## Quick start — one line, no build step

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@hopeplayer/core@1/dist/hope-player.js"></script>

<hope-player src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" style="display:block;aspect-ratio:16/9"></hope-player>
```

That's it: HLS, the quality menu, captions and keyboard shortcuts work out of the box. Configure everything else from JavaScript:

```html
<script type="module">
  const player = document.querySelector('hope-player');
  player.options = {
    src: '/video.m3u8',
    poster: '/poster.jpg',
    locale: 'en',
    ads: { adTagPreroll: 'https://pubads.g.doubleclick.net/gampad/ads?…' },
    cast: { chromecast: true, airplay: true },
  };
  player.addEventListener('hp:play', () => console.log('playing'));
</script>
```

> Use the full `…/dist/hope-player.js` path on CDNs — the player loads its plugins as relative chunks next to that file. unpkg (`https://unpkg.com/@hopeplayer/core@1/dist/hope-player.js`) and esm.sh work the same way.
>
> **In production, pin an exact version** (`@hopeplayer/core@1.0.17/dist/hope-player.js`): CDNs cache version ranges like `@1` for a while, so a new release can take time to show up, while an exact version URL never changes and is cached for good. Plugin chunks have content hashes in their names (`ads-DPL7m9PV.js`), so a new release never serves a stale chunk.

## Install with npm

```bash
npm install @hopeplayer/core                          # web component
npm install @hopeplayer/core @hopeplayer/react        # React / Next.js
npm install @hopeplayer/core @hopeplayer/vue          # Vue 3 / Nuxt
npx expo install @hopeplayer/react-native react-native-webview   # React Native
```

```js
import '@hopeplayer/core';
```

```jsx
import { HopePlayer } from '@hopeplayer/react';

<HopePlayer src="/video.m3u8" poster="/poster.jpg" cast={{ chromecast: true }} onPlay={() => {}} />;
```

See the [install guide](https://umutyaldiz.com/hopecoreplayer/install) for Vue, Next.js (SSR-safe) and React Native.

## Live demos

| | |
|---|---|
| Web Component | [Open in StackBlitz](https://stackblitz.com/edit/hopecoreplayer-vanilla?file=src/main.ts) · [`examples/vanilla`](./examples/vanilla) |
| React | [Open in StackBlitz](https://stackblitz.com/edit/hopecoreplayer-react?file=src/App.tsx) · [`examples/react`](./examples/react) |
| Vue | [Open in StackBlitz](https://stackblitz.com/edit/hopecoreplayer-vue?file=src/App.vue) · [`examples/vue`](./examples/vue) |
| React Native | [Open in Expo Snack](https://snack.expo.dev/@umutyaldiz/hopecoreplayer) · [`examples/react-native-expo`](./examples/react-native-expo) |

## Features

**Playback** — MP4 / WebM / HLS (hls.js, loaded only for HLS; native on Safari / iOS), live streams with a wall clock, fallback sources (`sourcePriority`), quality menu, alternate audio, WebVTT and in-stream captions, sprite thumbnails, chapters and markers, playlist and story mode, audio player with vinyl mode, Picture-in-Picture, Chromecast and AirPlay.

**Monetization**
- Google IMA: preroll / midroll / postroll, VMAP, overlay ads, retry and waterfall, OM SDK, SCTE-35 for live, Google DAI.
- Prebid video header bidding (direct VAST or GAM, with custom `cust_params`), consent (TCF / USP / GPP).
- Rewarded quality unlock, sponsorship layer from your own API, pause ads, rule-driven Ad Manager out-of-page ads (`adTriggers`).
- Casting keeps the ads: VAST / VMAP breaks are sent to the TV.

**Engineering**
- **Shadow DOM** — player styles never leak into the page, and the page never breaks the player.
- **Real code-splitting** — every plugin is a dynamic import; nothing you don't configure is downloaded or parsed.
- **Theming** — 4 presets plus CSS custom properties (`--hp-color-accent`…) and `::part()` hooks.
- **i18n** — every label and ad-UI string follows `locale` / `labels` (Turkish and English included).
- **One event API** — namespaced DOM `CustomEvent`s (`hp:ready`, `hp:adstart`, `hp:cast`…), from any framework.
- **Tested** — a Playwright end-to-end suite, an accessibility scan and a bundle-size budget (about 68 KB gzip on first load) run on every change.

## Browser support

**Minimum:** Chrome / Edge 111+, Firefox 128+, Safari 16.4+ (macOS and iOS / iPadOS), Samsung Internet 22+ — the player's styles are built with Tailwind CSS v4, which [requires these versions](https://tailwindcss.com/docs/compatibility). Older browsers are not supported.

| Platform | Status |
|---|---|
| Chrome / Edge (desktop, Android) | ✅ Automated end-to-end tests on every change (Chromium), including mobile viewports |
| Safari (macOS), iOS / iPadOS Safari | ✅ Supported — native HLS, iPhone video fullscreen and AirPlay paths are handled; verified manually on iPhone |
| Firefox | ✅ Supported — no automated tests yet |
| React Native (iOS / Android WebView) | ✅ Bridge covered by automated tests; WebView behaves like the platform browser |
| Chromecast / Google TV, Apple TV | ⚠️ Implemented against the official SDKs and covered by tests with simulated SDKs — not yet verified on real devices |
| Smart TV browsers (Tizen, webOS) | ❌ Not tested |

Found a problem on a browser or device? Please [open an issue](https://github.com/umutyaldiz/hopecoreplayer/issues/new?template=bug_report.yml) with the browser and version.

**Accessibility:** controls are reachable and operable with the keyboard, have visible focus indicators and accessible names, and the player is scanned with axe-core (WCAG 2.1 A / AA) in CI — including menus, dialogs and overlays.

## How it compares

| | HopeCorePlayer | video.js | Plyr | JW Player |
|---|---|---|---|---|
| License | MIT | Apache-2.0 | MIT | Commercial |
| Delivered as | Web component | JS library | JS library | JS library (hosted) |
| HLS | Built in (hls.js, lazy) | Built in (VHS) | Bring your own hls.js | Built in |
| Google IMA (VAST / VMAP) | Built in | Plugin (`videojs-ima`) | — | Built in |
| Prebid header bidding | Built in | Third-party plugins | — | Built in |
| Chromecast | Built in, with TV ads | Third-party plugin | — | Built in |
| Rewarded unlock / sponsorship / out-of-page triggers | Built in | — | — | — |
| React / Vue / React Native | Official wrappers | Community | Community | Official SDKs |

Based on each project's documentation as of November 2026 — corrections are welcome via an issue.

## Packages

| Package | Description |
|---|---|
| [`@hopeplayer/core`](./packages/core) | The `<hope-player>` custom element. |
| [`@hopeplayer/react`](./packages/react) | Thin React wrapper (prop/event bridge, SSR-safe for Next.js App Router). |
| [`@hopeplayer/vue`](./packages/vue) | Thin Vue 3 wrapper. |
| [`@hopeplayer/react-native`](./packages/react-native) | React Native wrapper — runs the player in a WebView with the same options and callbacks. |

All four are released together with the same version — see the [CHANGELOG](./CHANGELOG.md) and its versioning policy.

## Contributing

Bug reports, docs fixes and pull requests are welcome, in English or Turkish — see [CONTRIBUTING.md](./CONTRIBUTING.md). Please report security issues privately as described in [SECURITY.md](./SECURITY.md).

```bash
npm install
npx playwright install chromium
npm run build:core
npm run dev          # playground on http://localhost:5183
npm test             # full end-to-end suite (run with the playground up)
```

Repository layout: `packages/*` (core and wrappers), `apps/playground` (dev page and tests), `examples/*` (StackBlitz / Expo demos), `docs/` (architecture, plugin and theming notes). The documentation website is deployed separately and is not part of this repository.

## License

MIT © [Umut Yaldız](https://www.umutyaldiz.com)
