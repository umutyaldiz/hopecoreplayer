# Plugin API

Written for: developers who want to add their own buttons, overlays, settings or behaviour to `<hope-player>`.

A plugin is a plain object with a `name` and a `setup(player, options)` function. Everything you add through the `player` object — event listeners, buttons, layers, settings rows, shortcuts, timers — is removed automatically when the plugin is removed, so you rarely need cleanup code. Errors thrown inside a plugin are caught and written to the player's error log; they never break playback.

The API is versioned (`PLUGIN_API_VERSION`, currently `1`) and covered by semver: a breaking change to it means a new major version of `@hopeplayer/core`.

## A complete plugin

```ts
import { definePlugin } from '@hopeplayer/core';

export const watermark = definePlugin<{ src: string }>({
    name: 'watermark',
    setup(player, options) {
        player.i18n.add({ en: { logo: 'Show logo' }, tr: { logo: 'Logoyu göster' } });

        const layer = player.ui.addLayer({ position: 'top-right', autoHide: true });
        layer.el.innerHTML = `<img src="${options.src}" alt="" style="height:28px">`;

        player.ui.addButton({
            label: () => player.i18n.t('logo'),
            icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>',
            active: true,
            onClick: (_event, button) => {
                button.setActive(!button.active);
                layer.toggle(button.active);
            },
        });

        player.settings.addToggle({ label: 'Logo', get: () => layer.visible, set: (v) => layer.toggle(v) });
        player.keys.add('w', () => layer.toggle(), 'Toggle logo');
    },
});
```

## Registering

```js
// One player
player.options = { plugins: [[watermark, { src: '/logo.svg' }]] };

// Loaded only when used
player.options = { plugins: [[() => import('./watermark.js'), { src: '/logo.svg' }]] };

// At runtime
const handle = player.use(watermark, { src: '/logo.svg' });
handle.remove();

// Every player on the page (also ones created later)
import { registerPlugin } from '@hopeplayer/core';
const unregister = registerPlugin(watermark, { src: '/logo.svg' });
```

React and Vue take the same list as a prop: `<HopePlayer plugins={[[watermark, { src: '/logo.svg' }]]} />`.

When the same name is registered twice, the player's own list wins over a page-wide registration. When a plugin's options change, `update(options)` is called if the plugin defines it; otherwise the plugin is removed and set up again with the new options.

## The `player` object

| Member | What it does |
|---|---|
| `element`, `video` | The `<hope-player>` element and the content `<video>` (ads play in a separate element). |
| `currentTime`, `duration`, `paused`, `isLive`, `isAdPlaying`, `isFullscreen`, `src`, `locale` | Read-only state. |
| `play()`, `pause()`, `seek(time)` | Playback. |
| `on(event, fn)`, `once(event, fn)` | Video events (`timeupdate`, `play`…) and player events (`hp:ready`, `hp:adstart`…). Returns an "off" function. |
| `emit(event, detail)` | Dispatches `<plugin-name>:<event>` on the element. |
| `onSourceChange(fn)`, `onLocaleChange(fn)`, `onDestroy(fn)` | Lifecycle hooks. |
| `setTimeout`, `setInterval` | Timers cleared when the plugin is removed. |
| `ui.addButton(options)` | A control-bar button (`position: 'left' \| 'right'`, SVG or built-in icon, optional on/off state). |
| `ui.addLayer(options)` | A layer over the video: `position` (`fill`, corners, `top`, `bottom`, `center`), `above` the controls, `autoHide` with the controls, `interactive`, scoped `css`. By default clicks pass through to the video; only buttons, links and inputs inside the layer are clickable. |
| `ui.toast(message)` | A short notice, announced to screen readers. |
| `settings.addToggle`, `addSelect`, `addSubmenu` | Rows in the settings menu. |
| `keys.add(key, fn, description)` | A shortcut (`'w'`, `'Shift+W'`). It never overrides the player's own keys and is listed in the `?` shortcut panel. |
| `i18n.add(strings)`, `i18n.t(key)` | The plugin's own TR/EN strings, following the player's language. Labels can be functions and are re-read when the language changes. |
| `storage.get/set/remove` | A `localStorage` area namespaced to the plugin. |
| `labels` | The player's built-in strings (read-only), e.g. to reuse "Close". |
| `log(message, details)` | Writes to the player's error log (right click → Debug log with `debug: true`). |
| `ads.*` | Custom ad formats — see [Ads](#ads). |

All types are exported from `@hopeplayer/core` (`HopePlugin`, `PlayerApi`, `PluginEntry`…).

## Ads

`player.ads` lets a plugin play its own ad formats (a house ad, a sponsor video, a self-hosted VAST player) with the same guarantees as the built-in IMA ads, and hook into the IMA requests.

### Ad breaks

`requestBreak(run, options?)` starts an ad break:

- the content pauses, the controls hide, and seeking and media keys (Space, K, J, L, arrows) are blocked;
- `player.isAdPlaying` is `true`, so playlist, redirect screen, QR resume and other features treat it as a real ad;
- `hp:adstart` / `hp:adend` fire with `{ type, linear: true, plugin }`;
- `run(ad)` receives `ad.layer` (a clickable layer above everything), `ad.type`, `ad.signal` and `ad.end()`.

The break ends when `run`'s promise settles, when `ad.end()` is called, after `timeoutMs` (default 60 s), or when the plugin is removed — then `ad.signal` aborts. The content resumes if it was playing (not after a postroll). If another ad is already playing, nothing starts and the returned promise resolves to `false`.

```js
import { definePlugin } from '@hopeplayer/core';

export const houseAd = definePlugin({
    name: 'house-ad',
    setup(player, { src, skipAfter = 5 }) {
        const play = () =>
            player.ads.requestBreak((ad) => new Promise((done) => {
                const video = document.createElement('video');
                video.src = src;
                video.autoplay = true;
                video.playsInline = true;
                video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
                video.onended = video.onerror = done;

                const skip = document.createElement('button');
                skip.textContent = 'Skip ad';
                skip.style.cssText = 'position:absolute;right:12px;bottom:12px;display:none';
                skip.onclick = () => ad.end();
                setTimeout(() => (skip.style.display = ''), skipAfter * 1000);

                ad.layer.append(video, skip);
                ad.signal.addEventListener('abort', () => video.pause());
            }));

        player.ads.beforeContent(play);          // preroll
        player.ads.atTime([300, 900], play);     // midrolls
        player.ads.onEnded(play);                // postroll
    },
});
```

The type (`preroll` / `midroll` / `postroll`) is inferred from the state; pass `options.type` to set it.

### Hooks

| Hook | When |
|---|---|
| `beforeContent(fn)` | The first play of each source waits until `fn`'s promise settles (preroll). The content does not start meanwhile; the gate gives up after 15 s. |
| `atTime(seconds, fn, { seekPast })` | Playback reaches a time naturally (midroll). When the viewer seeks past several marks, the last one fires once (`seekPast: 'last'`, default) or none (`'skip'`). Marks reset when the source changes. |
| `onPause(fn, { delayMs })` | The viewer paused and is still paused after `delayMs` (default 300 ms; not on seeking, ended or during an ad). Return a function to remove your pause ad when playback resumes. |
| `onEnded(fn)` | The video ended (postroll). Runs before the playlist and redirect screen; if `fn` starts a break synchronously, they wait for `hp:adend`. |
| `transformTag(fn)` | Rewrites every IMA ad tag URL right before it is requested (after Prebid), e.g. to add targeting: `(url, type) => url + '&cust=' + type`. |

Every hook returns an "off" function and is removed automatically with the plugin.

```js
// Pause ad
player.ads.onPause(() => {
    const layer = player.ui.addLayer({ position: 'center', interactive: true });
    layer.el.innerHTML = '<a href="https://example.com" target="_blank"><img src="/pause-ad.png" width="300"></a>';
    return () => layer.remove();
});

// Targeting for IMA
player.ads.transformTag((url, type) => `${url}&cust_params=${encodeURIComponent(`plugin=1&break=${type}`)}`);
```

## Cost

`definePlugin` and `registerPlugin` are part of the main bundle and tiny. The code that runs plugins is a separate chunk, downloaded only when a plugin is used.

## Built-in features on the same API

The "Skip intro" buttons (`skipSegments`) are implemented as a plugin on this public API — a third-party plugin can do everything they do.

## React Native

In `@hopeplayer/react-native` the player runs in a WebView, so `plugins` takes ES modules — a URL or the module code — instead of objects: `plugins={['https://cdn.example.com/watermark.js', { code: BADGE, options: { text: 'LIVE' } }]}`. `player.emit()` reaches the app through `onPluginEvent(event, detail)`, and `ref.postToPlugin(name, data)` arrives in the plugin as `<plugin>:native`. See the [React Native README](../packages/react-native/README.md#plugins).
