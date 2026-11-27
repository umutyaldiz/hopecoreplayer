<?php
/**
 * Plugin Name:       HopeCorePlayer – Video & Audio Player with Ads
 * Plugin URI:        https://umutyaldiz.com/hopecoreplayer
 * Description:       Fast, accessible video and audio player block with HLS / DASH, subtitles, chapters, playlists, sticky mini player and VAST / VMAP ads.
 * Version:           1.15.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Author:            Umut Yaldız
 * Author URI:        https://www.umutyaldiz.com
 * License:           MIT
 * License URI:       https://opensource.org/licenses/MIT
 * Text Domain:       hopecoreplayer
 *
 * @package HopeCorePlayer
 */

defined( 'ABSPATH' ) || exit;

define( 'HOPECOREPLAYER_VERSION', '1.15.0' );
define( 'HOPECOREPLAYER_FILE', __FILE__ );
define( 'HOPECOREPLAYER_DIR', plugin_dir_path( __FILE__ ) );
define( 'HOPECOREPLAYER_URL', plugin_dir_url( __FILE__ ) );

require_once HOPECOREPLAYER_DIR . 'includes/settings.php';
require_once HOPECOREPLAYER_DIR . 'includes/options.php';
require_once HOPECOREPLAYER_DIR . 'includes/render.php';
require_once HOPECOREPLAYER_DIR . 'includes/core-video.php';

/** Player modules: the player itself and the small loader that hands options to each <hope-player>. */
function hopecoreplayer_register_assets() {
	wp_register_script_module(
		'@hopecoreplayer/player',
		HOPECOREPLAYER_URL . 'assets/player/hope-player.js',
		array(),
		HOPECOREPLAYER_VERSION
	);
	wp_register_script_module(
		'@hopecoreplayer/frontend',
		HOPECOREPLAYER_URL . 'assets/frontend.js',
		array( '@hopecoreplayer/player' ),
		HOPECOREPLAYER_VERSION
	);
}
add_action( 'init', 'hopecoreplayer_register_assets', 5 );

/** Block (editor script + server render). */
function hopecoreplayer_register_block() {
	register_block_type(
		HOPECOREPLAYER_DIR . 'blocks/player',
		array( 'render_callback' => 'hopecoreplayer_render_block' )
	);
	// Editor preview loads the real player inside the editor iframe.
	wp_localize_script(
		'hopecoreplayer-player-editor-script',
		'hopecoreplayerEditor',
		array(
			'playerUrl' => add_query_arg( 'ver', HOPECOREPLAYER_VERSION, HOPECOREPLAYER_URL . 'assets/player/hope-player.js' ),
			'defaults'  => hopecoreplayer_global_options(),
			'settings'  => admin_url( 'options-general.php?page=hopecoreplayer' ),
		)
	);
}
add_action( 'init', 'hopecoreplayer_register_block' );

add_shortcode( 'hopeplayer', 'hopecoreplayer_shortcode' );

/** Settings link on the Plugins screen. */
function hopecoreplayer_action_links( $links ) {
	$url = admin_url( 'options-general.php?page=hopecoreplayer' );
	array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'hopecoreplayer' ) . '</a>' );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'hopecoreplayer_action_links' );
