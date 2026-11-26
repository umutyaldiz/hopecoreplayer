<?php
/**
 * Removes the plugin's settings when it is deleted (posts keep their blocks).
 *
 * @package HopeCorePlayer
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'hopecoreplayer_settings' );
