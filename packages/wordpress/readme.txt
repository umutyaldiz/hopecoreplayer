=== HopeCorePlayer – Video & Audio Player with Ads ===
Contributors: umutyaldiz
Tags: video player, hls, video ads, vast, audio player
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.15.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Fast, accessible video and audio player block: HLS / DASH, subtitles, chapters, playlists, sticky mini player and VAST / VMAP ads.

== Description ==

HopeCorePlayer adds a modern, lightweight player to your site as a block and a shortcode. It is the WordPress plugin of the open-source [HopeCorePlayer](https://github.com/umutyaldiz/hopecoreplayer) web component.

**Media**

* Video files (MP4, WebM), audio files (MP3, M4A…) from the media library or any URL.
* HLS (.m3u8) and DASH (.mpd) streams, including live streams, with adaptive quality.
* Quality menu: add your own MP4 renditions (1080p, 720p…).
* Subtitles (WebVTT) with a size / color menu, chapters on the progress bar, poster image.
* Audio player with cover, title and artist.
* Playlist with a list next to the player.

**Viewing**

* Sticky mini player: keeps playing in a corner when the player scrolls out of view; viewers can move and resize it.
* Picture-in-picture, fullscreen, playback speed, keyboard shortcuts, double-tap to seek on phones.
* Four themes and an accent color; English and Turkish interface.
* Accessible: keyboard and screen reader friendly.

**Ads**

* Pre-roll, mid-roll and post-roll VAST tags or a VMAP schedule, site-wide or per block (Google IMA SDK).
* Ads are off until you add a tag.

**For developers**

* Every player option is available through the "Advanced (JSON)" field in the block and in the settings, and through the `hopecoreplayer_options` filter.
* Optionally plays the core Video block and the `[video]` shortcode with HopeCorePlayer, without changing your posts.

Documentation and live demos: [umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer)

== Installation ==

1. Install the plugin from **Plugins → Add New** (search "HopeCorePlayer"), or upload the zip, then activate it.
2. In the block editor, add the **HopeCorePlayer** block and pick a video or audio file, or paste a link.
3. Optional: set site-wide defaults (theme, sticky player, ads) in **Settings → HopeCorePlayer**.

Shortcode example:

`[hopeplayer src="https://example.com/video.mp4" poster="https://example.com/poster.jpg" subtitles="https://example.com/en.vtt|English|en"]`

Shortcode attributes: `id` (media library ID), `src`, `format` (auto, mp4, hls, dash), `poster`, `audio`, `title`, `artist`, `autoplay`, `muted`, `loop`, `theme`, `accent` (#hex), `aspect_ratio`, `subtitles` (comma separated `url|Label|lang`), `sticky` (on / off), `ads` (off), `ad_preroll`, `ad_vmap`.

== Frequently Asked Questions ==

= Does it load anything from other sites? =

Not by default: the player's code is included in the plugin. Other services are contacted only when you turn on a feature that needs them — see "External services" below.

= Why does autoplay start muted? =

Browsers block autoplay with sound. The viewer can turn the sound on with one tap.

= Can I use my existing videos? =

Yes. Turn on "Play the core Video block and the [video] shortcode with HopeCorePlayer" in Settings → HopeCorePlayer. Your posts are not changed; turning the setting off brings the default player back.

= How do I use an option that is not in the block panel? =

Put it in the "Advanced (JSON)" field, for example `{ "playbackRates": [0.75, 1, 1.5, 2] }`. All options are listed in the documentation.

== External services ==

The plugin bundles the player and does not contact other services by default. These are used only when you configure the matching feature:

* **Google IMA SDK** (imasdk.googleapis.com) — loaded on pages with a player that has an ad tag (Settings → HopeCorePlayer → Ads, or a block's own ad tag). The ad requests go to the ad server in your tag. Google terms: https://policies.google.com/terms — privacy: https://policies.google.com/privacy
* **Google Ad Manager GPT** (securepubads.g.doubleclick.net) — only with the `pauseAd` advanced option.
* **Google Cast SDK** (www.gstatic.com) — only with the `cast` advanced option, when the viewer uses Chromecast.
* **GeoJS** (get.geojs.io) — only with the `geoChecker` advanced option, to read the viewer's country. Terms: https://www.geojs.io/
* Your own media, subtitle and stream URLs are loaded from the servers you enter.

== Screenshots ==

1. The player on a post.
2. Block settings in the editor.
3. Audio player.
4. Sticky mini player.
5. Settings → HopeCorePlayer.

== Changelog ==

= 1.15.0 =
* Player 1.15.0: horizontal volume slider with a level indicator, captions (CC) button and C shortcut, smoother animations across the controls, optional page-wide keyboard shortcuts (globalShortcuts in Advanced JSON).

= 1.14.1 =
* First WordPress.org release, with player 1.14.1: block, shortcode, settings page, optional core Video block replacement.

== Upgrade Notice ==

= 1.15.0 =
New volume slider, captions button and smoother controls.

= 1.14.1 =
First release.
