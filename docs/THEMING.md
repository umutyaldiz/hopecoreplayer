# Theming

Written for: developers integrating `@hopeplayer/core` into their own site/app and wanting to brand or restyle the player.

HopeCorePlayer has three independent override layers, from least to most invasive. You can mix all three on the same player.

1. **CSS custom properties** — change colors, blur amount, radii. No build step, works from your own page's CSS.
2. **CSS Shadow Parts (`::part()`)** — restyle a specific element's layout/spacing/typography from outside the Shadow DOM.
3. **Named presets (`theme` option/attribute)** — a bundle of custom-property values, shipped with the player. Presets change the *style* (light/dark glass, neomorphism, flat), never just the color. A preset is just a starting point; anything it sets can still be overridden with layer 1.

The default accent is **white**. There are no color-only presets — your brand color is one token:

```html
<hope-player id="player" theme="neo-dark"></hope-player>
<style>
  /* Layer 1: your brand color on top of any preset */
  #player { --hp-color-accent: #ff0044; }
</style>
```
```js
player.options = { theme: 'neo-dark', src: '...' };
```

`theme` can be set either as an HTML attribute or inside `.options` — the two are merged (explicit `.options.theme` wins if both are set; omitting `theme` from `.options` does **not** clear an attribute-set theme).

---

## Design language: the "chip"

Every interactive surface — icon buttons (play/pause, volume, settings gear, PIP, fullscreen, the loop toggle), the center play button, the settings dropdown panel, and the volume slider popup — shares one CSS class, `.hp-chip`, and reads the same nine custom properties. This is deliberate: **adding a new preset is a handful of variable declarations, never a new set of component rules.**

```css
/* theme/tailwind.css — the rule itself, defined once */
.hp-chip {
    background: var(--hp-chip-bg);
    border: 1px solid var(--hp-chip-border);
    border-radius: var(--hp-chip-radius);
    backdrop-filter: blur(var(--hp-chip-blur)) saturate(160%);
    box-shadow: var(--hp-chip-shadow);
    transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 120ms ease;
}
```

| Token | Meaning | Default (glass-light) |
|---|---|---|
| `--hp-chip-bg` | Chip background (idle) | `rgba(255,255,255,0.08)` |
| `--hp-chip-bg-hover` | Background on hover | `rgba(255,255,255,0.18)` |
| `--hp-chip-bg-active` | Background while pressed (buttons only) | `rgba(255,255,255,0.26)` |
| `--hp-chip-border` | Border (idle) | `rgba(255,255,255,0.16)` |
| `--hp-chip-border-hover` | Border on hover | `rgba(255,255,255,0.30)` |
| `--hp-chip-blur` | `backdrop-filter: blur(...)` amount — `0px` disables the glass look entirely (used by `neo-dark`/`mono`) | `14px` |
| `--hp-chip-shadow` | Full `box-shadow` value — swap for a neomorphic dual-shadow, or `none` | soft drop shadow |
| `--hp-chip-radius` | Corner radius | `10px` |
| `--hp-chip-text` | Icon/text color inside chips | `var(--hp-color-on-surface)` |
| `--hp-chrome-scrim` | Gradient behind the controls (bottom, and top in compact layout) for legibility on bright video; `none` to remove | dark-to-transparent gradient (`none` on `neo-dark`) |
| `--hp-chrome-scrim-height` | Height of that gradient | `min(150px, 45%)` |
| `--hp-chip-backdrop-brightness` | Darkens the video behind the control groups / center play button (`backdrop-filter: brightness()`); `1` = off | `0.78` (`1` on `glass-dark` / `neo-dark`) |
| `--hp-ctrl-shadow` | `filter` on control icons and the time label; `none` to remove | `drop-shadow(0 1px 1.5px rgba(0,0,0,.55))` (`none` on `neo-dark`) |
| `--hp-panel-bg` | Background for **text-bearing panels** (the settings menu dropdown) — more opaque than `--hp-chip-bg`, but still glass; see `--hp-panel-blur` below for how it stays readable without going solid | `rgba(255,255,255,0.72)` |
| `--hp-panel-blur` | `backdrop-filter: blur(...)` for panels — stronger than `--hp-chip-blur`, carrying most of the readability: video behind the panel gets blurred into mush rather than the panel having to go opaque | `26px` |
| `--hp-panel-border` | Panel border | `rgba(15,17,23,0.10)` |
| `--hp-panel-text` / `--hp-panel-text-muted` | Row text / secondary value text inside the panel. Inside `.hp-chip-panel` these are routed into `--hp-color-on-surface(-muted)`, so every row (including plugin submenus) follows them with no extra code | `#15171c` / `#5b6270` |
| `--hp-panel-text-shadow` | Extra contrast boost for panel text (inherited — set once on the panel, every row picks it up) | `none` |

**Panel and tooltip follow the theme's light/dark side.** The defaults above are the light side (`glass-light`). `glass-dark`, `neo-dark` and `mono` share one dark override block: panel `rgba(10,10,14,0.55)` (each preset may set its own `--hp-panel-bg` on top), white/`#a3a3a3` text, `0 1px 3px rgba(0,0,0,0.65)` text-shadow, and the dark tooltip values below.

The control bar itself (`[part="control-bar"]`) has no background of its own. The left (play/volume/time) and right (settings/PIP/fullscreen) button clusters each sit on their own pill surface (`.hp-group`), which reads the same `--hp-chip-*` tokens — so a preset like `glass-dark` darkens the groups and the buttons together. Use `::part(control-bar)` if you want a bar background.

### The hover tooltip

Every `button`/slider with an `aria-label` gets a YouTube-style popup on hover/focus (`controls/Tooltip.ts`) — on hover-capable devices only; on touch devices tapping a button doesn't open it — a label plus, for the handful of buttons with a real keyboard shortcut (play/pause, mute, fullscreen), a small "key" pill. It follows the same light/dark side as the settings panel — frosted white with dark text in `glass-light`, dark with white text in the dark presets — and is more opaque than the panel, since a short label has no blur area to lean on. It uses `--hp-radius` for corner-radius consistency, and is fully overridable:

| Token | Meaning | `glass-light` (default) | Dark presets |
|---|---|---|---|
| `--hp-tooltip-bg` | Popup background | `rgba(255, 255, 255, 0.9)` | `rgba(10, 10, 10, 0.92)` |
| `--hp-tooltip-text` | Label text color | `#15171c` | `#ffffff` |
| `--hp-tooltip-key-bg` | Shortcut pill background | `rgba(15, 17, 23, 0.10)` | `rgba(255, 255, 255, 0.18)` |
| `--hp-tooltip-key-text` | Shortcut pill text color | `#15171c` | `#ffffff` |

Subtitles (`--hp-caption-*`) are the one surface that intentionally stays dark in every preset: caption readability over video shouldn't depend on the theme.

### Why not Tailwind's `backdrop-blur-*` utility classes per theme?

Because the *value* needs to vary per preset and per element state, and Tailwind utilities are static class names — you'd need a different class per blur amount per theme, which doesn't compose. A CSS custom property does. (Also: Tailwind v4's `translate-x-*`/`scale-*` utilities have a known Shadow DOM quirk in this codebase — see the inline comment in `theme/tailwind.css` — so hand-written CSS is already how geometry-sensitive rules are done here; the chip system follows the same pattern for consistency, not because of that bug.)

---

## Built-in presets

Set via `theme="<name>"`. All of them are pure token bundles — open `packages/core/src/theme/tailwind.css` and search `data-theme=` to see exactly what each one changes.

| Preset | Style | Accent | Notes |
|---|---|---|---|
| *(none / `glass-light`)* | Glassmorphism, white-tinted surfaces | white `#ffffff` | Default — this is what you get with no `theme` at all. |
| `glass-dark` | Glassmorphism, **dark-tinted** surfaces | white | Same glass language, but buttons, button groups, and the settings panel get a dark translucent background instead of a white one. Icons/text stay white. |
| `neo-dark` | Neomorphism (soft-UI) | white | `--hp-chip-blur: 0`, dual soft shadows for an embossed look instead of translucency; buttons get an `inset` shadow on press. |
| `mono` | Flat, minimal | white | No blur, no shadow, near-invisible chrome — for publishers who want the player to disappear into their own design. |

Pick whichever style is closest to what you want, then set `--hp-color-accent` for your brand — you don't need to write a full preset to reskin the player. If your accent is dark, also set `--hp-color-on-accent` (see below) so text on accent-filled buttons stays readable.

### Writing your own preset

A preset is nothing but a `:host([data-theme='your-name'])` rule in your own page CSS (it does **not** need to live inside the Shadow DOM — custom properties are inherited across the boundary):

```css
hope-player[data-theme='acme'] {
    --hp-color-accent: #6d28d9;
    --hp-chip-bg: rgba(109, 40, 217, 0.12);
    --hp-chip-border: rgba(109, 40, 217, 0.35);
    --hp-chip-blur: 18px;
}
```
```html
<hope-player theme="acme" ...></hope-player>
```

---

## Color/surface tokens (beyond the chip system)

```css
hope-player {
  --hp-color-accent: #ffffff;          /* seekbar fill, active states, focus ring */
  --hp-color-on-accent: #0a0a0a;       /* text on accent-filled buttons (Continue / Retry / Play now) */
  --hp-color-surface: #0a0a0a;         /* host background, video-area background */
  --hp-color-surface-elev: #1a1a1a;    /* currently unused by the chip system, reserved for raised panels */
  --hp-color-on-surface: #ffffff;      /* default text/icon color */
  --hp-color-on-surface-muted: #a3a3a3;
  --hp-radius: 8px;                    /* host + video-area corner radius */
}
```

---

## CSS Shadow Parts

Use `::part()` from your page's stylesheet for layout-level changes the token system doesn't cover (padding, size, position):

```css
hope-player::part(control-bar) { padding-bottom: 12px; }
hope-player::part(center-play-button) { /* ... */ }
```

| Part | Element |
|---|---|
| `video` | The `<video>` element itself |
| `ad-layer` | IMA ad UI container (regular client-side ads) |
| `control-bar` | The bottom control bar (gets `data-compact` when the player is narrower than 480px) |
| `top-bar` | Compact layout only: top-right bar the right button group (settings, plugin buttons, PIP) moves into; fullscreen stays bottom-right |
| `unmute-badge` | Touch devices only: "Unmute" pill shown while a playing video is muted (the volume button is hidden on touch) |
| `seek-bar` | The scrubber |
| `error-screen` | Error overlay shown when the media fails (with a "Retry" button) |
| `mini-progress` | Thin 1px edge-to-edge progress line at the bottom while the controls are hidden (`miniProgress: true`) |
| `seek-time` | Time shown above the seek bar while hovering (default, no plugin needed; hidden when sprite-thumbnails/segments show their own time, and on live streams). Follows the `--hp-tooltip-*` tokens |
| `play-pause-button` | Play/pause icon button |
| `skip-back-button` / `skip-forward-button` | Skip back / forward buttons (`options.skipButtons`); the duration is drawn in `.hp-skip-num` |
| `context-menu` | Right-click menu (`options.contextMenu`); follows the `--hp-panel-*` tokens |
| `stats-panel` | Technical stats panel opened from the context menu / `toggleStats()`; follows the `--hp-panel-*` tokens |
| `seek-feedback` | Notice shown on the right/left while skipping ("+30 s"); follows the `--hp-chip-*` tokens |
| `volume-button` / `volume-slider` | Mute toggle / the vertical slider popup |
| `center-play-button` | The big center play button (outer full-area click target — the visual circle is an inner `<span class="hp-chip">`, not a separate part) |
| `playlist-panel` | Playlist plugin's list panel |
| `story-counter` | Story plugin's "`2 / 5`" counter |
| `marker-popup` | Markers plugin's popup overlay |
| `segment-band` | One chapter part of the split seek bar (repeats per chapter) |
| `segment-tooltip` | Segments plugin's chapter popup (chapter name + time) shown on seek bar hover |
| `sprite-tooltip` | Sprite-thumbnails hover preview |
| `countdown-screen` | Countdown-screen gate overlay |
| `geo-loading` / `geo-warning` | Geo-checker loading spinner / denial message |
| `redirect-screen` / `redirect-suggestions` | Redirect-screen counter overlay / suggestions grid |
| `gesture-overlay` | Gesture plugin's hold-to-seek speed indicator |
| `live-badge` | "● LIVE" badge shown instead of the time label on live streams (red dot at the live edge, muted when behind; click returns to live). Dot color: `--hp-live-color` (default `#ff0000`) |
| `live-clock` / `live-tooltip` | Live wall-clock control-bar clock / seekbar hover tooltip |
| `sticky-close-button` | Sticky plugin's dock close button |
| `tooltip` | The hover tooltip popup (`controls/Tooltip.ts`) — shown for any `button`/slider with an `aria-label` |
| `caption-layer` / `caption-bubble` | Subtitle overlay layer / the draggable caption bubble (`subtitles/CaptionRenderer.ts`) |
| `qr-resume-screen` | QR-resume plugin's "continue on your phone" overlay |
| `pause-ad` | Pause-ad plugin's right-hand display ad panel (header, ad slot, "Resume video" button) |

---

## Plugin menu slot API

Plugins that need a settings-menu entry (so far: `dubbing`, for audio/dub track selection) don't hardcode themselves into `SettingsMenu` — they call a generic registration method, so the menu adds zero weight when that plugin isn't used. A plugin never holds the `SettingsMenu` itself: `HopePlayerElement` passes `registerSubmenu`/`unregisterSubmenu` in through the plugin's context object:

```ts
ctx.registerSubmenu({
    key: 'my-plugin',
    title: 'My Feature',
    getValueLabel: () => currentSelectionLabel,
    getItems: () => options.map((o) => ({ label: o.label, active: o.selected, onSelect: () => select(o) })),
});
```

If you're building your own plugin that wants a menu entry, this is the supported way to add one — see `packages/core/src/plugins/dubbing/Dubbing.ts` for a complete example.

---

## Full programmatic override

Nothing stops you from reaching into the DOM and restyling further — the Shadow Root is `mode: 'open'`:

```js
player.shadowRoot.querySelector('[part="control-bar"]').style.background = 'black';
```

This bypasses the token system entirely and isn't guaranteed stable across versions the way `--hp-*` properties and `::part()` names are — prefer those two first.
