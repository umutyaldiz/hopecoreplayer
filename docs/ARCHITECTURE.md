# Architecture

Written for: developers working on `hopecoreplayer` itself, or integrating it deeply enough to need to understand why it's built the way it is.

## The core decision: a Custom Element with Shadow DOM

`<hope-player>` is a native Web Component (`HTMLElement` subclass, `customElements.define`). This single choice is why the player works unmodified in React, Vue, Next.js, or a plain `<script>` tag — custom elements are a browser primitive, not a framework integration. Shadow DOM (`mode: 'open'`) gives style isolation in both directions: the host page's CSS can't leak in, and the player's own Tailwind-generated utility classes can't leak out (the `hp:` prefix on every Tailwind class is a second line of defense for the rare case where someone renders player markup outside a shadow root).

`packages/core` has **zero runtime dependencies** except `hls.js`, which is loaded via dynamic `import()` only when a `.m3u8` source is actually used and the browser lacks native HLS — never bundled statically, never fetched for an MP4-only integration.

## Plugin architecture: real code-splitting, not a convention

The core (`HopePlayerElement.ts` + `controls/`, `hls/`, `screens/`, `subtitles/`, `keyboard/`) handles only playback itself: play/pause/seek/volume/fullscreen/PIP, native `<track>` subtitles, the settings menu, HLS quality switching. Everything else — ads, Prebid, consent, playlist, story, sticky, gesture, markers, segments, sprite-thumbnails, countdown/geo gate screens, redirect-screen, QR resume, dubbing, live wall clock, SCTE-35, DAI — lives under `plugins/<name>/` and is loaded with a dynamic `import('./plugins/<name>')` **gated on the corresponding option being present**:

```ts
if (options.ads && !this.adsController) {
    const { installAds } = await import('./plugins/ads');
    this.adsController = await installAds(ctx, adsOptions);
}
```

If `options.ads` is never set, that `import()` statement never executes, so the ads chunk (IMA SDK wiring, retry logic, VMAP handling, Prebid, consent) is never fetched or parsed. This is verified, not just assumed: every phase's Playwright suite includes an isolation test that loads the player with and without a feature's option and asserts the feature's chunk only appears in the network log in the second case. Build output confirms it structurally too — `vite build` emits one `chunks/*.js` file per plugin, separate from the main `hope-player.js` entry.

A few plugins are sub-features of the ads plugin rather than top-level (Prebid, TCF/USP consent, SCTE-35) because they need the ad-request/retry machinery `AdsController` already owns — making them separate plugins would mean either duplicating that machinery or building a cross-plugin dependency, both worse than accepting that they share the ads chunk. Everything else is a fully independent plugin.

## State that crosses plugin boundaries

A few mechanisms are deliberately centralized in `HopePlayerElement` because multiple plugins need to coordinate through them:

- **`blockChrome(key)` / `unblockChrome(key)`** — a keyed set, not a boolean. Ads, the countdown-screen gate, and the geo-checker gate can each independently hold the control-bar/center-button hidden; chrome only reappears once every key has been released. (This used to be a single `isAdActive` boolean before the countdown/geo gate screens needed the same mechanism — generalizing it was a small, deliberate refactor, not scope creep.)
- **`isAdPlaying()`** — checks specifically for the `'ads'` blocker key, used by gesture/sticky/in-view-autoplay/redirect-screen to avoid fighting with the ad state machine.
- **`SettingsMenu.registerSubmenu()` / `unregisterSubmenu()`** — lets a plugin (currently only `dubbing`) add a menu entry without `SettingsMenu` knowing that plugin exists, so the menu adds no weight when the plugin isn't loaded. The plugin doesn't get the `SettingsMenu` object: `HopePlayerElement` passes both methods in as `ctx.registerSubmenu`/`ctx.unregisterSubmenu` callbacks on the plugin's context. See `docs/THEMING.md` for the full signature.
- **The sticky manager is a module-level singleton** (`plugins/sticky/StickyManager.ts`), not per-player state — "only one sticky player at a time" and "another player starting playback closes the active sticky" are page-wide rules by nature.

## Testing methodology

Every phase is verified with real Playwright browser tests (`apps/playground/test/*.e2e.mjs`), not unit tests against mocked DOM. Real ad/CDN network calls fail in sandboxed environments (COOP/insecure-origin restrictions), so wherever a feature depends on an external SDK (`google.ima`, `google.ima.dai`, `window.pbjs`), the test mocks that SDK's surface *before* the page loads, then drives the plugin through its real code paths with synthetic events — not through the plugin's internals directly. Features with no external SDK (sticky, in-view-autoplay, gesture, SCTE-35's `TextTrack` cues, the theme system) are tested with zero mocking, using the real browser API (`IntersectionObserver`, real scroll, real pointer events, real `cuechange`).

This caught several real bugs that static review wouldn't have: a Shadow DOM event-retargeting bug in the settings menu's outside-click handler, a Tailwind v4 `translate` CSS property composition quirk, a `pointer-events` gap that silently ate all gesture input, and the `options`/attribute merge bug described in `docs/THEMING.md`. All were found because a test clicked at real pixel coordinates or set a real attribute, not because the code "looked wrong."

## What's intentionally not a 1:1 port

The old (`src/js/`) player is built on video.js + videojs-contrib-ads + videojs-ima + a handful of third-party plugins. Most of hopecoreplayer's plugins are faithful ports of that player's own logic (ads retry/VMAP-split, Prebid, TCF/USP consent, markers, segments, SCTE-35 signal parsing, the live wall clock). Two exceptions are documented inline where they occur: **DAI** (the old player only bootstrapped `videojs-ima`'s DAI plugin — all real `StreamManager` logic lived in that third-party dependency, so hopecoreplayer's DAI plugin is a new implementation against Google's public API, not a port), and the **countdown-screen/geo-checker gate pattern** (the old player could defer *creating* the player entirely; `<hope-player>` always exists once the tag is in the DOM, so the equivalent is blocking playback via `blockChrome()` instead).
