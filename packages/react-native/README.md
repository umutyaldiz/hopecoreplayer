# @hopeplayer/react-native

React Native wrapper for [HopeCorePlayer](https://umutyaldiz.com/hopecoreplayer). It runs `<hope-player>` inside a [`react-native-webview`](https://github.com/react-native-webview/react-native-webview) and bridges props, commands and events, so it takes **the same options and callbacks as `@hopeplayer/react`**. Every feature works as on the web: HLS (quality / audio / subtitle menus), ads, subtitles, themes, skip buttons, double-tap gestures, stats.

Live demo: [Expo Snack](https://snack.expo.dev/@umutyaldiz/hopecoreplayer) (iOS / Android preview or Expo Go).

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
| `css` | `string` | — | CSS added to the WebView page: `--hp-*` theme tokens and `hope-player::part(...)` rules that go in a global stylesheet on the web. Changing it reloads the WebView. |
| `webViewProps` | `WebViewProps` | — | Extra props for the underlying WebView. |

Callbacks: `onReady`, `onPlay`, `onPause`, `onEnded`, `onError(message)`, `onTimeUpdate({ currentTime, duration, paused })` (about every 250 ms), `onQualityChange(label)`, `onRateChange(rate)`, `onAdStart(type)`, `onAdEnd(type)`, `onAdError(message)`, `onItemChange(index, source)`, `onPluginEvent(event, detail)`, and `onEvent(type, data)` for every bridge event.

Ref methods: `play()`, `pause()`, `seek(time)`, `setMuted(muted)`, `toggleStats(force?)`, `postToPlugin(plugin, data)`.

## Plugins

[Plugins](https://github.com/umutyaldiz/hopecoreplayer/blob/main/docs/PLUGIN_API.md) run inside the WebView, so instead of plugin objects the `plugins` prop takes ES modules — a URL or the module code — that export the plugin as `default` or `plugin`:

```tsx
const BADGE = `export default {
    name: 'badge',
    setup(player, options) {
        const layer = player.ui.addLayer({ position: 'top-left' });
        layer.el.textContent = options.text;
        player.on('badge:native', (e) => (layer.el.textContent = e.detail.text)); // from React Native
        player.ui.addButton({ label: 'Like', icon: 'play', onClick: () => player.emit('like', { at: player.currentTime }) });
    },
};`;

const ref = useRef<HopePlayerHandle>(null);

<HopePlayer
    ref={ref}
    src="https://example.com/video.mp4"
    plugins={[
        'https://cdn.example.com/plugins/watermark.js',                 // URL
        { url: 'https://cdn.example.com/plugins/ads.js', options: { tag: '…' } },
        { code: BADGE, options: { text: 'LIVE' } },                     // code bundled in the app
    ]}
    onPluginEvent={(event, detail) => console.log(event, detail)}   // 'badge:like', { at: 12.3 }
/>;

ref.current?.postToPlugin('badge', { text: 'REPLAY' });
```

- `player.emit('x', data)` in a plugin reaches `onPluginEvent('<plugin>:x', data)`; `data` must be JSON-serializable.
- `postToPlugin(name, data)` dispatches `<plugin>:native` on the player; listen with `player.on('<plugin>:native', (e) => e.detail)`.
- A plugin given as `code` keeps the same module while the code string is unchanged, so prop updates do not set it up again.
- Plugin modules cannot use bare imports (`import … from '@hopeplayer/core'`); `definePlugin` is optional — export a plain object.

## Notes

- **iOS:** inline playback and muted autoplay are enabled (`allowsInlineMediaPlayback`, `mediaPlaybackRequiresUserAction={false}`). The fullscreen button opens the native iOS video player.
- **Android:** `allowsFullscreenVideo` is enabled for the fullscreen button.
- **Offline / no CDN:** by default the WebView loads `@hopeplayer/core` from jsDelivr. To bundle it, serve `node_modules/@hopeplayer/core/dist/` from your own server or app assets and pass `coreUrl`.
- **Custom WebView setups:** `@hopeplayer/react-native/player-html` exports `buildPlayerHtml()` and `commandScript()` (no React Native dependency) if you want to build your own WebView integration.

## License

MIT
