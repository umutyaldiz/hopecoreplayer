# HopeCorePlayer — React Native (Expo) example

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
