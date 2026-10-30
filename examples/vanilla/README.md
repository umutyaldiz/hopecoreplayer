# HopeCorePlayer — Web Component example

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/edit/hopecoreplayer-vanilla?file=src/main.ts)

Plain `<hope-player>` with `@hopeplayer/core`, no framework: options are set through the `.options` property and events are `hp:*` DOM events.

Shows an HLS stream and an MP4 with Turkish / English subtitles, skip buttons, double-tap gestures, the stats panel (right-click → stats), play / pause buttons and an event log.

## Run

```bash
cd examples/vanilla
npm install
npm run dev
```

This folder is not part of the monorepo's npm workspaces: it installs the published packages from npm, exactly as your own project would. The subtitle files are in `public/` because the player fetches VTT files, so they must be served from the same origin (or with CORS headers).

The StackBlitz project is a saved copy of this folder: after changing the code here, update it there too.
