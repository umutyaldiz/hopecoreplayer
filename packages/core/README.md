# @hopeplayer/core

**An open-source, monetization-first video player** — a framework-agnostic `<hope-player>` custom element (Shadow DOM, TypeScript) with Google IMA, Prebid, rewarded ads, sponsorships, out-of-page ad triggers and Chromecast with TV ads built in. Every feature is its own lazy-loaded chunk: nothing you don't configure is downloaded.

Full docs, live demos and the options reference: **[umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer)**

## Quick start (CDN, no build step)

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@hopeplayer/core@1/dist/hope-player.js"></script>

<hope-player src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" style="display:block;aspect-ratio:16/9"></hope-player>
```

Use the full `…/dist/hope-player.js` path — plugins load as relative chunks next to it (unpkg and esm.sh work the same way).

## Install

```bash
npm install @hopeplayer/core
```

```ts
import '@hopeplayer/core';

document.querySelector('hope-player').options = {
    src: '/video.m3u8',
    poster: '/poster.jpg',
    ads: { adTagPreroll: 'https://pubads.g.doubleclick.net/gampad/ads?…' },
    cast: { chromecast: true, airplay: true },
};
```

## Highlights

- **Playback:** MP4 / WebM / HLS (hls.js only when needed, native on Safari / iOS), live, fallback sources, quality and audio menus, captions, sprite thumbnails, chapters, playlist and story mode, audio player, PiP, Chromecast and AirPlay.
- **Monetization:** Google IMA (VAST / VMAP, overlays, OM SDK, SCTE-35, DAI), Prebid video with GAM `cust_params`, consent (TCF / USP / GPP), rewarded quality unlock, sponsorship layer, pause ads, rule-driven Ad Manager out-of-page ads — and ads keep playing on the TV when casting.
- **Shadow DOM** — styles never leak into (or get overridden by) the host page.
- **4 style presets** plus CSS custom properties (`--hp-color-accent`…) and `::part()` hooks.
- **i18n** — every label and ad-UI string follows `locale` / `labels`.
- **Wrappers:** [`@hopeplayer/react`](https://www.npmjs.com/package/@hopeplayer/react), [`@hopeplayer/vue`](https://www.npmjs.com/package/@hopeplayer/vue), [`@hopeplayer/react-native`](https://www.npmjs.com/package/@hopeplayer/react-native).

[Changelog](https://github.com/umutyaldiz/hopecoreplayer/blob/main/CHANGELOG.md) · [Contributing](https://github.com/umutyaldiz/hopecoreplayer/blob/main/CONTRIBUTING.md) · [Issues](https://github.com/umutyaldiz/hopecoreplayer/issues)

## License

MIT © [Umut Yaldız](https://www.umutyaldiz.com)
