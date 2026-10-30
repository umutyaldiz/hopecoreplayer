`# HopeCorePlayer — Vue example
`
`[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/umutyaldiz/hopecoreplayer/tree/main/examples/vue?file=src/App.vue)
`
`@hopeplayer/vue`: options as props, events as emits, and a template ref for play / pause.
`
`Shows an HLS stream and an MP4 with Turkish / English subtitles, skip buttons, double-tap gestures, the stats panel (right-click → stats), play / pause buttons and an event log.
`
`## Run
`
````bash
`cd examples/vue
`npm install
`npm run dev
````
`
`This folder is not part of the monorepo's npm workspaces: it installs the published packages from npm, exactly as your own project would. The subtitle files are in `public/` because the player fetches VTT files, so they must be served from the same origin (or with CORS headers).
