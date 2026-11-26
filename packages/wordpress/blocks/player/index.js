/* HopeCorePlayer block editor — plain JS (no build step), WordPress globals only. */
( function ( wp ) {
	const { registerBlockType } = wp.blocks;
	const { createElement: el, Fragment, useEffect, useRef, useState } = wp.element;
	const { __ } = wp.i18n;
	const { InspectorControls, MediaPlaceholder, MediaUpload, MediaUploadCheck, BlockControls, useBlockProps } = wp.blockEditor;
	const {
		PanelBody,
		TextControl,
		TextareaControl,
		ToggleControl,
		SelectControl,
		Button,
		ToolbarGroup,
		ToolbarButton,
		Notice,
		Spinner,
		BaseControl,
		ColorPalette,
	} = wp.components;
	const apiFetch = wp.apiFetch;
	const config = window.hopecoreplayerEditor || {};

	const THEMES = [
		{ label: __( 'Site default', 'hopecoreplayer' ), value: '' },
		{ label: __( 'Glass dark', 'hopecoreplayer' ), value: 'glass-dark' },
		{ label: __( 'Glass light', 'hopecoreplayer' ), value: 'glass-light' },
		{ label: __( 'Neo dark', 'hopecoreplayer' ), value: 'neo-dark' },
		{ label: __( 'Mono', 'hopecoreplayer' ), value: 'mono' },
	];
	const RATIOS = [
		{ label: '16:9', value: '' },
		{ label: '21:9', value: '21:9' },
		{ label: '4:3', value: '4:3' },
		{ label: '1:1', value: '1:1' },
		{ label: '9:16', value: '9:16' },
	];

	/** "1:23" / "01:02:03" / "83" → seconds. */
	const toSeconds = ( text ) => {
		const parts = String( text ).trim().split( ':' ).map( Number );
		if ( parts.some( isNaN ) ) return 0;
		return parts.reduce( ( acc, n ) => acc * 60 + n, 0 );
	};
	const toClock = ( sec ) => {
		const s = Math.max( 0, Math.round( Number( sec ) || 0 ) );
		const h = Math.floor( s / 3600 );
		const m = Math.floor( ( s % 3600 ) / 60 );
		const r = String( s % 60 ).padStart( 2, '0' );
		return h ? `${ h }:${ String( m ).padStart( 2, '0' ) }:${ r }` : `${ m }:${ r }`;
	};

	/** Relative URLs → absolute: the editor iframe can have a blob: base (WordPress 6.5–6.x). */
	const absolute = ( value ) => {
		if ( typeof value === 'string' ) return /^\/(?!\/)|^\.\.?\//.test( value ) ? new URL( value, window.location.href ).href : value;
		if ( Array.isArray( value ) ) return value.map( absolute );
		if ( value && typeof value === 'object' ) return Object.fromEntries( Object.entries( value ).map( ( [ k, v ] ) => [ k, absolute( v ) ] ) );
		return value;
	};

	/** Editable list of rows (qualities, subtitles, chapters, playlist). */
	function Rows( { rows, onChange, fields, addLabel, empty } ) {
		const set = ( i, key, value ) => onChange( rows.map( ( r, j ) => ( j === i ? { ...r, [ key ]: value } : r ) ) );
		const blank = Object.fromEntries( fields.map( ( f ) => [ f.key, f.type === 'bool' ? false : '' ] ) );
		return el(
			'div',
			{ className: 'hopecoreplayer-rows' },
			rows.length ? null : el( 'p', { className: 'components-base-control__help' }, empty ),
			rows.map( ( row, i ) =>
				el(
					'div',
					{ key: i, className: 'hopecoreplayer-row' },
					fields.map( ( f ) => {
						if ( f.type === 'bool' ) {
							return el( ToggleControl, {
								key: f.key,
								label: f.label,
								checked: !! row[ f.key ],
								onChange: ( v ) => set( i, f.key, v ),
								__nextHasNoMarginBottom: true,
							} );
						}
						if ( f.type === 'time' ) {
							return el( TextControl, {
								key: f.key,
								label: f.label,
								value: row[ f.key ] === '' || row[ f.key ] === undefined ? '' : toClock( row[ f.key ] ),
								placeholder: '0:00',
								onChange: ( v ) => set( i, f.key, v === '' ? '' : toSeconds( v ) ),
								__nextHasNoMarginBottom: true,
							} );
						}
						const input = el( TextControl, {
							key: f.key,
							label: f.label,
							value: row[ f.key ] || '',
							type: f.type === 'url' ? 'url' : 'text',
							placeholder: f.placeholder,
							onChange: ( v ) => set( i, f.key, v ),
							__nextHasNoMarginBottom: true,
						} );
						if ( ! f.upload ) return input;
						return el(
							'div',
							{ key: f.key, className: 'hopecoreplayer-upload-row' },
							input,
							el(
								MediaUploadCheck,
								null,
								el( MediaUpload, {
									allowedTypes: f.upload,
									onSelect: ( m ) => set( i, f.key, m.url ),
									render: ( { open } ) => el( Button, { variant: 'secondary', size: 'small', onClick: open }, __( 'Media library', 'hopecoreplayer' ) ),
								} )
							)
						);
					} ),
					el(
						Button,
						{ isDestructive: true, variant: 'link', onClick: () => onChange( rows.filter( ( _, j ) => j !== i ) ) },
						__( 'Remove', 'hopecoreplayer' )
					)
				)
			),
			el( Button, { variant: 'secondary', onClick: () => onChange( [ ...rows, blank ] ) }, addLabel )
		);
	}

	/** Real player preview inside the editor iframe, with the options the site will print. */
	function Preview( { attributes } ) {
		const ref = useRef( null );
		const [ state, setState ] = useState( 'loading' );
		const key = JSON.stringify( attributes );

		useEffect( () => {
			let cancelled = false;
			const timer = setTimeout( () => {
				apiFetch( {
					path: '/wp/v2/block-renderer/hopecoreplayer/player?context=edit',
					method: 'POST',
					data: { attributes },
				} )
					.then( ( res ) => {
						if ( cancelled || ! ref.current ) return;
						const doc = ref.current.ownerDocument;
						const tmp = doc.createElement( 'div' );
						tmp.innerHTML = res.rendered || '';
						const rendered = tmp.querySelector( 'hope-player' );
						const json = rendered?.getAttribute( 'data-hp-options' );
						if ( ! json ) return setState( 'empty' );
						const options = absolute( JSON.parse( json ) );
						// Preview stays quiet and still: no autoplay, no sticky, no ads.
						delete options.autoplay;
						delete options.sticky;
						delete options.ads;
						if ( ! doc.querySelector( 'script[data-hopecoreplayer]' ) ) {
							const s = doc.createElement( 'script' );
							s.type = 'module';
							s.src = config.playerUrl;
							s.setAttribute( 'data-hopecoreplayer', '' );
							doc.head.appendChild( s );
						}
						let player = ref.current.querySelector( 'hope-player' );
						if ( ! player ) {
							player = doc.createElement( 'hope-player' );
							ref.current.appendChild( player );
						}
						// Accent color / aspect ratio (CSS variables from the server markup).
						player.setAttribute( 'style', rendered.getAttribute( 'style' ) || '' );
						const view = doc.defaultView;
						view.customElements.whenDefined( 'hope-player' ).then( () => {
							if ( ! cancelled ) player.options = options;
						} );
						setState( 'ready' );
					} )
					.catch( () => ! cancelled && setState( 'error' ) );
			}, 350 );
			return () => {
				cancelled = true;
				clearTimeout( timer );
			};
		}, [ key ] );

		return el(
			'div',
			{ className: 'hopecoreplayer-preview' },
			state === 'loading' ? el( 'div', { className: 'hopecoreplayer-preview-wait' }, el( Spinner ) ) : null,
			state === 'error' ? el( Notice, { status: 'error', isDismissible: false }, __( 'Preview could not be loaded.', 'hopecoreplayer' ) ) : null,
			el( 'div', { ref, className: 'hopecoreplayer-preview-player' } )
		);
	}

	function Edit( { attributes: a, setAttributes: set } ) {
		const blockProps = useBlockProps( { className: 'hopecoreplayer-wrap' } );
		const [ url, setUrl ] = useState( '' );
		const hasMedia = !! ( a.src || a.mediaId || ( a.playlist && a.playlist.length ) );
		let jsonError = '';
		if ( a.advanced.trim() ) {
			try {
				const parsed = JSON.parse( a.advanced );
				if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) jsonError = __( 'Must be a JSON object.', 'hopecoreplayer' );
			} catch ( e ) {
				jsonError = e.message;
			}
		}

		const onMedia = ( m ) =>
			set( {
				mediaId: m.id,
				src: m.url,
				audio: m.type === 'audio' || /^audio\//.test( m.mime || '' ),
				title: a.title || m.title || '',
				artist: a.artist || ( m.meta && m.meta.artist ) || '',
			} );

		const placeholder = el(
			'div',
			null,
			el( MediaPlaceholder, {
				icon: 'video-alt3',
				labels: {
					title: __( 'HopeCorePlayer', 'hopecoreplayer' ),
					instructions: __( 'Upload or pick a video / audio file, or paste a link (MP4, HLS .m3u8, DASH .mpd).', 'hopecoreplayer' ),
				},
				accept: 'video/*,audio/*',
				allowedTypes: [ 'video', 'audio' ],
				onSelect: onMedia,
				onSelectURL: ( link ) => set( { src: link, mediaId: undefined, audio: /\.(mp3|m4a|aac|ogg|oga|wav|flac)(\?|$)/i.test( link ) } ),
			} )
		);

		const inspector = el(
			InspectorControls,
			null,
			el(
				PanelBody,
				{ title: __( 'Media', 'hopecoreplayer' ) },
				el( TextControl, {
					label: __( 'File or stream URL', 'hopecoreplayer' ),
					value: a.src,
					type: 'url',
					onChange: ( v ) => set( { src: v, mediaId: undefined } ),
					help: __( 'MP4 / WebM / MP3, HLS (.m3u8) or DASH (.mpd).', 'hopecoreplayer' ),
				} ),
				el( SelectControl, {
					label: __( 'Format', 'hopecoreplayer' ),
					value: a.format,
					options: [
						{ label: __( 'Detect from the link', 'hopecoreplayer' ), value: 'auto' },
						{ label: 'MP4 / WebM / audio', value: 'mp4' },
						{ label: 'HLS', value: 'hls' },
						{ label: 'DASH', value: 'dash' },
					],
					onChange: ( v ) => set( { format: v } ),
				} ),
				el( ToggleControl, {
					label: __( 'Audio player', 'hopecoreplayer' ),
					help: __( 'Cover, title and artist instead of a video frame.', 'hopecoreplayer' ),
					checked: a.audio,
					onChange: ( v ) => set( { audio: v } ),
				} ),
				el( TextControl, { label: __( 'Title', 'hopecoreplayer' ), value: a.title, onChange: ( v ) => set( { title: v } ) } ),
				a.audio ? el( TextControl, { label: __( 'Artist', 'hopecoreplayer' ), value: a.artist, onChange: ( v ) => set( { artist: v } ) } ) : null,
				el(
					MediaUploadCheck,
					null,
					el( MediaUpload, {
						allowedTypes: [ 'image' ],
						value: a.posterId,
						onSelect: ( m ) => set( { poster: m.url, posterId: m.id } ),
						render: ( { open } ) =>
							el(
								'div',
								{ className: 'hopecoreplayer-poster' },
								a.poster ? el( 'img', { src: a.poster, alt: '' } ) : null,
								el( Button, { variant: 'secondary', onClick: open }, a.poster ? __( 'Replace poster', 'hopecoreplayer' ) : __( 'Set poster image', 'hopecoreplayer' ) ),
								a.poster ? el( Button, { variant: 'link', isDestructive: true, onClick: () => set( { poster: '', posterId: undefined } ) }, __( 'Remove', 'hopecoreplayer' ) ) : null
							),
					} )
				)
			),
			el(
				PanelBody,
				{ title: __( 'Playback', 'hopecoreplayer' ), initialOpen: false },
				el( ToggleControl, {
					label: __( 'Autoplay', 'hopecoreplayer' ),
					help: __( 'Starts muted — browsers block autoplay with sound.', 'hopecoreplayer' ),
					checked: a.autoplay,
					onChange: ( v ) => set( { autoplay: v } ),
				} ),
				el( ToggleControl, { label: __( 'Muted', 'hopecoreplayer' ), checked: a.muted, onChange: ( v ) => set( { muted: v } ) } ),
				el( ToggleControl, { label: __( 'Loop', 'hopecoreplayer' ), checked: a.loop, onChange: ( v ) => set( { loop: v } ) } ),
				el( SelectControl, { label: __( 'Theme', 'hopecoreplayer' ), value: a.theme, options: THEMES, onChange: ( v ) => set( { theme: v } ) } ),
				el(
					BaseControl,
					{ label: __( 'Accent color', 'hopecoreplayer' ), help: __( 'Progress bar and active items. Empty: site default.', 'hopecoreplayer' ), __nextHasNoMarginBottom: true },
					el( ColorPalette, { value: a.accent || undefined, onChange: ( v ) => set( { accent: v || '' } ), disableCustomColors: false, clearable: true } )
				),
				a.audio ? null : el( SelectControl, { label: __( 'Aspect ratio', 'hopecoreplayer' ), value: a.aspectRatio, options: RATIOS, onChange: ( v ) => set( { aspectRatio: v } ) } ),
				el( SelectControl, {
					label: __( 'Sticky mini player', 'hopecoreplayer' ),
					value: a.sticky,
					options: [
						{ label: __( 'Site default', 'hopecoreplayer' ), value: 'default' },
						{ label: __( 'On', 'hopecoreplayer' ), value: 'on' },
						{ label: __( 'Off', 'hopecoreplayer' ), value: 'off' },
					],
					onChange: ( v ) => set( { sticky: v } ),
				} )
			),
			el(
				PanelBody,
				{ title: __( 'Qualities', 'hopecoreplayer' ), initialOpen: false },
				el( Rows, {
					rows: a.sources,
					onChange: ( v ) => set( { sources: v } ),
					addLabel: __( 'Add quality', 'hopecoreplayer' ),
					empty: __( 'Extra MP4 files for the quality menu (e.g. 1080p, 720p). HLS / DASH streams list their own qualities.', 'hopecoreplayer' ),
					fields: [
						{ key: 'src', label: __( 'File URL', 'hopecoreplayer' ), type: 'url', upload: [ 'video' ] },
						{ key: 'label', label: __( 'Label', 'hopecoreplayer' ), placeholder: '720p' },
					],
				} )
			),
			el(
				PanelBody,
				{ title: __( 'Subtitles', 'hopecoreplayer' ), initialOpen: false },
				el( Rows, {
					rows: a.subtitles,
					onChange: ( v ) => set( { subtitles: v } ),
					addLabel: __( 'Add subtitles', 'hopecoreplayer' ),
					empty: __( 'WebVTT (.vtt) files.', 'hopecoreplayer' ),
					fields: [
						{ key: 'src', label: __( 'VTT file URL', 'hopecoreplayer' ), type: 'url', upload: [ 'text/vtt' ] },
						{ key: 'label', label: __( 'Label', 'hopecoreplayer' ), placeholder: 'English' },
						{ key: 'srclang', label: __( 'Language code', 'hopecoreplayer' ), placeholder: 'en' },
						{ key: 'default', label: __( 'On by default', 'hopecoreplayer' ), type: 'bool' },
					],
				} )
			),
			el(
				PanelBody,
				{ title: __( 'Chapters', 'hopecoreplayer' ), initialOpen: false },
				el( Rows, {
					rows: a.chapters,
					onChange: ( v ) => set( { chapters: v } ),
					addLabel: __( 'Add chapter', 'hopecoreplayer' ),
					empty: __( 'Splits the progress bar; each chapter ends where the next one starts.', 'hopecoreplayer' ),
					fields: [
						{ key: 'start', label: __( 'Starts at', 'hopecoreplayer' ), type: 'time' },
						{ key: 'text', label: __( 'Title', 'hopecoreplayer' ) },
					],
				} )
			),
			el(
				PanelBody,
				{ title: __( 'Playlist', 'hopecoreplayer' ), initialOpen: false },
				el( Rows, {
					rows: a.playlist,
					onChange: ( v ) => set( { playlist: v } ),
					addLabel: __( 'Add video', 'hopecoreplayer' ),
					empty: __( 'Videos played one after another, with a list next to the player.', 'hopecoreplayer' ),
					fields: [
						{ key: 'src', label: __( 'File or stream URL', 'hopecoreplayer' ), type: 'url', upload: [ 'video', 'audio' ] },
						{ key: 'title', label: __( 'Title', 'hopecoreplayer' ) },
						{ key: 'image', label: __( 'Thumbnail URL', 'hopecoreplayer' ), type: 'url', upload: [ 'image' ] },
					],
				} )
			),
			el(
				PanelBody,
				{ title: __( 'Ads', 'hopecoreplayer' ), initialOpen: false },
				el( SelectControl, {
					label: __( 'Ads', 'hopecoreplayer' ),
					value: a.ads,
					options: [
						{ label: __( 'Site default', 'hopecoreplayer' ), value: 'default' },
						{ label: __( 'No ads', 'hopecoreplayer' ), value: 'off' },
						{ label: __( 'Own ad tag', 'hopecoreplayer' ), value: 'custom' },
					],
					onChange: ( v ) => set( { ads: v } ),
				} ),
				a.ads === 'custom'
					? el(
							Fragment,
							null,
							el( TextControl, { label: __( 'Pre-roll VAST tag', 'hopecoreplayer' ), type: 'url', value: a.adPreroll, onChange: ( v ) => set( { adPreroll: v } ) } ),
							el( TextControl, {
								label: __( 'or VMAP tag', 'hopecoreplayer' ),
								type: 'url',
								value: a.adVmap,
								onChange: ( v ) => set( { adVmap: v } ),
								help: __( 'A VMAP schedule replaces the pre-roll tag.', 'hopecoreplayer' ),
							} )
					  )
					: null,
				config.settings
					? el( 'p', null, el( 'a', { href: config.settings, target: '_blank', rel: 'noopener' }, __( 'Site-wide ad settings', 'hopecoreplayer' ) ) )
					: null
			),
			el(
				PanelBody,
				{ title: __( 'Advanced', 'hopecoreplayer' ), initialOpen: false },
				el( TextareaControl, {
					label: __( 'Extra player options (JSON)', 'hopecoreplayer' ),
					value: a.advanced,
					rows: 8,
					className: 'hopecoreplayer-code',
					placeholder: '{ "heatmap": [3, 8, 5, 2] }',
					help: jsonError || __( 'Any player option, e.g. playbackRates, skipSegments, heatmap, share, watermark.', 'hopecoreplayer' ),
					onChange: ( v ) => set( { advanced: v } ),
				} ),
				jsonError ? el( Notice, { status: 'warning', isDismissible: false }, __( 'Invalid JSON — it will be ignored.', 'hopecoreplayer' ) ) : null
			)
		);

		const toolbar = hasMedia
			? el(
					BlockControls,
					null,
					el(
						ToolbarGroup,
						null,
						el(
							MediaUploadCheck,
							null,
							el( MediaUpload, {
								allowedTypes: [ 'video', 'audio' ],
								value: a.mediaId,
								onSelect: onMedia,
								render: ( { open } ) => el( ToolbarButton, { onClick: open }, __( 'Replace', 'hopecoreplayer' ) ),
							} )
						)
					)
			  )
			: null;

		return el( 'div', blockProps, toolbar, inspector, hasMedia ? el( Preview, { attributes: a } ) : placeholder );
	}

	registerBlockType( 'hopecoreplayer/player', {
		edit: Edit,
		save: () => null,
	} );
} )( window.wp );
