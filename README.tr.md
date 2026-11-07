# HopeCorePlayer

[English](./README.md)

[![CI](https://github.com/umutyaldiz/hopecoreplayer/actions/workflows/ci.yml/badge.svg)](https://github.com/umutyaldiz/hopecoreplayer/actions/workflows/ci.yml)
[![Firefox + WebKit](https://img.shields.io/github/actions/workflow/status/umutyaldiz/hopecoreplayer/cross-browser.yml?label=Firefox%20%2B%20WebKit)](https://github.com/umutyaldiz/hopecoreplayer/actions/workflows/cross-browser.yml)
[![Safari (macOS + iOS)](https://img.shields.io/github/actions/workflow/status/umutyaldiz/hopecoreplayer/apple.yml?label=Safari%20%28macOS%20%2B%20iOS%29)](https://github.com/umutyaldiz/hopecoreplayer/actions/workflows/apple.yml)

[![npm @hopeplayer/core](https://img.shields.io/npm/v/%40hopeplayer%2Fcore.svg?label=%40hopeplayer%2Fcore)](https://www.npmjs.com/package/@hopeplayer/core)
[![npm @hopeplayer/react](https://img.shields.io/npm/v/%40hopeplayer%2Freact.svg?label=%40hopeplayer%2Freact)](https://www.npmjs.com/package/@hopeplayer/react)
[![npm @hopeplayer/vue](https://img.shields.io/npm/v/%40hopeplayer%2Fvue.svg?label=%40hopeplayer%2Fvue)](https://www.npmjs.com/package/@hopeplayer/vue)
[![npm @hopeplayer/react-native](https://img.shields.io/npm/v/%40hopeplayer%2Freact-native.svg?label=%40hopeplayer%2Freact-native)](https://www.npmjs.com/package/@hopeplayer/react-native)
[![npm indirme](https://img.shields.io/npm/dm/%40hopeplayer%2Fcore.svg)](https://www.npmjs.com/package/@hopeplayer/core)
[![jsDelivr](https://img.shields.io/jsdelivr/npm/hm/%40hopeplayer%2Fcore.svg)](https://www.jsdelivr.com/package/npm/@hopeplayer/core)

[![TypeScript types](https://img.shields.io/npm/types/%40hopeplayer%2Fcore.svg)](./packages/core/src/types/index.ts)
[![hls.js](https://img.shields.io/npm/dependency-version/%40hopeplayer%2Fcore/hls.js.svg)](https://github.com/video-dev/hls.js)
[![Tailwind CSS](https://img.shields.io/npm/dependency-version/%40hopeplayer%2Fcore/dev/tailwindcss.svg?label=Tailwind%20CSS)](https://tailwindcss.com)
[![Web Component](https://img.shields.io/badge/Web%20Component-Custom%20Element-29abe2.svg)](https://developer.mozilla.org/docs/Web/API/Web_components)
[![ilk yükleme](https://img.shields.io/badge/ilk%20y%C3%BCkleme-~68%20KB%20gzip-brightgreen.svg)](./packages/core/scripts/check-size.mjs)
[![a11y](https://img.shields.io/badge/a11y-WCAG%202.1%20AA%20%28axe%29-blue.svg)](./apps/playground/test/a11y.e2e.mjs)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Bağımlılıksız (hls.js hariç), TypeScript + Shadow DOM + Tailwind tabanlı, framework-agnostic bir `<hope-player>` custom element'i. Düz HTML, React, Vue, Next.js — hepsinde aynı şekilde çalışır.

Kurulum rehberi, canlı demolar ve tüm options/tema/plugin referansı: **[umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer)**

**Reklam ve gelir odaklı açık kaynak video player:** Google IMA, Prebid, ödüllü reklam, sponsorluk, out-of-page reklam tetikleyici ve TV'de reklamlı Chromecast tek pakette. Her özellik ayrı, gerektiğinde yüklenen bir parça.

## Hızlı başlangıç — tek satır, derleme yok

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@hopeplayer/core@1/dist/hope-player.js"></script>

<hope-player src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" style="display:block;aspect-ratio:16/9"></hope-player>
```

CDN'de tam `…/dist/hope-player.js` yolunu kullanın — player eklentilerini bu dosyanın yanındaki parçalardan yükler. unpkg ve esm.sh de aynı şekilde çalışır. Canlı sitede tam sürüm kullanın (`@hopeplayer/core@1.2.0/dist/hope-player.js`): CDN'ler `@1` gibi aralıkları bir süre önbellekte tutar, yeni sürüm hemen görünmeyebilir; tam sürümlü adres hiç değişmez. Eklenti parçalarının adında içerik hash'i var (`ads-DPL7m9PV.js`), yeni sürümde eski parça önbellekten gelmez.

npm ile: `npm install @hopeplayer/core` (React: `@hopeplayer/react`, Vue: `@hopeplayer/vue`, React Native: `@hopeplayer/react-native`).

**Tarayıcı desteği:** Chrome / Edge 111+, Firefox 128+, Safari 16.4+ (macOS, iOS / iPadOS), Samsung Internet 22+ (stiller Tailwind CSS v4 ile derleniyor, [alt sınırları](https://tailwindcss.com/docs/compatibility) bunlar). Chromium'da her değişiklikte uçtan uca test, erişilebilirlik taraması (axe-core, WCAG 2.1 A/AA) ve boyut bütçesi (ilk yükleme ~68 KB gzip) çalışır; Firefox ve WebKit testleri her gece ve her sürümden önce, ses kartı olmayan Linux (Ubuntu 24.04) makinelerinde: masaüstünde görünmeyen gerçek hataları da yakalıyor (ör. Firefox'un ses aygıtı yokluğunu ölümcül hata sayması, WebKitGTK / WPE'nin sarmaları kaybetmesi). Gerçek Safari'de (macOS) ve iOS Simulator'daki Safari'de duman testleri her gece GitHub'ın macOS makinelerinde çalışır (oynatma, sarma, altyazı, native HLS, QR ile devam, ses modu). Aynı ortam yerelde Docker ile birebir çalıştırılabilir: `npm run test:linux` (yalnızca bir motor / takım: `npm run test:linux -- webkit cast`). iPhone'da elle doğrulandı; Chromecast / Apple TV sahte SDK'larla test edildi, gerçek cihazda henüz doğrulanmadı. Ayrıntılı tablo: [README.md → Browser support](./README.md#browser-support).

Sürüm notları: [CHANGELOG.md](./CHANGELOG.md) · Katkı: [CONTRIBUTING.md](./CONTRIBUTING.md) (Türkçe issue / PR olur) · Güvenlik: [SECURITY.md](./SECURITY.md)

## Canlı demolar

npm'deki paketleri kullanan, tarayıcıda StackBlitz üzerinde çalışan düzenlenebilir örnekler (en iyi Chrome / Edge'de çalışır):

| | |
|---|---|
| Web Component | [StackBlitz'te aç](https://stackblitz.com/edit/hopecoreplayer-vanilla?file=src/main.ts) · [`examples/vanilla`](./examples/vanilla) |
| React | [StackBlitz'te aç](https://stackblitz.com/edit/hopecoreplayer-react?file=src/App.tsx) · [`examples/react`](./examples/react) |
| Vue | [StackBlitz'te aç](https://stackblitz.com/edit/hopecoreplayer-vue?file=src/App.vue) · [`examples/vue`](./examples/vue) |
| React Native | [Expo Snack'te aç](https://snack.expo.dev/@umutyaldiz/hopecoreplayer) · [`examples/react-native-expo`](./examples/react-native-expo) |

## Geliştirme

```bash
npm install
npx playwright install chromium
npm run build:core   # @hopeplayer/core'u derler (dist/hope-player.js)
npm run dev          # apps/playground'u Vite dev server'da açar (http://localhost:5183)
npm test             # tüm uçtan uca test takımı (playground açıkken)
```

## Yapı

```
packages/core     — <hope-player> custom element (sıfır çalışma zamanı bağımlılığı)
packages/react    — ince React wrapper
packages/vue      — ince Vue 3 wrapper (aynı mimari: mount sonrası dinamik import, prop/event köprüsü)
packages/react-native — React Native wrapper (WebView köprüsü; React ile aynı seçenekler ve callback'ler)
apps/playground   — düz HTML/TS dev ortamı
examples/vanilla, react, vue — StackBlitz canlı demoları (ayrı kurulur, workspace değil)
examples/react-native-expo — Expo örneği (ayrı kurulur, workspace değil)
apps/docs         — kurulum + canlı demo sitesi (statik export; bu repoya/npm'e dahil DEĞİL — bkz. .gitignore, umutyaldiz.com'da ayrıca yayınlanıyor)
docs/             — mimari/plugin/tema dokümantasyonu
```

## Lisans

MIT © [Umut Yaldız](https://www.umutyaldiz.com)
