<?php
/**
 * Builds the <hope-player> options from settings + block / shortcode attributes.
 *
 * @package HopeCorePlayer
 */

defined( 'ABSPATH' ) || exit;

/** Decodes a JSON object string; anything else gives an empty array. */
function hopecoreplayer_json_object( $json ) {
	if ( ! is_string( $json ) || '' === trim( $json ) ) {
		return array();
	}
	$data = json_decode( $json, true );
	return is_array( $data ) ? $data : array();
}

/** Deep merge: values in $over win, lists are replaced (not merged). */
function hopecoreplayer_merge( array $base, array $over ) {
	foreach ( $over as $key => $value ) {
		if ( is_array( $value ) && isset( $base[ $key ] ) && is_array( $base[ $key ] ) && ! wp_is_numeric_array( $value ) && ! wp_is_numeric_array( $base[ $key ] ) ) {
			$base[ $key ] = hopecoreplayer_merge( $base[ $key ], $value );
		} else {
			$base[ $key ] = $value;
		}
	}
	return $base;
}

/** Player language from the setting (site language when "auto"). */
function hopecoreplayer_locale( $setting ) {
	if ( 'auto' !== $setting ) {
		return $setting;
	}
	return 0 === strpos( determine_locale(), 'tr' ) ? 'tr' : 'en';
}

/** Ad options from settings (null when ads are off or no tag is set). */
function hopecoreplayer_settings_ads( array $s ) {
	if ( empty( $s['ads_enabled'] ) ) {
		return null;
	}
	$ads = array();
	if ( $s['ad_vmap'] ) {
		$ads['adTagVmap'] = $s['ad_vmap'];
	} else {
		if ( $s['ad_preroll'] ) {
			$ads['adTagPreroll'] = $s['ad_preroll'];
		}
		if ( $s['ad_midroll'] ) {
			$ads['adTagMidroll'] = $s['ad_midroll'];
			if ( $s['ad_midroll_every'] > 0 ) {
				$ads['midrollIntervalSeconds'] = (int) $s['ad_midroll_every'];
			}
		}
		if ( $s['ad_postroll'] ) {
			$ads['adTagPostroll'] = $s['ad_postroll'];
		}
	}
	return $ads ? $ads : null;
}

/** Site-wide options (also passed to the editor preview). */
function hopecoreplayer_global_options() {
	$s    = hopecoreplayer_settings();
	$opts = array(
		'theme'     => $s['theme'],
		'locale'    => hopecoreplayer_locale( $s['locale'] ),
		'preload'   => $s['preload'],
		'pipButton' => (bool) $s['pip'],
	);
	if ( $s['skip_buttons'] ) {
		$opts['skipButtons'] = true;
	}
	if ( $s['sticky'] ) {
		$opts['sticky'] = array( 'corner' => $s['sticky_corner'] );
	}
	$ads = hopecoreplayer_settings_ads( $s );
	if ( $ads ) {
		$opts['ads'] = $ads;
	}
	return hopecoreplayer_merge( $opts, hopecoreplayer_json_object( $s['advanced'] ) );
}

/** "file.m3u8" → hls, ".mpd" → dash, otherwise the browser decides (mp4 / webm / audio). */
function hopecoreplayer_source_type( $url, $format ) {
	if ( 'hls' === $format || ( 'auto' === $format && preg_match( '/\.m3u8(\?|#|$)/i', $url ) ) ) {
		return 'application/x-mpegURL';
	}
	if ( 'dash' === $format || ( 'auto' === $format && preg_match( '/\.mpd(\?|#|$)/i', $url ) ) ) {
		return 'application/dash+xml';
	}
	return '';
}

/** Cleans a list of rows: keeps the listed string / number / bool keys, drops rows without $required. */
function hopecoreplayer_rows( $rows, array $keys, $required ) {
	$out = array();
	foreach ( is_array( $rows ) ? $rows : array() as $row ) {
		if ( ! is_array( $row ) || empty( $row[ $required ] ) ) {
			continue;
		}
		$clean = array();
		foreach ( $keys as $key => $kind ) {
			if ( ! isset( $row[ $key ] ) || '' === $row[ $key ] ) {
				continue;
			}
			if ( 'url' === $kind ) {
				$clean[ $key ] = esc_url_raw( $row[ $key ] );
			} elseif ( 'num' === $kind ) {
				$clean[ $key ] = (float) $row[ $key ];
			} elseif ( 'bool' === $kind ) {
				$clean[ $key ] = (bool) $row[ $key ];
			} else {
				$clean[ $key ] = sanitize_text_field( (string) $row[ $key ] );
			}
		}
		$out[] = $clean;
	}
	return $out;
}

/**
 * Player options for one block / shortcode.
 *
 * @param array $a Attributes (block.json names).
 * @return array
 */
function hopecoreplayer_build_options( array $a ) {
	$opts = hopecoreplayer_global_options();

	$src    = isset( $a['src'] ) ? esc_url_raw( $a['src'] ) : '';
	$format = isset( $a['format'] ) ? $a['format'] : 'auto';
	if ( ! $src && ! empty( $a['mediaId'] ) ) {
		$src = (string) wp_get_attachment_url( (int) $a['mediaId'] );
	}

	// Quality list: "Auto" first for a stream, then MP4 renditions.
	$sources = hopecoreplayer_rows( $a['sources'] ?? array(), array( 'src' => 'url', 'label' => 'text', 'height' => 'num' ), 'src' );
	if ( $sources ) {
		foreach ( $sources as &$source ) {
			if ( empty( $source['label'] ) ) {
				$source['label'] = isset( $source['height'] ) ? $source['height'] . 'p' : basename( wp_parse_url( $source['src'], PHP_URL_PATH ) );
			}
			$type = hopecoreplayer_source_type( $source['src'], 'auto' );
			if ( $type ) {
				$source['type'] = $type;
			}
		}
		unset( $source );
		if ( $src ) {
			$main = array( 'src' => $src, 'label' => __( 'Auto', 'hopecoreplayer' ) );
			$type = hopecoreplayer_source_type( $src, $format );
			if ( $type ) {
				$main['type'] = $type;
			}
			array_unshift( $sources, $main );
		}
		$opts['sources'] = $sources;
	} elseif ( $src ) {
		$type = hopecoreplayer_source_type( $src, $format );
		if ( $type ) {
			$opts['sources'] = array(
				array(
					'src'   => $src,
					'type'  => $type,
					'label' => __( 'Auto', 'hopecoreplayer' ),
				),
			);
		} else {
			$opts['src'] = $src;
		}
	}

	$poster = isset( $a['poster'] ) ? esc_url_raw( $a['poster'] ) : '';
	if ( ! $poster && ! empty( $a['posterId'] ) ) {
		$poster = (string) wp_get_attachment_image_url( (int) $a['posterId'], 'large' );
	}
	if ( ! $poster && ! empty( $a['mediaId'] ) ) {
		$poster = (string) get_the_post_thumbnail_url( (int) $a['mediaId'], 'large' );
	}
	if ( $poster ) {
		$opts['poster'] = $poster;
	}

	if ( ! empty( $a['audio'] ) ) {
		$audio = array( 'layout' => 'full' );
		if ( $poster ) {
			$audio['cover'] = $poster;
		}
		if ( ! empty( $a['title'] ) ) {
			$audio['title'] = sanitize_text_field( $a['title'] );
		}
		if ( ! empty( $a['artist'] ) ) {
			$audio['artist'] = sanitize_text_field( $a['artist'] );
		}
		$opts['audio'] = $audio;
	}

	foreach ( array( 'autoplay', 'muted', 'loop' ) as $flag ) {
		if ( ! empty( $a[ $flag ] ) ) {
			$opts[ $flag ] = true;
		}
	}
	// Browsers allow autoplay only without sound.
	if ( ! empty( $a['autoplay'] ) ) {
		$opts['muted'] = true;
	}
	if ( ! empty( $a['theme'] ) && array_key_exists( $a['theme'], hopecoreplayer_theme_choices() ) ) {
		$opts['theme'] = $a['theme'];
	}
	if ( ! empty( $a['aspectRatio'] ) ) {
		$opts['aspectRatio'] = sanitize_text_field( $a['aspectRatio'] );
	}

	$subtitles = hopecoreplayer_rows( $a['subtitles'] ?? array(), array( 'src' => 'url', 'label' => 'text', 'srclang' => 'text', 'default' => 'bool' ), 'src' );
	foreach ( $subtitles as &$track ) {
		$track += array( 'srclang' => 'en' );
		$track += array( 'label' => strtoupper( $track['srclang'] ) );
	}
	unset( $track );
	if ( $subtitles ) {
		$opts['subtitles'] = $subtitles;
	}

	// Chapters: rows with a start time; each ends where the next starts.
	$chapters = hopecoreplayer_rows( $a['chapters'] ?? array(), array( 'start' => 'num', 'end' => 'num', 'text' => 'text' ), 'text' );
	if ( $chapters ) {
		usort(
			$chapters,
			function ( $x, $y ) {
				return ( $x['start'] ?? 0 ) <=> ( $y['start'] ?? 0 );
			}
		);
		$count = count( $chapters );
		for ( $i = 0; $i < $count; $i++ ) {
			$chapters[ $i ]['start'] = $chapters[ $i ]['start'] ?? 0;
			if ( ! isset( $chapters[ $i ]['end'] ) && $i + 1 < $count ) {
				$chapters[ $i ]['end'] = $chapters[ $i + 1 ]['start'] ?? 0;
			}
		}
		$opts['segments'] = $chapters;
	}

	$items = hopecoreplayer_rows( $a['playlist'] ?? array(), array( 'src' => 'url', 'title' => 'text', 'image' => 'url', 'duration' => 'text' ), 'src' );
	if ( $items ) {
		$list = array();
		foreach ( $items as $item ) {
			$entry = array_intersect_key( $item, array_flip( array( 'title', 'image', 'duration' ) ) );
			$kind  = hopecoreplayer_source_type( $item['src'], 'auto' ) ? 'hls' : 'mp4';
			$entry[ $kind ] = array(
				array(
					'src'   => $item['src'],
					'label' => __( 'Auto', 'hopecoreplayer' ),
				),
			);
			$list[] = $entry;
		}
		$opts['playlist'] = array(
			'items'        => $list,
			'autoplayNext' => true,
			// No main video: the list starts at once; otherwise after the main video.
			'startMode'    => empty( $opts['src'] ) && empty( $opts['sources'] ) ? 'immediate' : 'after_current',
		);
	}

	$sticky = $a['sticky'] ?? 'default';
	if ( 'on' === $sticky && empty( $opts['sticky'] ) ) {
		$opts['sticky'] = array( 'corner' => hopecoreplayer_settings()['sticky_corner'] );
	} elseif ( 'off' === $sticky ) {
		unset( $opts['sticky'] );
	}

	$ads = $a['ads'] ?? 'default';
	if ( 'off' === $ads ) {
		unset( $opts['ads'] );
	} elseif ( 'custom' === $ads ) {
		$custom = array();
		if ( ! empty( $a['adVmap'] ) ) {
			$custom['adTagVmap'] = esc_url_raw( $a['adVmap'] );
		} elseif ( ! empty( $a['adPreroll'] ) ) {
			$custom['adTagPreroll'] = esc_url_raw( $a['adPreroll'] );
		}
		if ( $custom ) {
			$opts['ads'] = $custom;
		} else {
			unset( $opts['ads'] );
		}
	}

	$opts = hopecoreplayer_merge( $opts, hopecoreplayer_json_object( $a['advanced'] ?? '' ) );

	/**
	 * Filters the options of one player before it is printed.
	 *
	 * @param array $opts Player options.
	 * @param array $a    Block / shortcode attributes.
	 */
	return apply_filters( 'hopecoreplayer_options', $opts, $a );
}
