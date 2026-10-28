# @hopeplayer/core

A dependency-free (except `hls.js`) `<hope-player>` custom element — Shadow DOM + Tailwind-based theming, real plugin code-splitting, and a framework-agnostic event API. Works in plain HTML, React, Vue, Next.js, or anywhere else a Custom Element runs.

Full docs, live demos, and the options/theming/plugin reference: **[umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer)**

## Install

```bash
npm install @hopeplayer/core
```

```ts
import '@hopeplayer/core';

document.querySelector('#player').options = {
    src: '/video.mp4',
    poster: '/poster.jpg',
};
```

```html
<hope-player src="/video.mp4" poster="/poster.jpg"></hope-player>
```

## Highlights

- **Zero runtime dependencies** besides `hls.js`, which is itself only downloaded (as a separate chunk) when the source is an `.m3u8` stream and the browser lacks native HLS support.
- **Shadow DOM** — the player's styles never leak into (or get overridden by) the host page.
- **Real plugin code-splitting** — ads, Prebid, playlist, story mode, markers, segments, sprite thumbnails, countdown/geo/redirect screens, dubbing, live/SCTE-35, DAI, and more each ship as their own dynamically-imported chunk. Nothing you don't configure is ever downloaded.
- **4 built-in style presets** (glass dark/light, neomorphism, flat) plus a CSS custom-property token system — set your brand color with a single `--hp-color-accent` token.
- **i18n built in** — every label, tooltip, and ad-UI string follows a single `locale`/`labels` option.
- Framework wrappers: [`@hopeplayer/react`](https://www.npmjs.com/package/@hopeplayer/react), [`@hopeplayer/vue`](https://www.npmjs.com/package/@hopeplayer/vue).

## License

MIT © [Umut Yaldız](https://www.umutyaldiz.com)
