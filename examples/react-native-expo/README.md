# HopeCorePlayer — React Native (Expo) example

[Open in Expo Snack](https://snack.expo.dev/@umutyaldiz/hopecoreplayer) — runs on your phone with Expo Go or in Snack's iOS / Android preview.

A small Expo app using `@hopeplayer/react-native`: an HLS stream and an MP4 with subtitles, skip buttons, double-tap gestures, the stats panel, `ref` commands (play / pause / +10 s / stats) and an event log.

This folder is **not** part of the monorepo's npm workspaces (React Native needs React 19; the web packages are developed with React 18). Install it on its own.

## Run

```bash
cd examples/react-native-expo
npm install
npx expo install --fix   # aligns react / react-native / react-native-webview with your Expo SDK
npx expo start
```

Then scan the QR code with **Expo Go** on your phone (Android or iOS), or press `a` / `i` for an emulator / simulator.

The app loads `@hopeplayer/react-native` from npm. To try local changes to the package instead, build it (`npm run build --workspace=packages/react-native` at the repo root) and change the dependency to `"file:../../packages/react-native"`.

## Expo Snack

[`snack/App.js`](./snack/App.js) is a plain JavaScript copy of `App.tsx` for [Expo Snack](https://snack.expo.dev), which opens code loaded through `sourceUrl` as `App.js`. Keep it in sync when `App.tsx` changes.
