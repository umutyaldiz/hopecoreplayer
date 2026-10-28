# Writing a plugin

Written for: developers adding a new feature to hopecoreplayer itself, or building their own plugin against the same pattern.

Every existing plugin (`packages/core/src/plugins/<name>/`) follows the same shape. There's no base class or registry to extend — it's a convention, enforced by how `HopePlayerElement` calls into plugins, not by any framework the plugin has to inherit from.

## Anatomy

```
plugins/my-feature/
  MyFeature.ts   — the class. Takes a context object + options in its constructor,
                   exposes destroy(). No knowledge of HopePlayerElement internals.
  index.ts       — the only file HopePlayerElement imports. Exports an
                   installMyFeature(ctx, options) factory + re-exports the class/types.
```

`index.ts`:

```ts
import { MyFeature, type MyFeaturePlayerContext } from './MyFeature';
import type { MyFeatureOptions } from '../../types';

export function installMyFeature(ctx: MyFeaturePlayerContext, options: MyFeatureOptions): MyFeature {
    return new MyFeature(ctx, options);
}

export { MyFeature };
export type { MyFeaturePlayerContext };
```

If install needs to be async (loading an external SDK, like `plugins/ads` or `plugins/dai` do), `installMyFeature` is `async` and awaits the class's own `install()` method instead of doing everything in the constructor — see `plugins/ads/index.ts` for the pattern.

## The context object

A plugin never touches `HopePlayerElement` directly. It receives a small, plugin-specific context interface — only the handful of things it actually needs, each one a plain value or a callback:

```ts
export interface MyFeaturePlayerContext {
    videoEl: HTMLVideoElement;
    hostEl: HTMLElement;              // for dispatching hp:* CustomEvents
    overlayContainerEl: HTMLElement;  // if you need to render UI over the video
    isAdActive(): boolean;            // if you need to coordinate with ad breaks
}
```

This keeps plugins independently testable (a test can construct a fake context without spinning up the whole player) and keeps `HopePlayerElement` from needing to know what any given plugin does internally — it just builds the context object and calls the install function.

## Wiring into `HopePlayerElement`

Three additions to `HopePlayerElement.ts`, all following the existing pattern exactly:

```ts
// 1. field
private myFeature: MyFeature | null = null;

// 2. in applyOptions(), gated on the option being present:
if (options.myFeature && !this.myFeature) {
    const { installMyFeature } = await import('./plugins/my-feature');
    this.myFeature = installMyFeature(
        { videoEl: this.videoEl, hostEl: this, overlayContainerEl: this.videoArea, isAdActive: () => this.isAdPlaying() },
        options.myFeature
    );
}

// 3. in disconnectedCallback():
this.myFeature?.destroy();
```

The `import()` in step 2 is what makes the plugin genuinely zero-cost when unused — not a comment, not a lazy-loading *intention*, an actual dynamic import that Vite splits into its own chunk. Every plugin's Playwright suite has a "plugin isolation" test that asserts this by diffing network requests with and without the option set; copy that test when you add a plugin.

## Options type

Add the plugin's options interface to `packages/core/src/types/index.ts`, and a field to `HopePlayerOptions`:

```ts
export interface MyFeatureOptions {
    someSetting?: string;
}
```
```ts
export interface HopePlayerOptions {
    // ...
    myFeature?: MyFeatureOptions;
}
```

Then export the new types from `packages/core/src/index.ts` so integrators get them from `@hopeplayer/core`.

## Events

If your plugin needs to tell the outside world something happened, dispatch a namespaced `CustomEvent` on `ctx.hostEl` — don't invent a new event bus:

```ts
ctx.hostEl.dispatchEvent(new CustomEvent('hp:myfeature', { detail: { ... } }));
```

Add the event's type to `HopePlayerEventMap` in `types/index.ts` so it's typed for consumers.

## If your plugin needs chrome hidden (blocks playback / covers the video)

Use `HopePlayerElement.blockChrome(key)` / `unblockChrome(key)` (exposed as plain public methods, not part of a context interface, since they're meant to be called directly by `HopePlayerElement`'s own wiring code — see how `countdown-screen`/`geo-checker`'s context in `plugins/shared/GatePlayerContext.ts` wraps them). Pick a unique key string for your plugin; don't reuse `'ads'` unless you genuinely are ad-related. See `docs/ARCHITECTURE.md` for why this is a keyed set rather than a boolean.

## If your plugin needs a settings-menu entry

Don't modify `SettingsMenu.ts`. Add `registerSubmenu`/`unregisterSubmenu` to your plugin's context interface, have `HopePlayerElement` wire them to `this.controlBar.settingsMenu`, and call `ctx.registerSubmenu(...)` from your plugin (and `ctx.unregisterSubmenu(key)` in `destroy()`) — see `docs/THEMING.md` for the signature and `plugins/dubbing/Dubbing.ts` for a complete example. This keeps `SettingsMenu` plugin-agnostic, which is what keeps it zero-cost for integrators who don't use your plugin.

## Styling

Use the `hp-chip` class (see `docs/THEMING.md`) for any new button/panel so it automatically matches whichever theme preset the integrator has chosen, instead of hardcoding colors. Give new elements a `part="..."` attribute so integrators can target them with `::part()` from outside the Shadow DOM, and add the part name to the table in `docs/THEMING.md`.

**Avoid Tailwind's `translate-x-*`/`translate-y-*`/`scale-*` utility classes inside this Shadow DOM.** There's a real, verified bug (see the comment block in `theme/tailwind.css`) where Tailwind v4's standalone `translate`/`scale` CSS properties resolve to `none` when only one axis is set by a utility class on an element. Use the `.hp-center-x`/`.hp-center-y` helper classes, or a plain inline `style.transform`, instead.

## Text and labels (i18n)

Every piece of chrome text your plugin shows — button labels, headings, fallback strings — comes from `ctx.i18n`, not a hardcoded literal. Add your keys to `HopeLocaleStrings` (`packages/core/src/i18n/types.ts`) plus both built-in dictionaries (`i18n/locales/tr.ts`, `en.ts`), add `i18n: HopeLocaleStrings` to your plugin's context interface, and have `HopePlayerElement` pass `this.i18n` when constructing that context (same object reference every time — it's a single shared, mutable object, not a new one per locale change).

Two cases:
- **Reactively re-rendered** (you already rebuild the DOM on some other trigger — a settings submenu, a countdown tick, a freshly-created popup): just read `ctx.i18n.yourKey` at render time. Nothing else to do — mutating the shared object's fields is enough, your next render picks it up.
- **Set once, never revisited** (an `aria-label` set in the constructor and left alone): expose a `refreshLabels(): void` method that re-applies it from `ctx.i18n`, and call it unconditionally from `HopePlayerElement.applyOptions()`'s locale block (see the other plugins' `this.xyz?.refreshLabels()` calls). If your plugin's `install*()` function returns a plain function (like `installSticky`/`installLoopSection`) rather than a class instance, attach `refreshLabels` as a property on that function instead (functions are objects — see `plugins/sticky/StickyManager.ts`'s `StickyUnregister` type for the pattern).

Give every icon-only button an `aria-label` — that's both the accessibility label AND the only thing the hover tooltip needs. **Don't set `title`.** `controls/Tooltip.ts` is a single delegated listener (mounted once on `.video-area` in `HopePlayerElement`'s constructor) that shows a themed popup for *any* `button[aria-label]`/`[role="slider"][aria-label]` automatically — a new button gets a tooltip for free the moment it has an `aria-label`, no per-component wiring needed. Setting `title` too would show the browser's own native tooltip stacked on top of it. If your button has a real, documented keyboard shortcut (check `keyboard/KeyboardController.ts` first — don't invent one), set `btn.dataset.shortcut = 'X'` and the tooltip shows it as a small pill, YouTube-style. A button with visible text (a menu row, "Cancel"/"Play now") doesn't match the tooltip's selector and doesn't need either attribute for this purpose. Want to exclude a specific `aria-label`'d element from the tooltip (rare — the seek bar is, since you hover it constantly while scrubbing)? Add its `part` value to `EXCLUDE_PARTS` in `Tooltip.ts`.

Never match against translated text to detect state (e.g. "does this button's label contain 'pause'?") — it silently breaks for any locale/labels override. Use a `part` attribute, an icon class (`hp-icon-*`), or actual component state instead.

## Testing

Write `apps/playground/test/<area>.e2e.mjs` (or add to an existing one if your plugin is thematically close to an existing suite). Add a demo scenario to `apps/playground/src/main.ts` behind a `?feature=` query param. If your plugin depends on an external SDK, write a `_mock-<sdk>.js` following the existing ones (`_mock-ima.js`, `_mock-pbjs.js`, `_mock-dai.js`) and inject it via `page.addInitScript` *before* `page.goto` — never test against the real SDK's network calls, they fail in sandboxed CI-like environments. If your plugin needs no external SDK, prefer driving it with the real browser API over mocking anything, the way `interaction.e2e.mjs` and `theme.e2e.mjs` do.
