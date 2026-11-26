<?php
/**
 * Optional: core Video block and [video] shortcode play with HopeCorePlayer (setting, off by default).
 *
 * @package HopeCorePlayer
 */

defined( 'ABSPATH' ) || exit;

/** Core Video block → HopeCorePlayer (stored post content is not changed). */
function hopecoreplayer_render_core_video( $content, $block ) {
	if ( is_admin() || ! hopecoreplayer_settings()['replace_core_video'] ) {
		return $content;
	}
	$a   = $block['attrs'] ?? array();
	$src = $a['src'] ?? '';
	if ( ! $src && ! empty( $a['id'] ) ) {
		$src = (string) wp_get_attachment_url( (int) $a['id'] );
	}
	// Older blocks keep src / poster / tracks only in the saved HTML.
	if ( ! $src && preg_match( '/<video[^>]*\ssrc="([^"]+)"/i', $content, $m ) ) {
		$src = html_entity_decode( $m[1] );
	}
	if ( ! $src ) {
		return $content;
	}
	$poster = $a['poster'] ?? '';
	if ( ! $poster && preg_match( '/<video[^>]*\sposter="([^"]+)"/i', $content, $m ) ) {
		$poster = html_entity_decode( $m[1] );
	}
	$subtitles = array();
	foreach ( (array) ( $a['tracks'] ?? array() ) as $track ) {
		if ( ! empty( $track['src'] ) && ( $track['kind'] ?? 'subtitles' ) !== 'chapters' ) {
			$subtitles[] = array(
				'src'     => $track['src'],
				'label'   => $track['label'] ?? '',
				'srclang' => $track['srcLang'] ?? '',
				'default' => ! empty( $track['default'] ),
			);
		}
	}
	$options = hopecoreplayer_build_options(
		array(
			'src'       => $src,
			'poster'    => $poster,
			'autoplay'  => ! empty( $a['autoplay'] ),
			'muted'     => ! empty( $a['muted'] ),
			'loop'      => ! empty( $a['loop'] ),
			'subtitles' => $subtitles,
		)
	);
	// Keep the block's caption under the player.
	$caption = '';
	if ( preg_match( '/<figcaption[^>]*>.*?<\/figcaption>/is', $content, $m ) ) {
		$caption = $m[0];
	}
	$markup = hopecoreplayer_markup( $options );
	return $markup ? '<figure class="wp-block-video hopecoreplayer-core-video">' . $markup . $caption . '</figure>' : $content;
}
add_filter( 'render_block_core/video', 'hopecoreplayer_render_core_video', 10, 2 );

/** [video] shortcode → HopeCorePlayer. */
function hopecoreplayer_video_shortcode( $output, $atts ) {
	if ( '' !== $output || is_admin() || ! hopecoreplayer_settings()['replace_core_video'] ) {
		return $output;
	}
	$atts = is_array( $atts ) ? $atts : array();
	$src  = $atts['src'] ?? '';
	foreach ( array( 'mp4', 'm4v', 'webm', 'ogv' ) as $ext ) {
		if ( ! $src && ! empty( $atts[ $ext ] ) ) {
			$src = $atts[ $ext ];
		}
	}
	if ( ! $src ) {
		return $output;
	}
	$yes = function ( $v ) {
		return in_array( strtolower( (string) $v ), array( '1', 'true', 'on', 'yes', 'autoplay', 'loop', 'muted' ), true );
	};
	$markup = hopecoreplayer_markup(
		hopecoreplayer_build_options(
			array(
				'src'      => $src,
				'poster'   => $atts['poster'] ?? '',
				'autoplay' => $yes( $atts['autoplay'] ?? '' ),
				'loop'     => $yes( $atts['loop'] ?? '' ),
				'muted'    => $yes( $atts['muted'] ?? '' ),
			)
		)
	);
	return $markup ? $markup : $output;
}
add_filter( 'wp_video_shortcode_override', 'hopecoreplayer_video_shortcode', 10, 2 );
