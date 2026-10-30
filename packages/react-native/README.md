# @hopeplayer/react-native

React Native wrapper for [HopeCorePlayer](https://umutyaldiz.com/hopecoreplayer). It runs `<hope-player>` inside a [`react-native-webview`](https://github.com/react-native-webview/react-native-webview) and bridges props, commands and events, so it takes **the same options and callbacks as `@hopeplayer/react`**. Every feature works as on the web: HLS (quality / audio / subtitle menus), ads, subtitles, themes, skip buttons, double-tap gestures, stats.

## Install

```bash
npm install @hopeplayer/react-native react-native-webview
# Expo:
npx expo install @hopeplayer/react-native react-native-webview
```

`react-native-webview` is a native module: on bare React Native run `npx pod-install` for iOS after installing.

## Usage

```tsx
import { useRef } from 'react';
import { HopePlayer, type HopePlayerHandle } from '@hopeplayer/react-native';

export function Player() {
    const player = useRef<HopePlayerHandle>(null);
    return (
        <HopePlayer
            ref={player}
            style={{ width: '100%', aspectRatio: 16 / 9 }}
            src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
            muted
            skipButtons
            tapGestures
            onPlay={() => console.log('play')}
            onTimeUpdate={({ currentTime, duration }) => console.log(currentTime, duration)}
        />
    );
}

// player.current?.play() / pause() / seek(30) / setMuted(false) / toggleStats()
```

## Props

All [`HopePlayerOptions`](https://umutyaldiz.com/hopecoreplayer/install) are accepted as props. Changing them later updates the player without reloading the WebView. Options must be JSON-serializable: functions (for example `hls.config.xhrSetup`) cannot cross into the WebView.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `style` | `StyleProp<ViewStyle>` | — | Player box. Use `{ width: '100%', aspectRatio: 16 / 9 }` for 16:9. |
| `coreUrl` | `string` | jsDelivr, same version | `@hopeplayer/core` ESM entry the WebView loads. Set it to host the core yourself (offline / own CDN). |
| `baseUrl` | `string` | — | Page URL inside the WebView: relative media/subtitle paths resolve against it and `localStorage` uses its origin. |
| `backgroundColor` | `string` | `#000` | Shown until the player loads. |
| `webViewProps` | `WebViewProps` | — | Extra props for the underlying WebView. |

Callbacks: `onReady`, `onPlay`, `onPause`, `onEnded`, `onError(message)`, `onTimeUpdate({ currentTime, duration, paused })` (about every 250 ms), `onQualityChange(label)`, `onRateChange(rate)`, `onAdStart(type)`, `onAdEnd(type)`, `onAdError(message)`, `onItemChange(index, source)`, and `onEvent(type, data)` for every bridge event.

## Notes

- **iOS:** inline playback and muted autoplay are enabled (`allowsInlineMediaPlayback`, `mediaPlaybackRequiresUserAction={false}`). The fullscreen button opens the native iOS video player.
- **Android:** `allowsFullscreenVideo` is enabled for the fullscreen button.
- **Offline / no CDN:** by default the WebView loads `@hopeplayer/core` from jsDelivr. To bundle it, serve `node_modules/@hopeplayer/core/dist/` from your own server or app assets and pass `coreUrl`.
- **Custom WebView setups:** `@hopeplayer/react-native/player-html` exports `buildPlayerHtml()` and `commandScript()` (no React Native dependency) if you want to build your own WebView integration.

## License

MIT
