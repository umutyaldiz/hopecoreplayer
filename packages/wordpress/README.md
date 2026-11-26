# HopeCorePlayer for WordPress

The WordPress plugin of `@hopecoreplayer/core`: a block, the `[hopeplayer]` shortcode, a settings page and optional playback of the core Video block. The WordPress.org listing text lives in [readme.txt](readme.txt).

## Build

```bash
npm run build:core   # player
npm run build:wp     # copies the player into assets/player and writes dist/hopecoreplayer-<version>.zip
```

The plugin version must match `packages/core/package.json`. The build fails otherwise, so check `hopecoreplayer.php` (header and `HOPECOREPLAYER_VERSION`), `readme.txt` (`Stable tag`) and `blocks/player/block.json`.

## Test

WordPress, MariaDB and WP-CLI run in Docker:

```bash
docker compose -f packages/wordpress/test/docker-compose.yml up -d
node packages/wordpress/test/setup.mjs
npm run test:wp                        # HOPE_BROWSER=firefox|webkit also works
```

- Site: http://localhost:8890. Admin: `admin` / `admin`.
- Other PHP versions: `WP_IMAGE=wordpress:php7.4-apache WP_CLI_IMAGE=wordpress:cli-php7.4`.
- Oldest supported WordPress: `WP_VERSION=6.5 node packages/wordpress/test/setup.mjs`.
- The playground's `public/` folder is served at `/media`.
- Stop: `docker compose -f packages/wordpress/test/docker-compose.yml down -v`.

## Layout

| Path | What it does |
| --- | --- |
| `hopecoreplayer.php` | Plugin header, script modules, block and shortcode registration. |
| `includes/options.php` | Settings and block / shortcode attributes → player options, plus the `hopecoreplayer_options` filter. |
| `includes/render.php` | `<hope-player data-hp-options="…">` markup and the shortcode. |
| `includes/settings.php` | Settings → HopeCorePlayer. |
| `includes/core-video.php` | Optional core Video block / `[video]` replacement. |
| `blocks/player/` | Block metadata and the editor script (plain JS, no build step), with a real player preview in the editor iframe. |
| `assets/frontend.js` | Applies the JSON options to each player, including players added later. |
