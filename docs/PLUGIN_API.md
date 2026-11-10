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

All types are exported from `@hopeplayer/core` (`HopePlugin`, `PlayerApi`, `PluginEntry`…).

## Cost

`definePlugin` and `registerPlugin` are part of the main bundle and tiny. The code that runs plugins is a separate chunk, downloaded only when a plugin is used.

## Built-in features on the same API

The "Skip intro" buttons (`skipSegments`) are implemented as a plugin on this public API — a third-party plugin can do everything they do.

## Coming next

- Ads (`player.ads`): custom ad formats with `requestBreak`, preroll / midroll / pause / postroll hooks and ad-tag transforms.
- React Native: plugins as script URLs inside the WebView.
