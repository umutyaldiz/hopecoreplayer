<?php
/**
 * Settings → HopeCorePlayer: site-wide defaults for every player.
 *
 * @package HopeCorePlayer
 */

defined( 'ABSPATH' ) || exit;

const HOPECOREPLAYER_OPTION = 'hopecoreplayer_settings';

/** Default values (ads and replacing core video are off). */
function hopecoreplayer_default_settings() {
	return array(
		'theme'              => 'glass-dark',
		'accent'             => '',
		'locale'             => 'auto',
		'preload'            => 'metadata',
		'pip'                => true,
		'skip_buttons'       => false,
		'sticky'             => false,
		'sticky_corner'      => 'br',
		'replace_core_video' => false,
		'ads_enabled'        => false,
		'ad_preroll'         => '',
		'ad_midroll'         => '',
		'ad_postroll'        => '',
		'ad_vmap'            => '',
		'ad_midroll_every'   => 0,
		'advanced'           => '',
	);
}

/** Saved settings merged over the defaults. */
function hopecoreplayer_settings() {
	$saved = get_option( HOPECOREPLAYER_OPTION, array() );
	return wp_parse_args( is_array( $saved ) ? $saved : array(), hopecoreplayer_default_settings() );
}

function hopecoreplayer_theme_choices() {
	return array(
		'glass-dark'  => __( 'Glass dark', 'hopecoreplayer' ),
		'glass-light' => __( 'Glass light', 'hopecoreplayer' ),
		'neo-dark'    => __( 'Neo dark', 'hopecoreplayer' ),
		'mono'        => __( 'Mono', 'hopecoreplayer' ),
	);
}

/** Cleans the submitted form. */
function hopecoreplayer_sanitize_settings( $input ) {
	$d   = hopecoreplayer_default_settings();
	$in  = is_array( $input ) ? $input : array();
	$out = array();

	$out['theme']         = array_key_exists( $in['theme'] ?? '', hopecoreplayer_theme_choices() ) ? $in['theme'] : $d['theme'];
	$out['accent']        = sanitize_hex_color( $in['accent'] ?? '' ) ?? '';
	$out['locale']        = in_array( $in['locale'] ?? '', array( 'auto', 'en', 'tr' ), true ) ? $in['locale'] : 'auto';
	$out['preload']       = in_array( $in['preload'] ?? '', array( 'none', 'metadata', 'auto' ), true ) ? $in['preload'] : 'metadata';
	$out['sticky_corner'] = in_array( $in['sticky_corner'] ?? '', array( 'br', 'bl', 'tr', 'tl' ), true ) ? $in['sticky_corner'] : 'br';
	foreach ( array( 'pip', 'skip_buttons', 'sticky', 'replace_core_video', 'ads_enabled' ) as $k ) {
		$out[ $k ] = ! empty( $in[ $k ] );
	}
	foreach ( array( 'ad_preroll', 'ad_midroll', 'ad_postroll', 'ad_vmap' ) as $k ) {
		$out[ $k ] = esc_url_raw( trim( (string) ( $in[ $k ] ?? '' ) ) );
	}
	$out['ad_midroll_every'] = max( 0, absint( $in['ad_midroll_every'] ?? 0 ) );

	$advanced = trim( (string) wp_unslash( $in['advanced'] ?? '' ) );
	if ( '' !== $advanced && ! is_array( json_decode( $advanced, true ) ) ) {
		add_settings_error( HOPECOREPLAYER_OPTION, 'advanced', __( 'Advanced options must be a JSON object. The previous value was kept.', 'hopecoreplayer' ) );
		$advanced = hopecoreplayer_settings()['advanced'];
	}
	$out['advanced'] = $advanced;
	return $out;
}

function hopecoreplayer_admin_menu() {
	add_options_page(
		__( 'HopeCorePlayer', 'hopecoreplayer' ),
		__( 'HopeCorePlayer', 'hopecoreplayer' ),
		'manage_options',
		'hopecoreplayer',
		'hopecoreplayer_settings_page'
	);
}
add_action( 'admin_menu', 'hopecoreplayer_admin_menu' );

function hopecoreplayer_admin_init() {
	register_setting(
		'hopecoreplayer',
		HOPECOREPLAYER_OPTION,
		array(
			'type'              => 'array',
			'sanitize_callback' => 'hopecoreplayer_sanitize_settings',
			'default'           => hopecoreplayer_default_settings(),
		)
	);
}
add_action( 'admin_init', 'hopecoreplayer_admin_init' );

/** Small field helpers. */
function hopecoreplayer_field_name( $key ) {
	return HOPECOREPLAYER_OPTION . '[' . $key . ']';
}

function hopecoreplayer_checkbox( $s, $key, $label ) {
	printf(
		'<label><input type="checkbox" name="%1$s" value="1" %2$s> %3$s</label>',
		esc_attr( hopecoreplayer_field_name( $key ) ),
		checked( ! empty( $s[ $key ] ), true, false ),
		esc_html( $label )
	);
}

function hopecoreplayer_select( $s, $key, $choices ) {
	printf( '<select name="%s" id="hp-%s">', esc_attr( hopecoreplayer_field_name( $key ) ), esc_attr( $key ) );
	foreach ( $choices as $value => $label ) {
		printf( '<option value="%s" %s>%s</option>', esc_attr( $value ), selected( $s[ $key ], $value, false ), esc_html( $label ) );
	}
	echo '</select>';
}

function hopecoreplayer_url_field( $s, $key ) {
	printf(
		'<input type="url" class="large-text code" id="hp-%1$s" name="%2$s" value="%3$s" placeholder="https://">',
		esc_attr( $key ),
		esc_attr( hopecoreplayer_field_name( $key ) ),
		esc_attr( $s[ $key ] )
	);
}

function hopecoreplayer_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$s = hopecoreplayer_settings();
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'HopeCorePlayer', 'hopecoreplayer' ); ?></h1>
		<p><?php esc_html_e( 'Defaults for every player on the site. Each block can override them.', 'hopecoreplayer' ); ?></p>
		<?php settings_errors( HOPECOREPLAYER_OPTION ); ?>
		<form method="post" action="options.php">
			<?php settings_fields( 'hopecoreplayer' ); ?>

			<h2><?php esc_html_e( 'Appearance', 'hopecoreplayer' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="hp-theme"><?php esc_html_e( 'Theme', 'hopecoreplayer' ); ?></label></th>
					<td><?php hopecoreplayer_select( $s, 'theme', hopecoreplayer_theme_choices() ); ?></td>
				</tr>
				<tr>
					<th scope="row"><label for="hp-accent"><?php esc_html_e( 'Accent color', 'hopecoreplayer' ); ?></label></th>
					<td>
						<input type="text" id="hp-accent" name="<?php echo esc_attr( hopecoreplayer_field_name( 'accent' ) ); ?>" value="<?php echo esc_attr( $s['accent'] ); ?>" placeholder="#ffffff" pattern="#[0-9a-fA-F]{3,6}" class="regular-text code">
						<p class="description"><?php esc_html_e( 'Progress bar and active items. Empty: white.', 'hopecoreplayer' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="hp-locale"><?php esc_html_e( 'Player language', 'hopecoreplayer' ); ?></label></th>
					<td>
						<?php
						hopecoreplayer_select(
							$s,
							'locale',
							array(
								'auto' => __( 'Site language', 'hopecoreplayer' ),
								'en'   => 'English',
								'tr'   => 'Türkçe',
							)
						);
						?>
					</td>
				</tr>
			</table>

			<h2><?php esc_html_e( 'Playback', 'hopecoreplayer' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="hp-preload"><?php esc_html_e( 'Preload', 'hopecoreplayer' ); ?></label></th>
					<td>
						<?php
						hopecoreplayer_select(
							$s,
							'preload',
							array(
								'metadata' => __( 'Metadata only (recommended)', 'hopecoreplayer' ),
								'none'     => __( 'Nothing until play', 'hopecoreplayer' ),
								'auto'     => __( 'Let the browser decide', 'hopecoreplayer' ),
							)
						);
						?>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Controls', 'hopecoreplayer' ); ?></th>
					<td>
						<?php hopecoreplayer_checkbox( $s, 'pip', __( 'Picture-in-picture button', 'hopecoreplayer' ) ); ?><br>
						<?php hopecoreplayer_checkbox( $s, 'skip_buttons', __( '10 second back / forward buttons', 'hopecoreplayer' ) ); ?>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Sticky mini player', 'hopecoreplayer' ); ?></th>
					<td>
						<?php hopecoreplayer_checkbox( $s, 'sticky', __( 'Keep playing in a corner when the player scrolls out of view', 'hopecoreplayer' ) ); ?>
						<p>
							<label for="hp-sticky_corner"><?php esc_html_e( 'Corner', 'hopecoreplayer' ); ?></label>
							<?php
							hopecoreplayer_select(
								$s,
								'sticky_corner',
								array(
									'br' => __( 'Bottom right', 'hopecoreplayer' ),
									'bl' => __( 'Bottom left', 'hopecoreplayer' ),
									'tr' => __( 'Top right', 'hopecoreplayer' ),
									'tl' => __( 'Top left', 'hopecoreplayer' ),
								)
							);
							?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'WordPress video', 'hopecoreplayer' ); ?></th>
					<td>
						<?php hopecoreplayer_checkbox( $s, 'replace_core_video', __( 'Play the core Video block and the [video] shortcode with HopeCorePlayer', 'hopecoreplayer' ) ); ?>
						<p class="description"><?php esc_html_e( 'Existing posts are not changed; turning this off brings the default player back.', 'hopecoreplayer' ); ?></p>
					</td>
				</tr>
			</table>

			<h2><?php esc_html_e( 'Ads (VAST / VMAP)', 'hopecoreplayer' ); ?></h2>
			<p><?php esc_html_e( 'Ads are played with the Google IMA SDK, which is loaded from Google only on pages with a player that has ads.', 'hopecoreplayer' ); ?></p>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Enable ads', 'hopecoreplayer' ); ?></th>
					<td><?php hopecoreplayer_checkbox( $s, 'ads_enabled', __( 'Show these ads on every player (a block can turn them off or use its own tags)', 'hopecoreplayer' ) ); ?></td>
				</tr>
				<tr>
					<th scope="row"><label for="hp-ad_vmap"><?php esc_html_e( 'VMAP tag', 'hopecoreplayer' ); ?></label></th>
					<td>
						<?php hopecoreplayer_url_field( $s, 'ad_vmap' ); ?>
						<p class="description"><?php esc_html_e( 'A VMAP schedule replaces the three tags below.', 'hopecoreplayer' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="hp-ad_preroll"><?php esc_html_e( 'Pre-roll VAST tag', 'hopecoreplayer' ); ?></label></th>
					<td><?php hopecoreplayer_url_field( $s, 'ad_preroll' ); ?></td>
				</tr>
				<tr>
					<th scope="row"><label for="hp-ad_midroll"><?php esc_html_e( 'Mid-roll VAST tag', 'hopecoreplayer' ); ?></label></th>
					<td>
						<?php hopecoreplayer_url_field( $s, 'ad_midroll' ); ?>
						<p>
							<label for="hp-ad_midroll_every"><?php esc_html_e( 'Every', 'hopecoreplayer' ); ?></label>
							<input type="number" min="0" step="1" id="hp-ad_midroll_every" name="<?php echo esc_attr( hopecoreplayer_field_name( 'ad_midroll_every' ) ); ?>" value="<?php echo esc_attr( $s['ad_midroll_every'] ); ?>" class="small-text">
							<?php esc_html_e( 'seconds (0 = once in the middle)', 'hopecoreplayer' ); ?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="hp-ad_postroll"><?php esc_html_e( 'Post-roll VAST tag', 'hopecoreplayer' ); ?></label></th>
					<td><?php hopecoreplayer_url_field( $s, 'ad_postroll' ); ?></td>
				</tr>
			</table>

			<h2><?php esc_html_e( 'Advanced', 'hopecoreplayer' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="hp-advanced"><?php esc_html_e( 'Extra player options (JSON)', 'hopecoreplayer' ); ?></label></th>
					<td>
						<textarea id="hp-advanced" name="<?php echo esc_attr( hopecoreplayer_field_name( 'advanced' ) ); ?>" rows="8" class="large-text code" placeholder='{ "playbackRates": [0.75, 1, 1.5, 2] }'><?php echo esc_textarea( $s['advanced'] ); ?></textarea>
						<p class="description">
							<?php
							printf(
								/* translators: %s: link to the options documentation */
								esc_html__( 'Any player option, applied to every player. See the %s.', 'hopecoreplayer' ),
								'<a href="https://umutyaldiz.com/hopecoreplayer" target="_blank" rel="noopener">' . esc_html__( 'documentation', 'hopecoreplayer' ) . '</a>'
							);
							?>
						</p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}
