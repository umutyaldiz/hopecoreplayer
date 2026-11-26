<?php
/**
 * Prints <hope-player> for the block, the [hopeplayer] shortcode and replaced core video.
 *
 * @package HopeCorePlayer
 */

defined( 'ABSPATH' ) || exit;

/**
 * Player markup; options travel as JSON in data-hp-options (assets/frontend.js applies them).
 *
 * @param array  $options Player options.
 * @param string $wrapper Wrapper attributes (block supports) or empty.
 * @param string $accent  Accent color (#hex); empty → site setting.
 * @return string
 */
function hopecoreplayer_markup( array $options, $wrapper = '', $accent = '' ) {
	if ( empty( $options['src'] ) && empty( $options['sources'] ) && empty( $options['playlist'] ) ) {
		return '';
	}
	wp_enqueue_script_module( '@hopecoreplayer/frontend' );
	wp_enqueue_style( 'hopecoreplayer-player-style' );

	$json   = wp_json_encode( $options, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	$css    = array();
	$ratio  = isset( $options['aspectRatio'] ) ? str_replace( ':', ' / ', (string) $options['aspectRatio'] ) : '';
	$accent = sanitize_hex_color( $accent ? $accent : hopecoreplayer_settings()['accent'] );
	if ( $ratio ) {
		$css[] = '--hp-aspect-ratio: ' . $ratio;
	}
	if ( $accent ) {
		$css[] = '--hp-color-accent: ' . $accent;
	}
	$style = $css ? ' style="' . esc_attr( implode( '; ', $css ) ) . '"' : '';
	$player = sprintf(
		'<hope-player class="hopecoreplayer"%s%s data-hp-options="%s"></hope-player>',
		! empty( $options['audio'] ) ? ' data-hp-audio' : '',
		$style,
		esc_attr( $json )
	);
	// Without JavaScript: the poster and a link to the file.
	$fallback = '';
	$file     = $options['src'] ?? ( $options['sources'][0]['src'] ?? '' );
	if ( $file ) {
		$fallback = '<noscript><a href="' . esc_url( $file ) . '">' . esc_html__( 'Open the media file', 'hopecoreplayer' ) . '</a></noscript>';
	}
	if ( '' === $wrapper ) {
		$wrapper = 'class="hopecoreplayer-wrap"';
	}
	return '<div ' . $wrapper . '>' . $player . $fallback . '</div>';
}

/** Block render callback. */
function hopecoreplayer_render_block( $attributes ) {
	$attributes = is_array( $attributes ) ? $attributes : array();
	$options    = hopecoreplayer_build_options( $attributes );
	return hopecoreplayer_markup( $options, get_block_wrapper_attributes( array( 'class' => 'hopecoreplayer-wrap' ) ), $attributes['accent'] ?? '' );
}

/** "url|Label|lang, url2|Label 2|lang2" → subtitle rows. */
function hopecoreplayer_parse_tracks( $value ) {
	$rows = array();
	foreach ( preg_split( '/\s*,\s*(?=https?:|\/)/', trim( (string) $value ) ) as $i => $part ) {
		if ( '' === $part ) {
			continue;
		}
		$bits   = array_map( 'trim', explode( '|', $part ) );
		$rows[] = array(
			'src'     => $bits[0],
			'label'   => $bits[1] ?? '',
			'srclang' => $bits[2] ?? '',
			'default' => 0 === $i,
		);
	}
	return $rows;
}

/**
 * [hopeplayer src="…" poster="…" title="…" subtitles="url|Türkçe|tr" sticky="on" ads="off"]
 *
 * @param array|string $atts Shortcode attributes.
 * @return string
 */
function hopecoreplayer_shortcode( $atts ) {
	$atts = shortcode_atts(
		array(
			'id'           => 0,
			'src'          => '',
			'format'       => 'auto',
			'poster'       => '',
			'audio'        => '',
			'title'        => '',
			'artist'       => '',
			'autoplay'     => '',
			'muted'        => '',
			'loop'         => '',
			'theme'        => '',
			'accent'       => '',
			'aspect_ratio' => '',
			'subtitles'    => '',
			'sticky'       => 'default',
			'ads'          => 'default',
			'ad_preroll'   => '',
			'ad_vmap'      => '',
		),
		$atts,
		'hopeplayer'
	);
	$yes = function ( $v ) {
		return in_array( strtolower( (string) $v ), array( '1', 'true', 'yes', 'on' ), true );
	};
	$ads = in_array( $atts['ads'], array( 'off', 'default', 'custom' ), true ) ? $atts['ads'] : 'default';
	if ( 'default' === $ads && ( $atts['ad_preroll'] || $atts['ad_vmap'] ) ) {
		$ads = 'custom';
	}
	$attributes = array(
		'mediaId'     => absint( $atts['id'] ),
		'src'         => $atts['src'],
		'format'      => in_array( $atts['format'], array( 'auto', 'mp4', 'hls', 'dash' ), true ) ? $atts['format'] : 'auto',
		'poster'      => $atts['poster'],
		'audio'       => $yes( $atts['audio'] ),
		'title'       => $atts['title'],
		'artist'      => $atts['artist'],
		'autoplay'    => $yes( $atts['autoplay'] ),
		'muted'       => $yes( $atts['muted'] ),
		'loop'        => $yes( $atts['loop'] ),
		'theme'       => $atts['theme'],
		'aspectRatio' => $atts['aspect_ratio'],
		'subtitles'   => hopecoreplayer_parse_tracks( $atts['subtitles'] ),
		'sticky'      => in_array( $atts['sticky'], array( 'on', 'off' ), true ) ? $atts['sticky'] : 'default',
		'ads'         => $ads,
		'adPreroll'   => $atts['ad_preroll'],
		'adVmap'      => $atts['ad_vmap'],
	);
	if ( $attributes['mediaId'] && ! $attributes['audio'] ) {
		$attributes['audio'] = 0 === strpos( (string) get_post_mime_type( $attributes['mediaId'] ), 'audio/' );
	}
	return hopecoreplayer_markup( hopecoreplayer_build_options( $attributes ), '', $atts['accent'] );
}
