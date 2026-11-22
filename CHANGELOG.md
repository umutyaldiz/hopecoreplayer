# Changelog

All notable changes to the `@hopeplayer/*` packages (`core`, `react`, `vue`, `react-native` — always released together with the same version) are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning policy

From 1.1.0 on, the project follows [Semantic Versioning](https://semver.org/) strictly:

- **Patch** (`1.1.x`) — bug fixes only. Safe to update at any time.
- **Minor** (`1.x.0`) — new features and new options, fully backward compatible. Defaults never change in a way that alters existing pages; new features ship off by default unless stated.
- **Major** (`x.0.0`) — breaking changes (removed / renamed options, changed defaults, dropped browsers). Each one is listed under **Breaking** with a migration note, and deprecated options keep working with a console warning for at least one minor release before removal.

During the initial 1.0.x line, new features were released as patch versions; that ends with 1.1.0.

## [Unreleased]

## [1.12.0] — 2026-11-22

### Added

- **`fullscreenMode: 'browser'` — fullscreen inside the browser on iPhone.** iPhone Safari has no Fullscreen API, so the fullscreen button opened iOS's built-in video player: our controls, caption style and plugins disappeared, and a linear ad had to exit fullscreen to be visible. With `'browser'` the player fills the browser window instead (safe-area aware, page scroll locked, Escape or the button exits), so controls, plugins and ads stay in the player and an ad no longer exits fullscreen. Default `'auto'` keeps the current behavior; no effect where the Fullscreen API exists (desktop, Android, iPad, Mac). The code loads as a separate chunk only when used.
- **`ambient` — ambient light (off by default).** The video's colors spill behind the player as a soft light that fades towards the edge and stays behind the page content. Built for minimal battery and CPU cost: a 16px-wide frame every 2 s (≈0.6 ms per update), blur by upscaling instead of a GPU filter, linear opacity-only fades that last until the next update, with the edge mask applied to both layers together so nothing flickers; `updateMs` down to 100 ms follows scene cuts right away, blending frames under 400 ms; updates stop when paused, while the tab is hidden, while the player is off screen, in fullscreen and on low battery (under 20%, not charging), and no frames are taken during ads or from DRM video. The light only brightens the page (screen blend) and fades out along a smooth curve, so there is no visible edge. Options `opacity`, `spread`, `updateMs`, `blur`, `saturation`, `brightness`; viewers can turn it off and on from an "Ambient light" row in the settings menu and the choice is remembered (`menu: false` hides the row); `::part(ambient)`. Separate chunk.

### Changed

- **Mobile: the seek bar sits at the very bottom, edge to edge.** In the compact layout (player under 480px) the seek bar moved below the buttons; the line touches the bottom edge and its touch area extends upward, so tapping right at the edge seeks. The centered play button keeps clear of the button row.

## [1.11.1] — 2026-11-22

### Fixed

- **History: a QR resume link (`?vtime=`) no longer gets a brief jump to the saved position first.** When the history chunk was installed after the video's metadata was ready, the same load was handled twice (once at install, once on `loadedmetadata`): the first call used up the link's priority, the second sought to the saved position and showed the resume notice before the link time was applied. Each load is now handled once, and metadata from a source that is being replaced is ignored.

## [1.11.0] — 2026-11-21

### Added

- **Ad status notices (`ads.notices`, off by default).** While the viewer waits for an ad, a small notice says "Loading ad…"; when no ad comes (empty VAST, error, timeout) it says "No ad, starting the video". When the ad is filled, a ring countdown ("Ad starts in 3") runs before it starts, then the video area closes with a transition (`fade`, `blur`, `wipe` or `none`) and opens as the ad starts. Pausing during the countdown holds the ad. Options: `countdown` (seconds, default 3, `0` = off), `transition`, `position`, `loading`, `empty`. The countdown applies to breaks the player starts; VMAP breaks scheduled by IMA and SCTE-35 breaks do not wait. Texts are in the ads chunk (Turkish / English, overridable via `labels`).

## [1.10.0] — 2026-11-21

### Changed

- **Mobile: a crowded top-right control group collapses** (YouTube mobile style). In the compact layout (player narrower than 480 px), when more than one button besides settings sits in the top-right group (share, clips, reactions, transcript, cast…), the group shows only settings and a "‹" button; tapping it reveals every button and turns into "›" to collapse again (`aria-expanded`, labels `moreControls` / `close`). Buttons that plugins show or hide later are counted automatically. Desktop is unchanged.

### Fixed

- **The preroll request no longer waits for extra chunks.** The ads chunk pulled two small shared chunks before calling IMA (VAST helpers shared with cast, the style helper of the ad-overlay rule), adding a network round trip before the preroll. The ads chunk now depends only on the player chunk; cast and DAI load these helpers lazily.

### Internal

- Cast ad-tag building moved from the main bundle into the cast chunk (about 0.9 KB gzip less on initial load).

## [1.9.1] — 2026-11-20

### Fixed

- **Nothing sits on top of a video ad except the control bar.** With a saved position and a preroll, the "Resumed from 10:00 · Start over" notice stayed on top of the ad. During a linear ad (IMA or DAI) the player now carries a `data-ad` attribute and hides every layer in the video area except the control bar and the ad itself — the resume notice, plugin overlays and any future plugin layer. The resume notice is held during the ad and shown again when it ends. `hope-player[data-ad]` can also be used in your page CSS.

## [1.9.0] — 2026-11-18

### Added

- **Age verification (`ageGate`):** an animated date-of-birth screen (drawn ring badge, day / month / year fields that advance on their own and accept a pasted date, shake on an invalid date, a check-mark exit or a locked "Access restricted" screen; prefers-reduced-motion respected, fits small players on one row). Until the viewer passes `minAge` (default 18) the video source is not loaded, no ad is requested and autoplay is not attempted. `checkAge()` skips the screen for viewers your site already verified; `onSubmit({ dateOfBirth, age, ageGroup, passed })` hands the date to your own system and can reject with `false`. The `hp:agegate` event (`shown` / `passed` / `denied`, `source`) carries only the age and an age group such as `25-34` — never the date of birth — for analytics / dataLayer. The result (age only) is remembered for the tab, a number of days or not at all (`remember`), and follows the privacy consent: without functional consent nothing is written to the browser. `retry` lets a rejected viewer correct the date. Separate chunk.

## [1.8.1] — 2026-11-16

### Fixed

- **Types under `moduleResolution: "node16"` / `"nodenext"`** ([#16](https://github.com/umutyaldiz/hopecoreplayer/issues/16)): the published `.d.ts` files of all four packages used extensionless relative imports, so in projects using Node's ESM resolution (the `tsc --init` default since TypeScript 5.9) every type silently became `any` — unknown options were not caught, `definePlugin` callbacks failed strict checks, and with `skipLibCheck: false` `TS2834` errors appeared inside the package. The declarations now use explicit `.js` / `/index.js` specifiers. Bundler-resolution projects (Vite, Next.js, Nuxt, …) were not affected. CI and the release workflow now type-check a consumer project against the built packages under `node16`, `nodenext` and `bundler` with `skipLibCheck: false`.

## [1.8.0] — 2026-11-15

### Added

- **Paywall (`paywall`):** the first `previewSeconds` play for free (a "Preview · 0:42" badge counts down), then the video stops and a "Subscribe / Sign in" screen appears; seeking past the limit is pulled back (on live streams the watched time counts). Hooks into your membership system: `checkAccess()` is asked when the preview ends (`true` → no wall), `subscribe.onClick` / `login.onClick` open your own dialog and unlock when they return `true`, or `url` sends the viewer to your checkout. `player.unlockPaywall()`, `unlocked: true`, `hp:paywall` (`shown` / `click` — cancelable / `unlock`). Separate chunk.
- **Personal watermark (`watermark`):** a viewer-specific text (email, user ID) over the video that moves every `moveEvery` seconds, also in fullscreen and Document PiP, hidden during ads; put back if removed or hidden through the developer tools. Separate chunk.
- **Clips (`clips`):** a scissors button opens a range picker on the seek bar (draggable handles, ±1 s buttons, preview); the `?clip=80-105` link plays only that part on a loop, with a "Watch full video" badge. Copy, chosen networks and the system share sheet; `player.openClip()`, `hp:clip` (`copy` / `share` cancelable). Separate chunk.
- **Watch party (`watchParty`):** play / pause / seek / speed are sent through your `send` (or `hp:watchparty`) and applied with `player.receiveWatchParty()` — latency compensated, drift corrected (`tolerance`, `heartbeat` sync), no echo, "Ali paused" notices, messages during ads applied afterwards. `player.sendWatchPartySync()`. Separate chunk.
- **Reactions & timed comments (`reactions`):** an emoji tray whose reactions float up the screen (`hp:reaction`, `local: true` to forward), `player.addReaction()` / `player.addComment()` for incoming ones; comments pinned to a second scroll across the top (VOD), an optional comment box (cancelable for moderation), a settings-menu switch (remembered), reduced-motion support. Text is never HTML. Separate chunk.
- **Course mode (`course`):** watched ranges are recorded (seeked-over parts do not count), skipping ahead to unwatched parts is blocked (`preventSkip`), `hp:course` at `milestones` and on `completeAt`, watched parts drawn on the seek bar, `maxRate`, a notes panel with timestamped notes marked on the seek bar. Stored per `id`, merged with `initial`; `player.getCourseProgress()`, `player.toggleCourseNotes()`. Separate chunk.
- **Podcast tools (`podcast`):** sleep timer in the settings menu (minutes or end of episode, the volume fades out), skip silences (Web Audio level detection, plays silent parts at `rate`, time saved shown in the menu; needs CORS for cross-origin audio; unavailable on WebKit — Safari / iOS — where the analysis stops once the speed changes; a fast stretch is capped at 15 s and only starts after real sound has been heard), waveform above the seek bar from `data`, a JSON `src` or the file itself. `player.setSleepTimer()`, `hp:podcast`. Separate chunk.
- **Sign language video (`signLanguage`):** a second, muted video in a corner kept in sync with the main one (play / pause / seek / speed, drift correction); toggled from the control bar or settings menu (remembered), draggable to another corner, hidden during ads, downloaded only when first turned on. `player.toggleSignLanguage()`, `hp:signlanguage`. Separate chunk.
- **Privacy & cookie consent (`privacy`):** consent in four categories — `ads`, `personalizedAds`, `analytics`, `functional` — from built-in connectors for **OneTrust** (`OnetrustActiveGroups`, C0002 / C0003 / C0004 by default, `groups` to remap), **Cookiebot** and **IAB TCF v2** (Didomi, Quantcast, Usercentrics…), your own `getConsent()`, or `player.setPrivacy()`; changes are followed live and fire `hp:privacy`. Without personalization consent, Google Ad Manager tags get `npa=1` (and `ltd=1` without storage consent too) on every break, DAI gets the same `adTagParameters`, GPT (pause ads, ad triggers) gets `setPrivacySettings`, and Prebid is skipped. Without analytics consent, QoE / GA4, tracking pixels (sponsorship, ad triggers, markers) and the CMCD session ID are not sent. Without functional consent nothing is written to the browser (preferences stay in memory), the default geolocation service and the Cast SDK are not loaded, and withdrawing it deletes the player's `hp-*` / `hope-*` keys. `ads: false` never loads IMA. Ad requests wait up to `waitMs` for the CMP's first answer; until then `default: 'deny'`. Page-wide; plugins get `player.privacy` / `onPrivacyChange()` and `player.storage` already complies. Separate chunk.
- **React Native:** the new events reach `onEvent`, and `ref.call(method, ...args)` calls player methods such as `unlockPaywall`, `receiveWatchParty`, `addReaction` or `setSleepTimer` (an allow-list; other names are ignored).

### Changed

- Accessibility (volume boost / mono) and silence detection share one Web Audio graph per media element (`createMediaElementSource` can only be attached once).
- Every `localStorage` / `sessionStorage` access in the player goes through one consent-aware helper.
- The control-bar icons of the new features are inline SVG inside their own chunks instead of the shared icon font.
- The setup code of the eight new features is its own chunk, downloaded only when one of them is configured — the initial load stays under the 80 KB budget.

## [1.7.2] — 2026-11-14

### Security

- **Settings menu labels were rendered as HTML.** Caption / audio track names (which can come from an HLS or DASH manifest), quality labels and plugin menu labels were written with `innerHTML`, so a crafted track name could run script in the page. They are now set as plain text.
- **Unsafe link schemes are ignored.** `javascript:`, `data:` and other non-http(s) URLs no longer become links or navigation in interactive cards (`interactive`), rich marker links (`markers`), end-screen suggestions and the redirect itself (`redirectScreen`). Relative and http(s) URLs work as before; the `hp:redirect` / `hp:interactive` events still fire. Ad triggers and sponsorship already filtered these and now share the same check.
- **React Native:** `backgroundColor` is only accepted as a plain color value, so it can no longer close the page's `<style>` block.

## [1.7.1] — 2026-11-13

### Fixed

- **`skipSegments` button rendered without styles** — since the 1.7.0 move to plugin chunks, the "Skip intro" button loaded without its CSS (plain text in the corner). The style is injected again when the plugin starts.

## [1.7.0] — 2026-11-13

### Added
- **Sharing (`share`):** a control-bar button opens a panel with the video link, "Copy", "Start at 0:42" (adds `?t=`) and the networks you choose (`networks`: X, WhatsApp, Facebook, LinkedIn, Telegram, Reddit, email; `[]` → copy only), plus the system share sheet where available. Opening the page with `?t=90`, `?t=1:30` or `?t=1m30s` starts the video there (`readParam`). Canonical URL by default (`url`, `title`, `param`). `player.openShare()`; cancelable `hp:share` (`open` / `copy` / `native` / network). Separate chunk.
- **Audio description (`audioDescription`):** `true` uses the stream's description track (HLS `CHARACTERISTICS="public.accessibility.describes-video"`, Safari `kind: "description"`); `{ src }` plays a separate narration file in sync with the video, mixed over the original audio (play / pause, seek, speed and volume follow the player). "Audio description: On / Off" in the settings menu, saved per viewer; picking a non-description track from the audio menu turns it off. The audio menu marks description tracks. `player.setAudioDescription(on)`, `hp:audiodescription`. Separate chunk.
- **Heatmap peak label (`heatmap.peakLabel`):** hovering the highest point of the curve shows "Most watched moment · 1:23" in the seek bar tooltip (on by default; pass your own text or `false`).
- **Multi-camera (`multiview`):** checked with a real live HLS stream (date-time tags): switching keeps the same real time within ~0.15 s. Several streams of the same event (HLS recommended). Focus view: the selected camera plays large and the others stream as small screens above the control bar (`thumbnails: 'bottom' | 'right'`); clicking one switches to it. Split view (`layout: 'grid'`): 2–4 cameras in equal cells, audio from the selected one, clicking a cell swaps it in. Switching continues from the same moment: cameras are aligned by `EXT-X-PROGRAM-DATE-TIME` (live and VOD), or by `sources[].offset` when the tags are missing; previews stay aligned while playing and show "Not started yet" before a camera joins. Previews play at the lowest quality with a short buffer; `previews: 'auto'` streams on desktop and shows posters on mobile (`posterRefresh`), and split view on mobile is limited by `maxMobileStreams` (2). Controls, captions and ads follow the selected camera; previews pause during ads. `player.switchCamera(id)`, `player.setMultiviewLayout(layout)`, `hp:multiview` (`switch` / `layout`). Separate chunk.

### Changed
- Plugin styles (rewarded unlock, sponsorship, ad triggers, cast, history toast, skip segments, pause ad) and plugin UI texts (sharing, multiview, transcript, interactive content, end screen, Document PiP, heatmap, audio description) ship with their own chunks. Initial load dropped to ~78 KB gzip with all the new features. `labels` overrides and switching `locale` work as before.

## [1.6.0] — 2026-11-12

### Added
- **End screen (`redirectScreen.mode: 'endScreen'`):** no redirect or countdown — when the video ends, the `suggestions` grid opens right away (`url` / `time` are not needed). The grid (also shown after cancelling in the other modes) now has a heading (`suggestionsTitle`), per-card `subtitle`, "Watch again" (`replay`, on by default) and a close button, and lays out by card count. Clicking a card fires a cancelable `hp:redirect` (`reason: 'suggestion'`, `index`) so SPAs can route it themselves; "Watch again" fires `state: 'replay'`.
- **Transcript panel (`transcript`):** a control-bar button opens a side panel listing every caption line with its time; clicking a line seeks there, the playing line is highlighted and kept in view, search ignores case and accents and marks matches, and a language picker appears with several tracks. VTT files from `subtitles` are read even while captions are off; in-stream HLS / DASH captions fill in while selected. Options: `open`, `track`, `search`, `autoScroll`, `button`, `position`; `player.toggleTranscript(force?)`; `hp:transcript` (`open` / `close` / `seek`). Separate chunk.
- **Document Picture-in-Picture (`documentPip`):** on Chrome / Edge 116+ the PiP button opens a Document PiP window and moves the player's video area into it — controls, captions, settings menu, ad layer and plugins — without interrupting playback. The page keeps a "Bring it back" placeholder; keyboard shortcuts work in the window; `inViewAutoplay` and `sticky` stay out of the way while it is open. Other browsers keep regular PiP and never download the code. `player.togglePip()`; new `hp:pip` event (`enter` / `exit`, `mode: 'document' | 'native'`) for both kinds of PiP. Separate chunk.
- **Interactive content (`interactive`):** polls (percentage bars from `results` or the value returned by `onAnswer`), quizzes (correct / wrong marking, `explanation`), product cards (price, old price, "Sponsored") and link cards at set times. Video-time based `duration`, optional `pause`, seek-aware (skipped items are not shown, seeking back brings them again), answered polls / quizzes are not asked twice (`rememberAnswers`), seek bar dots, hidden during ads. `hp:interactive` (`shown` / `answer` / `click` — cancelable / `dismiss`). Separate chunk.
- **Heatmap (`heatmap`):** a "most watched" density curve above the seek bar from your own values (`number[]`, or `{ data | src, show: 'hover' | 'always', height }`); the played part fills with the accent color. Hidden on live streams. Separate chunk.
- **Seek bar marker labels and colors:** hovering a marker dot shows "label · time" in the seek bar tooltip (the time snaps to the marker) — the `markers` item `label`, an interactive item's question or card title; also inside chapter and sprite previews. Colors: `markers.color` for all dots (an item's `color` wins), `interactive.markerColor` and `items[].markerColor`; CSS `--hp-seek-marker-color`, `--hp-ia-marker-color`, `--hp-seek-marker-size`, `::part(seek-marker)`.

### Changed
- `redirectScreen.url` and `redirectScreen.time` are optional in the types (`time` defaults to 10); `url` is still needed for `screen` / `card`. `RedirectScreenSuggestion.image` is optional.
- Seek bar markers (markers, loop A-B, interactive items) are centered dots with a dark ring instead of full-height lines; they grow on hover and dim once passed. Loop bounds are accent pills.
- Plugin styles (redirect screen, transcript, heatmap, interactive content, Document PiP) ship with their own chunks instead of the main bundle — the initial load stays at ~79 KB gzip with all the new features.

### Fixed
- **Ad triggers:** time / percent marks were skipped when two `timeupdate` events were more than 1.5 s apart (slow devices, background tabs, Linux WebKit) because the gap was treated as a seek. Seeks are now detected with the `seeking` event and the natural-progress limit follows the real time elapsed.

## [1.5.0] — 2026-11-11

### Added
- **DASH (`.mpd`):** played with dash.js, a separate chunk downloaded only for DASH sources. Quality and audio menus, ABR, live DASH, quality lock, stats and QoE work as with HLS. New `dash` option: `settings` (passed to dash.js `updateSettings()`) and `withCredentials`. `sourcePriority` accepts `'dash'`. Without MediaSource the player shows "not supported" (code 4) and falls back to the next source group.
- **DRM (`drm`):** Widevine, PlayReady, FairPlay and ClearKey with license URL, headers and credentials; the first system the browser supports is used. Works through dash.js (DASH), hls.js (HLS — the full build is used when DRM is set) and the browser's EME API on Safari's own HLS player (FairPlay: certificate, session, license; `prepareLicenseRequest` / `parseLicenseResponse` adapt vendor formats). License failures show a dedicated error (code 5, `hp:error`). The key system in use is in `player.playbackEngine.drm` and the stats panel.
- **QoE analytics (`analytics`):** startup time, watch time, rebuffer count / time / ratio, seeks, quality switches, weighted average bitrate, max progress, errors, ad time and dropped frames. Events (`session_start`, `start`, `pause`, `resume`, `seek`, `rebuffer`, `quality`, `progress` 25/50/75, `ended`, `error`, `ad_start`, `ad_end`, `volume`, `fullscreen`, `pip`, `heartbeat`, `session_end`) fire as `hp:analytics` and `onEvent`; with an `endpoint` they are batched as JSON (`intervalMs`, `sendBeacon` when the page is left, `custom`, `beforeSend`). `ga4: true` sends GA4 video events through `gtag`, or with `dataLayer.push` when only Google Tag Manager is on the page (`ga4: 'gtag' | 'dataLayer'` forces a path). `player.qoe` returns the current metrics. React `onAnalytics`, Vue `@analytics`, React Native `onAnalytics`.
- **DASH subtitles:** WebVTT / TTML tracks in the manifest appear in the Captions menu by language and are drawn by the player's own caption layer (downloaded only when selected).
- **Quality limit (`qualityLimit`):** `max` (qualities above a height are never used or listed — HLS, DASH and MP4 `sources`), `dataSaver` (auto quality stops at 480p, or a given height, when the browser reports Save-Data or a 2G / 3G connection; the menu still offers higher ones) and `fitPlayer` (no quality larger than the player's on-screen size × pixel density — HLS / DASH).
- **CMCD (`cmcd`):** hls.js and dash.js add CTA-5004 Common Media Client Data to segment requests (`query` or `header` mode); `cid` defaults to `options.id` and `sid` is the analytics session id, so CDN logs and QoE batches join on one session.
- **Frame-by-frame stepping:** `,` / `.` step one frame back / forward (pausing first). The frame duration is measured from the video with `requestVideoFrameCallback`, or set with `frameRate`; listed in the `?` shortcut panel.
- **React Native, plugins:** the `plugins` prop takes plugin modules as a URL or as code (`'https://…/plugin.js'`, `{ url, options }`, `{ code, options }`), loaded inside the WebView. `player.emit()` reaches the app through `onPluginEvent(event, detail)`; `ref.postToPlugin(name, data)` sends data to the plugin (`<plugin>:native`).
- **Plugin API, ads (`player.ads`):** plugins can play their own ad formats. `requestBreak(run)` pauses the content, hides the controls, blocks seeking and media keys, sets `isAdPlaying`, fires `hp:adstart` / `hp:adend` (with `plugin`) and gives the plugin a clickable layer; the content resumes afterwards. Hooks: `beforeContent` (preroll gate), `atTime` (midroll marks, seek-aware), `onPause` (pause ads), `onEnded` (postroll — playlist and redirect screen wait for it) and `transformTag` (rewrite IMA ad tags before the request). See [docs/PLUGIN_API.md](docs/PLUGIN_API.md#ads).
- **Sprite thumbnails, two-tier preview (`spriteThumbnails.lowRes`):** a tiny sheet covering the whole video (e.g. 48×27 frames, a few KB) loads on first interaction. While the full sheet under the cursor is loading, the frame for the right time is shown from the tiny sheet (scaled up), then sharpens — instead of an empty preview or the previous position's frame. It loads regardless of connection speed and is never evicted. `lowRes.interval` defaults to duration / frame count.
- **Sprite thumbnails, `displayWidth`:** the on-screen preview width, independent of the frame size — 320×180 frames at `displayWidth: 160` are sharp on Retina screens. Works with templates, `sheets` and VTT.

### Changed
- `dashjs` is a new dependency of `@hopeplayer/core` (lazy chunk; the first load grows by about 1 KB gzip for the new options).
- Playlist: when an ad is still playing as the video ends, the next item now waits for `hp:adend`.

### Fixed
- Plugin API: `ui.addLayer({ css })` styles were lost when the plugin set the layer's `innerHTML`.
- Accessibility: the seek bar had no `aria-valuenow` / `aria-valuemax` until the video's duration was known (an invalid slider while loading or after a load error).

## [1.4.0] — 2026-11-11

### Added
- **Public plugin API.** `definePlugin({ name, setup(player, options) })`, registered with `options.plugins`, `player.use()` or page-wide `registerPlugin()` (React / Vue: `plugins` prop); plugins can be loaded lazily (`() => import('./x')`). The `player` object offers state and playback, events (`on` / `emit`), control-bar buttons, layers over the video, settings-menu toggles / selects / submenus, keyboard shortcuts (listed in the `?` panel), i18n, namespaced storage, timers and logging. Everything a plugin adds is removed automatically with it; errors inside a plugin are logged and never break playback. Versioned as `PLUGIN_API_VERSION` 1. The runner is a separate chunk loaded only when a plugin is used. Guide: `docs/PLUGIN_API.md`.

### Changed
- "Skip intro" buttons (`skipSegments`) now run on the public plugin API.

## [1.3.1] — 2026-11-10

### Added
- **`pipButton: false` / `fullscreenButton: false`** hide the Picture-in-Picture / fullscreen button in the control bar (both shown by default; also in the narrow layout). Only the button goes away — the `F` shortcut and `tapGestures` fullscreen keep working.

### Fixed
- **`playbackRates` was ignored.** The option was typed and documented, but the settings menu was always built with the default speeds, so neither a custom list nor `[]` had any effect. The menu now uses your list (sorted, duplicates dropped), and `playbackRates: []` removes the "Playback speed" row.

## [1.3.0] — 2026-11-09

### Added
- **`liveSeekBar: false`** hides the progress (DVR) bar on live streams. The `● LIVE` badge and keyboard seeking stay; VOD is unaffected. Default `true`.

### Fixed
- **Live: the seek bar thumb sat short of the right end while watching live.** The bar ended at the very end of the seekable window, but hls.js deliberately plays a few segments behind it, so even at live the thumb looked behind — while the `● LIVE` badge said live. The bar now ends at the player's live target (hls.js `liveSyncPosition`), and while the viewer counts as live (the same 15 s tolerance as the badge) the thumb sits at the right end.

## [1.2.1] — 2026-11-08

### Fixed
- **Vue: options that were not passed were sent to the player as `false`.** Vue turns an absent `boolean` prop into `false` (boolean casting), and `@hopeplayer/vue` passed every prop through. In Vue apps clicking the video did not play / pause (`tapToPlay: false`), the cursor never hid (`cursorHideDelayMs: false`) and the quality badge never showed (`qualityBadge: false`). Only the props you pass now reach the player. Covered by a new end-to-end test with real Vue (`vue-wrapper`).

## [1.2.0] — 2026-11-07

### Added
- **Playback history (`history`, off by default):** a video left halfway starts where the viewer stopped, with a "Resumed at 0:42 · Start over" notice (Start over goes back to 0 and forgets the position). Volume and mute are remembered on the site; `muted: true` (muted autoplay) always wins. Stored in the viewer's browser (localStorage): positions are saved after `minWatched` seconds (10), a video within `endMargin` seconds (15) of its end counts as watched and is forgotten, at most `maxEntries` (50) videos for `ttlDays` (30). Not saved for live streams or during ads. A QR resume link (`?vtime=`) wins over the saved position. `id` identifies the video when its address changes (signed URLs). New `hp:history` event (`resumed` / `restart`). Loaded only when enabled (~2 KB gzip).
- **Accessibility menu (`accessibility`, off by default):** an "Accessibility" submenu in the settings menu.
  - **Zoom** (100–300%): from the menu, with `+` / `−` / `0`, two-finger pinch on touch screens; move around the zoomed picture by dragging or with Shift + arrow keys (plain arrows still seek / change the volume).
  - **Picture filters:** natural, black and white, daylight (brighter, more contrast for bright rooms), night light (warm, less blue light), high contrast, and red- / green- / blue-blind modes (daltonization — colors the viewer cannot tell apart are shifted to ones they can).
  - **Mono audio** and **volume boost** (up to 300%) through Web Audio. Shown as "Unavailable" for a cross-origin source loaded without CORS, where Web Audio would mute it.
  - **Large controls:** bigger buttons, seek bar, touch targets and captions.
  - **Keyboard shortcuts** list (menu row or `?`): a dialog, closed with Esc.
  - **Quick access:** each feature that is on gets its own button right of the settings button (zoom, filter, mono audio, volume boost, large controls). Pressing it opens that feature's settings directly; turning the feature off removes the button.
  - The viewer's choices (except zoom) are remembered on the site (`remember`). Each part can be turned off (`zoom`, `filters`, `audio`, `largeControls`, `shortcuts`) and the zoom / boost levels and the filter list can be set. New `hp:accessibility` event. Loaded only when enabled (~5 KB gzip).
  - Settings menu: submenus can now nest, and quick-access buttons next to the settings button can open a submenu directly.

## [1.1.0] — 2026-11-06

### Added
- **Skip intro / recap / credits buttons (`skipSegments`):** a button shows in a corner while a part plays and jumps to its end when pressed. Per part: `start`, `end` (omitted = end of the video, so skipping the credits ends it and a playlist moves on), `type` (`intro` / `recap` / `credits` / `custom` — sets the default text), `label`, `position` (four corners), `showFrom` / `showUntil` (when the button appears and leaves), `hideAfter` (fades out, returns with the controls), `autoSkip` (`true` or a countdown in seconds; not when the viewer seeked into the part). New `hp:skip` event (`shown` / `skip`, cancelable). Hidden during ads, keyboard accessible, `::part(skip-segment)`. Loaded only when used (~2 KB gzip).
- **Quality badge on the settings icon:** shows the quality of the picture that is actually playing — `HD` (720p+), `2K` (1440p), `4K` (2160p), `8K`; below HD the height (`480` / `360` / `240`, dimmed). Read from the decoded video, so it also follows ABR on Auto quality, with MP4, hls.js and Safari's own HLS player. On by default; `qualityBadge: false` hides it. Colors: `--hp-quality-badge-bg` / `--hp-quality-badge-color` (default: the accent color), `::part(quality-badge)`.
- **`hls.build: 'light'`:** loads hls.js's light build — ~119 KB instead of ~186 KB gzip. Quality menu, ABR, live / DVR, SCTE-35 and the wall clock work the same. It has no stream subtitles (WebVTT / IMSC1 / CEA-608), alternate audio tracks, DRM (EME), CMCD or interstitials; captions from `options.subtitles` are unaffected. Off by default (`'full'`). Only the chosen build is downloaded. `player.playbackEngine` reports it as `build`.

### Changed
- **Smaller hls.js download:** the hls.js chunk is now minified — it was bundled with its whitespace (Vite does not minify whitespace in library builds). 228.6 → 186.5 KB gzip for the same hls.js 1.7.4 code (the latest stable release).

## [1.0.18] — 2026-11-06

### Fixed
- `hp:ended`, `hp:error` and `hp:ratechange` were declared and documented but never dispatched, so React `onEnded` / `onError` / `onRateChange` and Vue `@ended` / `@error` / `@ratechange` never fired. `hp:error` is sent once when the error screen opens (`{ message, code }`) — not for errors the player recovers from (fallback sources, native HLS → hls.js).
- **Firefox fullscreen:** the fullscreen layout and the larger fullscreen controls / seek bar / captions were never applied in Firefox — the rules used the selector list `:host(:fullscreen), :host(:-webkit-full-screen)`, and Firefox drops the whole rule for the prefixed selector it does not know. They now use the forgiving `:host(:is(:fullscreen, :-webkit-full-screen))`.
- **Tracking pixels** (sponsorship, ad triggers) now get a cache-buster (`[CACHEBUSTING]` / `[timestamp]` macros are filled, otherwise `hp_cb` is added): a repeated impression of the same URL — e.g. the sponsor intro every N minutes — could be served from the browser's memory cache and never reach the server (Firefox).
- **Safari / iOS early seeks:** WebKit raises `readyState` before `loadedmetadata` and then resets a seek made in between back to 0. The QR resume `?vtime=` jump and the React Native `seek()` sent before the player is ready now verify the position on `seeked` and re-apply it. The same applies when a Cast session ends: on WebKitGTK / WPE local playback did not continue from the TV's position (the seek was lost or undone by the engine) — the player now starts playback first, then seeks, and re-applies the seek if the engine jumps back.
- **No audio output device (Firefox):** Firefox reports a missing or unavailable audio output (no sound card, a disconnected Bluetooth headset) as a decode error while the video keeps playing silently. The player showed the error screen over the playing video, skipped to the next playlist item, and reloaded the track from the start on the next option change. This error is now treated as non-fatal.
- **`hp:ready` could be missed:** it was dispatched synchronously while `import '@hopeplayer/core'` upgraded the element, so a listener added right after the import (as in the README) never fired. It is now dispatched a microtask later; listeners attached earlier (the React and Vue wrappers) still receive it.
- **Ad triggers:** with `closeDelay: 0` the close button appeared one frame after the box (it was shown from a `setTimeout`); it now appears together with the box.
- **Seeking to the very end on WebKitGTK / WPE** (Linux browsers, WPE-based TVs and devices) jumped back to 0 when the end was not buffered yet. Skip buttons, the seek bar and the keyboard now stop 0.05 s before the end.
- **Taps could land on the wrong control:** when the player did not fit fully on screen, pressing any control focused the player and scrolled the page, so the release landed on whatever slid under the pointer (e.g. the story "next" button turned into a seek bar tap). The player now takes focus without scrolling.
- **Story mode:** a quick second "next" / "previous" tap while the previous item was still loading was silently dropped; it is now applied once the switch finishes.

### Project
- Docs: release notes page generated from this file; CDN install, browser support and accessibility sections on the install page; full event list.
- Examples (web component, React, Vue) updated to 1.0.17 with the redirect card and Cast.
- CI checks that every event declared in `HopePlayerEventMap` is actually dispatched.
- **Cross-browser tests:** the end-to-end suite now runs in Firefox and WebKit too (`npm run test:firefox` / `test:webkit`) — nightly, on demand and before every release (`cross-browser.yml`; publishing waits for it). Chromium runs on every push in 4 parallel shards (`run.mjs --shard`); CI skips documentation-only changes and cancels superseded runs. Engine-specific checks are guarded with `only()` (Playwright's WebKit has no HLS, Web Audio or Media Session, and stops a looping video at its end). `npm run test:linux` runs the same Linux environment locally with Docker (the official Playwright image, no audio device, the steps of `cross-browser.yml`); the test summary repeats each failed suite's `FAIL` and error lines.
- **Real Safari tests:** smoke tests in real macOS Safari (`safaridriver`) and in Safari on the iOS Simulator (Appium XCUITest) on GitHub's macOS machines — startup, playback, pause / resume, seeking, captions without `<track>`, native HLS, QR resume, audio mode, fullscreen and AirPlay (`apple.yml`, nightly and on demand; not yet a release gate). Dependency-free W3C WebDriver client.

## [1.0.17] — 2026-11-05

### Added
- **Redirect screen `mode: 'card'`:** an "Up next" card appears in a corner `showBefore` seconds before the end, with image, duration badge, title, subtitle and a countdown ring that runs with the video; it redirects when the video ends, clicking the card goes immediately, X cancels.
- New redirect options: `position`, `label`, `subtitle`, `duration`, `newTab`; `duration` on suggestions.
- `hp:redirect` event (`shown` / `cancel` / `redirect`) — the `redirect` state is cancelable (`preventDefault()`) so SPAs can navigate themselves.
- `ads.prebid.custParams` (and `midroll.custParams`): extra GAM `cust_params` key-values sent to the GAM ad unit whether the auction is won or not, also on the fallback tag, on retries and on Cast TV tags. `hb_*` keys cannot be overridden.

### Changed
- Redesigned the full-area redirect screen (blurred backdrop, poster with countdown ring) and the suggestions grid.

### Fixed
- Suggestion titles were rendered as HTML (XSS) — now plain text.
- The redirect screen never showed after a postroll; the redirect now waits for the postroll to finish.
- Changing the `redirectScreen` option after the first apply had no effect.
- **Keyboard access:** the player host got `tabindex="-1"` instead of `0`, which removed every control from the Tab order — keyboard users could not reach play, volume, settings or fullscreen. A `tabindex` set by the page is still respected.
- Accessibility: the rewarded-ad dialog has an accessible name, the "Unlock 720p" button and the redirect card's accessible names match their visible text, the vinyl slider exposes its value from the start, and the time display has a visible focus ring.

### Changed
- Plugin chunks are named after their plugin (`ads-…js`, `cast-…js`) instead of `index-…js`.

### Project
- `CHANGELOG.md` with a versioning policy, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates.
- npm `keywords` for all packages; README with a one-line CDN quick start, browser support table and a comparison with other players.
- CI runs the full Playwright end-to-end suite, an axe-core accessibility scan (WCAG 2.1 A / AA) and a bundle-size budget on every push and pull request; GitHub Actions moved to Node 24 runtimes.

## [1.0.16] — 2026-11-03

### Added
- **Cast to TV (`cast`):** Google Cast (Chromecast, Google TV) with the player as a remote, ads played on the TV (VMAP or preroll / midroll / postroll), subtitles and metadata; AirPlay; Remote Playback API fallback. All off by default. `hp:cast` event.
- **Ad triggers (`adTriggers`):** rule-driven Ad Manager out-of-page ads — rules from your API or `config`; triggers for seconds, intervals, percent, fullscreen enter / exit, start, pause, resume, end; `mode`, `layout` (`'none'` by default: only the request is sent), `custParams`, frequency caps, tracking. `closeAdTrigger()` method.
- **Fallback sources:** mixed-format `sources` are grouped by format; `sourcePriority` sets the order and the next format is tried on a fatal error, keeping the position. `hp:sourcefallback` event (React `onSourceFallback`, Vue `@sourcefallback`).

### Changed
- Rewarded ads close themselves once watched and granted; when no ad is available the quality unlocks anyway with a notice (`grantOnNoFill` now defaults to `true`).
- The "Preparing ad" dialog has a timeout and a "No thanks" button.
- On mobile the sponsor logo moves to the corner while the controls are hidden.

### Fixed
- GPT is loaded from `securepubads.g.doubleclick.net` (certificate errors on some networks).
- Quality menu mixing HLS levels and MP4 qualities in combined source lists.

## [1.0.15] — 2026-11-01

### Added
- **Rewarded quality unlock (`rewardedUnlock`):** start at a capped quality, unlock higher qualities by watching a rewarded ad (GPT or your own provider).
- **Sponsorship layer (`sponsorship`):** player colors, corner logo and a "Presented by" intro from your own API, with repeat intervals and tracking pixels.

## [1.0.14] — 2026-11-01

### Added
- `audio.layout: 'compact'` — a thin, controls-only audio player.

### Fixed
- Cover and vinyl were left-aligned on iOS in the audio player.

## [1.0.13] — 2026-10-31

### Added
- **Audio player (`audio`):** cover, vinyl with scratch-to-seek, optional scratch sound, hold to stop, tonearm, Media Session metadata, audio ads.
- Generic `aspectRatio` option.
- Caption settings moved into their own submenu.

## [1.0.12] — 2026-10-31

### Added
- OM SDK (Open Measurement) access mode for IMA, preroll gate (content waits for the preroll), ad-host preconnect.
- Ads resize with the player (fullscreen / window changes); iOS fullscreen guard for ad breaks.

## [1.0.6 – 1.0.11] — 2026-10-29 / 2026-10-30

### Added
- React Native wrapper (`@hopeplayer/react-native`) and Expo example.
- StackBlitz / Expo Snack examples for the web component, React, Vue and React Native.
- Pause ad plugin, skip back / forward buttons, `tapToPlay`.

### Fixed
- Options set before the element was connected were lost.
- Android touch jitter and caption animation smoothness.

## [1.0.0 – 1.0.5] — 2026-10-28

Initial public release: the `<hope-player>` custom element with Shadow DOM, HLS via hls.js (lazy), Google IMA ads, Prebid, consent, playlist, story mode, markers, segments, sprite thumbnails, countdown / geo / redirect screens, QR resume, dubbing, live wall clock, SCTE-35, DAI, theming presets and i18n; React and Vue wrappers.

[Unreleased]: https://github.com/umutyaldiz/hopecoreplayer/compare/v1.0.18...HEAD
[1.0.18]: https://github.com/umutyaldiz/hopecoreplayer/releases/tag/v1.0.18
[1.0.17]: https://github.com/umutyaldiz/hopecoreplayer/releases/tag/v1.0.17
[1.0.16]: https://github.com/umutyaldiz/hopecoreplayer/releases/tag/v1.0.16
[1.0.15]: https://github.com/umutyaldiz/hopecoreplayer/releases/tag/v1.0.15
[1.0.14]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.14
[1.0.13]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.13
[1.0.12]: https://www.npmjs.com/package/@hopeplayer/core/v/1.0.12
