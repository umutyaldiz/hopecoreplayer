# HopeCorePlayer

[English](./README.md)

Bağımlılıksız (hls.js hariç), TypeScript + Shadow DOM + Tailwind tabanlı, framework-agnostic bir `<hope-player>` custom element'i. Düz HTML, React, Vue, Next.js — hepsinde aynı şekilde çalışır.

Kurulum rehberi, canlı demolar ve tüm options/tema/plugin referansı: **[umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer)**

## Canlı demolar

npm'deki paketleri kullanan, tarayıcıda StackBlitz üzerinde çalışan düzenlenebilir örnekler (en iyi Chrome / Edge'de çalışır):

| | |
|---|---|
| Web Component | [StackBlitz'te aç](https://stackblitz.com/github/umutyaldiz/hopecoreplayer/tree/main/examples/vanilla?file=src/main.ts) · [`examples/vanilla`](./examples/vanilla) |
| React | [StackBlitz'te aç](https://stackblitz.com/github/umutyaldiz/hopecoreplayer/tree/main/examples/react?file=src/App.tsx) · [`examples/react`](./examples/react) |
| Vue | [StackBlitz'te aç](https://stackblitz.com/github/umutyaldiz/hopecoreplayer/tree/main/examples/vue?file=src/App.vue) · [`examples/vue`](./examples/vue) |
| React Native | [`examples/react-native-expo`](./examples/react-native-expo) (Expo Go) |

## Kurulum

```bash
npm install
npm run build:core   # @hopeplayer/core'u derler (dist/hope-player.js)
npm run dev          # apps/playground'u Vite dev server'da açar
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
