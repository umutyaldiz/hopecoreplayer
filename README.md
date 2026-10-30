# HopeCorePlayer

[Türkçe](./README.tr.md)

[![CI](https://github.com/umutyaldiz/hopecoreplayer/actions/workflows/ci.yml/badge.svg)](https://github.com/umutyaldiz/hopecoreplayer/actions/workflows/ci.yml)
[![npm @hopeplayer/core](https://img.shields.io/npm/v/%40hopeplayer%2Fcore.svg?label=%40hopeplayer%2Fcore)](https://www.npmjs.com/package/@hopeplayer/core)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A framework-agnostic video player. `<hope-player>` is a dependency-free (except `hls.js`) Custom Element with Shadow DOM encapsulation, Tailwind-based theming, and real plugin code-splitting — it works the same way in plain HTML, React, Vue, and Next.js.

**Docs, live demos, and the full options/theming/plugin reference:** **[umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer)**

## Install

```bash
npm install @hopeplayer/core
```

```html
<script type="module">
  import '@hopeplayer/core';
</script>

<hope-player src="/video.mp4" poster="/poster.jpg"></hope-player>
```

Or with a framework wrapper:

```bash
npm install @hopeplayer/core @hopeplayer/react   # React / Next.js
npm install @hopeplayer/core @hopeplayer/vue     # Vue 3
npx expo install @hopeplayer/react-native react-native-webview   # React Native
```

See the [install guide](https://umutyaldiz.com/hopecoreplayer/install) for full React/Vue examples, props, and events.

## Live demos

Editable examples that run in the browser on StackBlitz (best in Chrome / Edge), using the packages published on npm:

| | |
|---|---|
| Web Component | [Open in StackBlitz](https://stackblitz.com/edit/hopecoreplayer-vanilla?file=src/main.ts) · [`examples/vanilla`](./examples/vanilla) |
| React | [Open in StackBlitz](https://stackblitz.com/edit/hopecoreplayer-react?file=src/App.tsx) · [`examples/react`](./examples/react) |
| Vue | [Open in StackBlitz](https://stackblitz.com/edit/hopecoreplayer-vue?file=src/App.vue) · [`examples/vue`](./examples/vue) |
| React Native | [Open in Expo Snack](https://snack.expo.dev/@umutyaldiz/hopecoreplayer) · [`examples/react-native-expo`](./examples/react-native-expo) |

## Why

- **Zero runtime dependencies** besides `hls.js`, which is only downloaded (as its own chunk) when the source is HLS and the browser lacks native support.
- **Shadow DOM** — player styles never leak into, or get overridden by, the host page.
- **Real plugin code-splitting** — ads (direct Google IMA integration, no `videojs-ima`), Prebid, consent (TCF/USP/GPP), playlist, story mode, markers, segments, sprite thumbnails, countdown/geo/redirect screens, QR resume, dubbing, live wall clock, SCTE-35, DAI, and more each ship as their own dynamically-imported chunk. Nothing you don't configure is ever downloaded or parsed.
- **4 style presets** (glass dark/light, neomorphism, flat) plus a CSS custom-property token system — the default accent is white; set your brand color with a single `--hp-color-accent` token.
- **i18n built in** — every label, tooltip, and ad-UI string follows a single `locale`/`labels` option.
- **One event API** — standard, namespaced DOM `CustomEvent`s (`hp:ready`, `hp:play`, `hp:adstart`, ...), listenable from any framework.

## Packages

| Package | Description |
|---|---|
| [`@hopeplayer/core`](./packages/core) | The `<hope-player>` custom element. |
| [`@hopeplayer/react`](./packages/react) | Thin React wrapper (prop/event bridge, SSR-safe for Next.js App Router). |
| [`@hopeplayer/vue`](./packages/vue) | Thin Vue 3 wrapper (same architecture as the React wrapper). |
| [`@hopeplayer/react-native`](./packages/react-native) | React Native wrapper — runs the player in a WebView with the same options and callbacks as the React wrapper. |

## Monorepo layout

```
packages/core     — <hope-player> custom element (zero runtime dependencies)
packages/react    — thin React wrapper
packages/vue      — thin Vue 3 wrapper
packages/react-native — React Native wrapper (WebView bridge)
apps/playground   — plain HTML/TS dev environment
docs/             — architecture / plugin / theming reference docs
examples/vanilla, react, vue — StackBlitz live demos (separate install, not workspaces)
examples/react-native-expo — Expo app (separate install, not a workspace)
```

(The marketing/docs website itself, built with Next.js static export and deployed separately to [umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer), is developed locally but is intentionally not part of this repository.)

## Development

```bash
npm install
npm run build:core          # builds @hopeplayer/core (dist/hope-player.js)
npm run dev                  # opens apps/playground on a Vite dev server
npm run typecheck            # typechecks every workspace
npm test                     # full Playwright suite (ads, prebid/consent, interaction, content-ops, live, theme, i18n)
```

See [README.tr.md](./README.tr.md) for the full, detailed development log (every phase, every bug found and fixed, with root causes) — it's substantially more exhaustive than this file.

## License

MIT © [Umut Yaldız](https://www.umutyaldiz.com)
