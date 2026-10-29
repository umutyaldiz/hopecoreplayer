import tailwindCss from './theme/tailwind.css?inline';
import type { AdsOptions, HopePlayerOptions } from './types';
import { SourceManager, type HlsQualityLevel, type PlaybackEngineInfo } from './hls/SourceManager';
import { ControlBar } from './controls/ControlBar';
import { TooltipController } from './controls/Tooltip';
import { KeyboardController } from './keyboard/KeyboardController';
import { LoadingSpinner } from './screens/LoadingSpinner';
import { ErrorScreen } from './screens/ErrorScreen';
import { attachSubtitleTracks, clearSubtitleTracks, selectSubtitleTrack, type AttachedTrack } from './subtitles/attachTracks';
import { CaptionRenderer, type CaptionFontSize } from './subtitles/CaptionRenderer';
import { MiniProgress } from './controls/MiniProgress';
import { SeekFeedback } from './controls/SeekFeedback';
import type { SettingsCaptionAppearance, SettingsColorOption } from './controls/SettingsMenu';
import { createIcon } from './icons/Icon';
import { injectIconFont } from './icons/injectIconFont';
import type { AdsController, AdsPlayerContext } from './plugins/ads';
import type { GestureControls } from './plugins/gesture';
import type { LoopSection } from './plugins/loop-section';
import type { InViewAutoplay } from './plugins/in-view-autoplay';
import type { StickyUnregister } from './plugins/sticky';
import type { PlaylistRunner } from './plugins/playlist';
import type { HopeStory } from './plugins/story';
import type { MarkProgress } from './plugins/markers';
import type { Segments } from './plugins/segments';
import type { SpriteThumbnails } from './plugins/sprite-thumbnails';
import type { CountdownScreen } from './plugins/countdown-screen';
import type { GeoChecker } from './plugins/geo-checker';
import type { RedirectScreen } from './plugins/redirect-screen';
import type { QrResume } from './plugins/qr-resume';
import type { PauseAd } from './plugins/pause-ad';
import type { Dubbing } from './plugins/dubbing';
import type { LiveWallClock } from './plugins/live';
import type { DaiController } from './plugins/dai';
import { createLocaleStrings, applyLocale } from './i18n';
import type { HopeLocaleStrings } from './i18n/types';

const DEFAULT_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** options.autoHideDelayMs verilmezse kullanılan varsayılan. */
const DEFAULT_AUTO_HIDE_DELAY_MS = 1200;
/** Basış ile kalkış arasındaki imleç/parmak hareketi bu eşiği aşarsa "tık" değil sürükleme sayılır — toggle tetiklenmez. */
const TAP_MAX_MOVE_PX = 10;
/** options.skipButtons'ta süre verilmezse. */
const DEFAULT_SKIP_SECONDS = 10;
/** options.keyboardSeekStep verilmezse ←/→ ve J/L ile sarma süresi (sn). */
const DEFAULT_KEYBOARD_SEEK_STEP = 5;

const TEMPLATE = /* html */ `
  <div class="video-area">
    <div class="media-layer">
      <video part="video" playsinline webkit-playsinline preload="metadata"></video>
      <div part="ad-layer" class="hp:absolute hp:inset-0 hp:z-10 hp:hidden"></div>
    </div>
  </div>
`;

/** <hope-player> — çekirdek oynatma ve kontroller; plugin'ler ilgili option verilince dinamik import edilir. */
export class HopePlayerElement extends HTMLElement {
    static get observedAttributes(): string[] {
        return ['src', 'poster', 'autoplay', 'muted', 'loop', 'theme', 'locale'];
    }

    private readonly root: ShadowRoot;
    private readonly videoArea: HTMLDivElement;
    private readonly videoEl: HTMLVideoElement;
    private readonly adLayerEl: HTMLDivElement;
    private readonly chromeEl: HTMLDivElement;
    private readonly centerPlayButton: HTMLButtonElement;
    private readonly captionRenderer: CaptionRenderer;
    /** options.miniProgress açıkken kurulur. */
    private miniProgress: MiniProgress | null = null;
    private chromeVisible = true;

    private readonly sourceManager: SourceManager;
    private readonly controlBar: ControlBar;
    private readonly tooltip: TooltipController;
    private readonly keyboard: KeyboardController;
    private readonly loadingSpinner: LoadingSpinner;
    private readonly errorScreen: ErrorScreen;
    /** İleri/geri sarmada sağda/solda beliren anlık bildirim. */
    private readonly seekFeedback: SeekFeedback;
    private adsController: AdsController | null = null;
    private gestureControls: GestureControls | null = null;
    private loopSection: LoopSection | null = null;
    private inViewAutoplay: InViewAutoplay | null = null;
    private unregisterSticky: StickyUnregister | null = null;
    private playlistRunner: PlaylistRunner | null = null;
    private hopeStory: HopeStory | null = null;
    private markProgress: MarkProgress | null = null;
    private segments: Segments | null = null;
    private spriteThumbnails: SpriteThumbnails | null = null;
    private countdownScreen: CountdownScreen | null = null;
    private geoChecker: GeoChecker | null = null;
    private redirectScreen: RedirectScreen | null = null;
    private qrResume: QrResume | null = null;
    private pauseAd: PauseAd | null = null;
    private dubbing: Dubbing | null = null;
    private liveWallClock: LiveWallClock | null = null;
    private daiController: DaiController | null = null;
    private readonly instanceKey: string;

    private subtitleTracks: AttachedTrack[] = [];
    /** Altyazı seçiminin tek giriş noktası — iOS native tam ekrandan dönüşte de kullanılır. */
    private selectCaption: ((label: string | null) => void) | null = null;
    /** `applyOptions()`'ta aktif bir altyazı track'i seçiliyken `true` — dil değişince Boyut/Konum görünümünü tazelemek için. */
    private captionTrackActive = false;
    /**
     * countdownScreen varken gerçek init (kaynak + içerik plugin'leri) ertelenir; en güncel options snapshot'ı.
     * onComplete kaydı tek sefer yapılır (bkz. playbackInitRegistered) — init birden fazla kez tetiklenmesin.
     */
    private pendingPlaybackOptions: HopePlayerOptions | null = null;
    private playbackInitRegistered = false;
    /**
     * countdownScreen gibi alanlar yalnızca .options ile gelir. connectedCallback'teki ilk (options'suz) geçiş chrome'u
     * bir an açıp player'ı gösteriyordu; 'boot' bloklayıcısı gerçek options gelene kadar bekletir.
     */
    private bootResolved = false;
    private bootGraceTimer: ReturnType<typeof setTimeout> | null = null;
    private _options: HopePlayerOptions = {};
    private hideTimer: ReturnType<typeof setTimeout> | null = null;
    /** Fare kontrollerin (buton/seek bar) üzerinde mi — üzerindeyken otomatik gizlenmez; videonun üstünde hareketsizse gizlenir. */
    private pointerOverControls = false;
    /** Kalite menüsünde şu an HLS seviyeleri mi var (kaynak değişince temizlemek için). */
    private hlsQualitiesShown = false;
    /** Son uygulanan options.showRemainingTime — bkz. applyOptions. */
    private appliedShowRemaining: boolean | undefined;
    private autoHideDelayMs = DEFAULT_AUTO_HIDE_DELAY_MS;
    private tapCandidate = false;
    private tapStartX = 0;
    private tapStartY = 0;
    /** Tüm UI'ın paylaştığı tek, mutable sözlük — dil değişince referans değil alanlar güncellenir. */
    private readonly i18n: HopeLocaleStrings = createLocaleStrings('tr');
    /** IMA SDK'nın kendi ad-UI dili (skip butonu/sayaç metni) de aynı dili takip etsin diye — bkz. plugins/ads/AdsController. */
    private localeCode = 'tr';

    constructor() {
        super();
        injectIconFont();
        this.root = this.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = tailwindCss;
        this.root.appendChild(style);

        const wrapper = document.createElement('div');
        // Tam ekranda yüksekliği zincirlemek için sınıflı (tailwind.css `:host(:fullscreen) .hp-root`).
        wrapper.className = 'hp-root';
        wrapper.innerHTML = TEMPLATE;
        this.root.appendChild(wrapper);

        this.videoArea = this.root.querySelector('.video-area')!;
        this.videoEl = this.root.querySelector('video')!;
        this.adLayerEl = this.root.querySelector('[part="ad-layer"]')!;
        this.instanceKey = `hp-${Math.random().toString(36).slice(2, 10)}`;

        this.loadingSpinner = new LoadingSpinner(this.videoEl);
        this.root.querySelector('.media-layer')!.appendChild(this.loadingSpinner.el);

        this.errorScreen = new ErrorScreen(this.videoEl, this.i18n);
        this.errorScreen.setOnRetry(() => void this.sourceManager.reload());
        // Chrome'un (z-20) üstünde — merkez play butonu ve kontroller hata ekranına binmesin.
        this.videoArea.appendChild(this.errorScreen.el);

        this.centerPlayButton = document.createElement('button');
        this.centerPlayButton.type = 'button';
        this.centerPlayButton.setAttribute('part', 'center-play-button');
        this.centerPlayButton.setAttribute('aria-label', this.i18n.play);
        // Tıklama alanı tüm video alanı; görsel olarak yalnızca ortadaki yuvarlak buton.
        this.centerPlayButton.className =
            'hp-center-play hp:absolute hp:inset-0 hp:flex hp:items-center hp:justify-center hp:bg-transparent hp:border-0 hp:cursor-pointer hp:text-on-surface hp:transition-opacity';
        const centerChip = document.createElement('span');
        centerChip.className = 'hp-chip hp:flex hp:items-center hp:justify-center hp:w-16 hp:h-16';
        // .hp-chip'in kendi --hp-chip-radius'u rounded-full utility'sini ezer
        // (bkz. VolumePanel'deki aynı not) — tam daire için inline override.
        centerChip.style.borderRadius = '9999px';
        centerChip.appendChild(createIcon('play', 'hp:text-2xl'));
        this.centerPlayButton.appendChild(centerChip);
        this.centerPlayButton.addEventListener('click', () => {
            if (this.videoEl.paused) void this.videoEl.play();
        });
        this.videoArea.appendChild(this.centerPlayButton);

        this.chromeEl = document.createElement('div');
        // pointer-events-none: tüm video alanını kaplıyor; açık olsaydı alttaki video/reklam tıklamalarını yutardı.
        this.chromeEl.className = 'hp-chrome hp:absolute hp:inset-0 hp:z-20 hp:pointer-events-none';
        this.videoArea.appendChild(this.chromeEl);

        this.sourceManager = new SourceManager(this.videoEl, this.onHlsLevelsChanged);
        this.errorScreen.setShouldShow(() => !this.sourceManager.isRecovering());

        this.controlBar = new ControlBar(
            this.videoEl,
            DEFAULT_PLAYBACK_RATES,
            {
                onRequestFullscreen: () => this.requestFullscreenCompat(),
                onExitFullscreen: () => this.exitFullscreenCompat(),
                isFullscreen: () => this.isFullscreenActive(),
                // adsController sonradan kurulur — closure'lar her çağrıda güncel this.adsController'ı okur.
                isAdActive: () => this.isAdPlaying(),
                adTogglePlay: () => this.adsController?.toggleAdPlayPause(),
                adIsPaused: () => this.adsController?.isAdPaused() ?? true,
                adVolume: {
                    isAdActive: () => this.isAdPlaying(),
                    getVolume: () => this.adsController?.getAdVolume() ?? 1,
                    setVolume: (v) => this.adsController?.setAdVolume(v),
                    toggleMute: () => this.adsController?.toggleAdMute(),
                },
            },
            this.i18n
        );
        this.chromeEl.appendChild(this.controlBar.el);
        // Kompakt (küçük player) düzende sağ grubun taşındığı üst bar — chrome'la birlikte otomatik gizlenir.
        this.chromeEl.appendChild(this.controlBar.topEl);
        // "Sesi aç" rozeti chrome'un DIŞINDA: kontroller gizlense de sessiz videoda görünür kalmalı.
        this.videoArea.appendChild(this.controlBar.volumePanel.unmuteBadge);

        // z-index: video < caption(5) < ad-layer(10) < chrome(20) — reklam altyazıyı kendiliğinden örter.
        this.captionRenderer = new CaptionRenderer(this.videoEl, this.videoArea, this.controlBar.seekBar.el, this.i18n);
        this.videoArea.appendChild(this.captionRenderer.layerEl);

        this.keyboard = new KeyboardController(this, this.videoEl, () =>
            this.isFullscreenActive() ? this.exitFullscreenCompat() : this.requestFullscreenCompat()
        );

        // Tek bir delegasyon dinleyicisi, TÜM butonlar için (bkz. Tooltip.ts'teki
        // mimari not) — videoArea zaten position:relative (bkz. tailwind.css),
        // bu yüzden tooltip'in konum hesaplaması bu kapsayıcıya göre doğru çalışır.
        this.tooltip = new TooltipController(this.videoArea);

        this.seekFeedback = new SeekFeedback(this.i18n);
        this.videoArea.appendChild(this.seekFeedback.el);
        this.controlBar.onSkip = (delta) => this.seekFeedback.show(delta);
        this.keyboard.onSeek = (delta) => this.seekFeedback.show(delta);
        this.controlBar.seekBar.onKeyboardSeek = (delta) => this.seekFeedback.show(delta);

        // 'boot': gerçek `.options` (ör. countdownScreen) gelene kadar chrome
        // HİÇ görünmesin diye — bkz. `bootResolved` alanındaki mimari not.
        this.blockChrome('boot');
    }

    connectedCallback(): void {
        // tabIndex constructor'da değil burada: tabindex attribute'una yansır ve Custom Elements spec'i
        // constructor'da attribute eklemeyi yasaklar (createElement "must not have attributes" hatası).
        this.tabIndex = this.tabIndex || 0;

        this.syncFromAttributes();

        // Yalnızca HTML attribute'larıyla kullanım için güvenlik ağı — .options set edilirse bu zamanlayıcı iptal edilir.
        if (!this.bootResolved) {
            this.bootGraceTimer = setTimeout(() => {
                this.bootGraceTimer = null;
                if (!this.bootResolved) {
                    this.bootResolved = true;
                    this.syncFromAttributes();
                }
            }, 80);
        }

        this.videoEl.addEventListener('play', this.onPlay);
        this.videoEl.addEventListener('pause', this.onPause);
        this.addEventListener('pointermove', this.onPointerMove);
        this.addEventListener('pointerleave', this.onPointerLeave);
        this.addEventListener('pointerdown', this.onPointerDownFocus);
        document.addEventListener('fullscreenchange', this.onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);
        // iPhone video tam ekranı (webkitEnterFullscreen) kendi olaylarını yayınlar.
        this.videoEl.addEventListener('webkitbeginfullscreen', this.onFullscreenChange);
        this.videoEl.addEventListener('webkitendfullscreen', this.onFullscreenChange);
        // Ayarlar menüsü açıkken kontroller gizlenmesin (mobilde menü de onlarla kayboluyordu).
        this.controlBar.settingsMenu.onOpenChange = (open) => {
            if (open && this.hideTimer) clearTimeout(this.hideTimer);
            if (!open) this.scheduleAutoHide();
            this.tooltip.recheckOcclusion();
        };
        // Açık menüyle çakışan tooltip menünün "altında" kalır (gösterilmez).
        this.tooltip.setOcclusionCheck((r) => {
            const p = this.controlBar.settingsMenu.panelRect;
            return !!p && r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top;
        });

        // "Ekrana dokun → oynat/duraklat": doğrudan videoEl'e bağlı, kontrol çubuğu tıklamaları tetiklemez.
        this.videoEl.addEventListener('mousedown', this.onVideoPressStart);
        this.videoEl.addEventListener('mouseup', this.onVideoPressEnd);
        this.videoEl.addEventListener('mouseleave', this.onVideoPressCancel);
        this.videoEl.addEventListener('touchstart', this.onVideoPressStart, { passive: true });
        this.videoEl.addEventListener('touchend', this.onVideoPressEnd);
        this.videoEl.addEventListener('touchcancel', this.onVideoPressCancel);

        this.dispatchEvent(new CustomEvent('hp:ready'));
    }

    disconnectedCallback(): void {
        this.miniProgress?.destroy();
        this.miniProgress = null;
        this.videoEl.removeEventListener('play', this.onPlay);
        this.videoEl.removeEventListener('pause', this.onPause);
        this.removeEventListener('pointermove', this.onPointerMove);
        this.removeEventListener('pointerleave', this.onPointerLeave);
        this.removeEventListener('pointerdown', this.onPointerDownFocus);
        this.controlBar.settingsMenu.onOpenChange = null;
        document.removeEventListener('fullscreenchange', this.onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
        this.videoEl.removeEventListener('webkitbeginfullscreen', this.onFullscreenChange);
        this.videoEl.removeEventListener('webkitendfullscreen', this.onFullscreenChange);
        this.videoEl.removeEventListener('mousedown', this.onVideoPressStart);
        this.videoEl.removeEventListener('mouseup', this.onVideoPressEnd);
        this.videoEl.removeEventListener('mouseleave', this.onVideoPressCancel);
        this.videoEl.removeEventListener('touchstart', this.onVideoPressStart);
        this.videoEl.removeEventListener('touchend', this.onVideoPressEnd);
        this.videoEl.removeEventListener('touchcancel', this.onVideoPressCancel);
        this.controlBar.destroy();
        this.captionRenderer.destroy();
        this.keyboard.destroy();
        this.tooltip.destroy();
        this.loadingSpinner.destroy();
        this.errorScreen.destroy();
        this.seekFeedback.destroy();
        this.sourceManager.destroy();
        this.adsController?.destroy();
        this.gestureControls?.destroy();
        this.loopSection?.destroy();
        this.inViewAutoplay?.destroy();
        this.unregisterSticky?.();
        this.playlistRunner?.destroy();
        this.hopeStory?.destroy();
        this.markProgress?.destroy();
        this.segments?.destroy();
        this.spriteThumbnails?.destroy();
        this.countdownScreen?.destroy();
        this.geoChecker?.destroy();
        this.redirectScreen?.destroy();
        this.qrResume?.destroy();
        this.pauseAd?.destroy();
        this.pauseAd = null;
        this.dubbing?.destroy();
        this.liveWallClock?.destroy();
        this.daiController?.destroy();
        if (this.hideTimer) clearTimeout(this.hideTimer);
        if (this.bootGraceTimer) clearTimeout(this.bootGraceTimer);
    }

    /** Reklam/consent-farkında plugin'lerin (gesture/sticky/in-view-autoplay) ortak sorgusu. */
    isAdPlaying(): boolean {
        return this.chromeBlockers.has('ads');
    }

    attributeChangedCallback(): void {
        this.syncFromAttributes();
    }

    get options(): HopePlayerOptions {
        return this._options;
    }

    set options(value: HopePlayerOptions) {
        this._options = value ?? {};
        // Attribute'larla birleştir — aksi halde theme alanı olmayan bir .options ataması attribute'tan gelen temayı silerdi.
        if (this.bootGraceTimer) {
            clearTimeout(this.bootGraceTimer);
            this.bootGraceTimer = null;
        }
        this.bootResolved = true;
        this.syncFromAttributes();
    }

    play(): Promise<void> {
        return this.videoEl.play();
    }

    pause(): void {
        this.videoEl.pause();
    }

    /** Şu anki oynatma yolu: `native` (MP4/WebM), `native-hls` (tarayıcının HLS'i) ya da `hls.js` — teşhis için. */
    get playbackEngine(): PlaybackEngineInfo {
        return this.sourceManager.engine;
    }

    /** `options.qrResume` kuruluysa "telefonundan devam et" QR ekranını manuel göster (ör. entegratörün kendi "telefona gönder" butonu) — otomatik gösterim kuralları (minElapsed/minRemaining) burada uygulanmaz. */
    showQrResume(): void {
        this.qrResume?.show();
    }

    get showRemainingTime(): boolean {
        return this.controlBar.getShowRemaining();
    }

    set showRemainingTime(value: boolean) {
        this.controlBar.setShowRemaining(value);
    }

    toggleTimeDisplay(): void {
        this.controlBar.toggleTimeMode();
    }

    private syncFromAttributes(): void {
        const attrOptions: HopePlayerOptions = {
            src: this.getAttribute('src') ?? undefined,
            poster: this.getAttribute('poster') ?? undefined,
            autoplay: this.hasAttribute('autoplay'),
            muted: this.hasAttribute('muted'),
            loop: this.hasAttribute('loop'),
            theme: this.getAttribute('theme') ?? undefined,
            locale: this.getAttribute('locale') ?? undefined,
        };
        void this.applyOptions({ ...attrOptions, ...this._options });
    }

    private async applyOptions(options: HopePlayerOptions): Promise<void> {
        if (options.poster) this.videoEl.poster = options.poster;
        this.videoEl.autoplay = !!options.autoplay;
        this.videoEl.muted = !!options.muted;
        this.videoEl.loop = !!options.loop;
        this.videoEl.preload = options.preload ?? 'metadata';
        // iOS: inline oynatma (aksi halde play() videoyu zorla tam ekrana alır). Eski iOS/WebView'lar için webkit- adı.
        this.videoEl.playsInline = true;
        this.videoEl.setAttribute('webkit-playsinline', '');
        this.autoHideDelayMs = options.autoHideDelayMs ?? DEFAULT_AUTO_HIDE_DELAY_MS;
        if (options.miniProgress && !this.miniProgress) {
            this.miniProgress = new MiniProgress(this.videoEl);
            this.videoArea.appendChild(this.miniProgress.el);
            this.updateMiniProgress();
        } else if (!options.miniProgress && this.miniProgress) {
            this.miniProgress.destroy();
            this.miniProgress = null;
        }
        // Yalnızca DEĞER değişince uygula — başka bir option güncellemesi kullanıcının tıklayarak seçtiği modu sıfırlamasın.
        const seekStep = options.keyboardSeekStep && options.keyboardSeekStep > 0 ? options.keyboardSeekStep : DEFAULT_KEYBOARD_SEEK_STEP;
        this.keyboard.seekStep = seekStep;
        this.controlBar.seekBar.keyboardStep = seekStep;
        const skip = options.skipButtons === true ? {} : options.skipButtons || null;
        this.controlBar.setSkipButtons(
            skip && skip.back !== false ? (skip.back ?? DEFAULT_SKIP_SECONDS) : null,
            skip && skip.forward !== false ? (skip.forward ?? DEFAULT_SKIP_SECONDS) : null
        );
        if (options.showRemainingTime !== undefined && options.showRemainingTime !== this.appliedShowRemaining) {
            this.appliedShowRemaining = options.showRemainingTime;
            this.controlBar.setShowRemaining(options.showRemainingTime);
        }
        if (options.theme) this.setAttribute('data-theme', options.theme);
        else this.removeAttribute('data-theme');

        this.localeCode = options.locale ?? 'tr';
        applyLocale(this.i18n, options.locale, options.labels);
        this.centerPlayButton.setAttribute('aria-label', this.i18n.play);
        this.controlBar.refreshLabels();
        this.captionRenderer.refreshLabels(this.i18n);
        if (this.captionTrackActive) this.controlBar.settingsMenu.setCaptionAppearance(this.buildCaptionAppearance());
        this.errorScreen.refreshLabels();
        this.playlistRunner?.refreshLabels();
        this.hopeStory?.refreshLabels();
        this.countdownScreen?.refreshLabels();
        this.geoChecker?.refreshLabels();
        this.redirectScreen?.refreshLabels();
        this.qrResume?.refreshLabels();
        this.pauseAd?.refreshLabels();
        this.dubbing?.refreshLabels();
        this.liveWallClock?.refreshLabels();
        this.loopSection?.refreshLabels();
        this.markProgress?.refreshLabels();
        this.unregisterSticky?.refreshLabels?.();

        if (!this.bootResolved) {
            return;
        }

        // Gate plugin'leri (countdown/geo) KAYNAK YÜKLENMEDEN/autoplay denenmeden
        // ÖNCE kuruluyor ki blockChrome() + 'play' dinleyicisi zaten takılı olsun
        // — aksi halde autoplay bir an için gerçekten oynamaya başlayabilirdi.
        const gateCtx = () => ({
            videoEl: this.videoEl,
            overlayContainerEl: this.videoArea,
            blockChrome: () => this.blockChrome('countdown-geo'),
            unblockChrome: () => this.unblockChrome('countdown-geo'),
            i18n: this.i18n,
        });

        if (options.countdownScreen && !this.countdownScreen) {
            const { installCountdownScreen } = await import('./plugins/countdown-screen');
            this.countdownScreen = installCountdownScreen(gateCtx(), options.countdownScreen);
        }

        if (options.geoChecker && !this.geoChecker) {
            const { installGeoChecker } = await import('./plugins/geo-checker');
            this.geoChecker = installGeoChecker(gateCtx(), options.geoChecker);
        }

        this.unblockChrome('boot');

        if (this.countdownScreen && !this.countdownScreen.isComplete()) {
            this.pendingPlaybackOptions = options;
            if (!this.playbackInitRegistered) {
                this.playbackInitRegistered = true;
                this.countdownScreen.onComplete(() => {
                    const pending = this.pendingPlaybackOptions;
                    this.pendingPlaybackOptions = null;
                    if (pending) void this.initPlayback(pending);
                });
            }
        } else {
            await this.initPlayback(options);
        }
    }

    private async initPlayback(options: HopePlayerOptions): Promise<void> {
        const sources = options.sources?.length ? options.sources : options.src ? [{ src: options.src, label: this.i18n.autoQuality }] : [];
        // Tek kaynakta önceki kaynağın (MP4 sources) kalite listesi kalmasın — yüklemeden ÖNCE temizle,
        // ki hls.js'in birazdan bildireceği seviyeler silinmesin.
        if (sources.length <= 1) {
            this.controlBar.setQualities([], '');
            this.hlsQualitiesShown = false;
        }
        if (sources.length > 0) {
            const initial = sources.find((s) => s.selected) ?? sources[0]!;
            await this.sourceManager.load(initial.src, initial.type);
            if (options.autoplay) this.videoEl.play().catch(() => {});
        }

        if (sources.length > 1) {
            this.controlBar.setQualities(
                sources.map((s) => ({
                    label: s.label,
                    onSelect: () => void this.switchQualitySource(s),
                })),
                sources.find((s) => s.selected)?.label ?? sources[0]!.label
            );
        }

        if (options.ads && !this.adsController) {
            const adsOptions: AdsOptions = options.ads === true ? {} : options.ads;
            // Reklamsız entegrasyonlarda bu import hiç tetiklenmez — bkz. plan:
            // "eklenmeyen plugin yük bindirmemeli" (dinamik import = ayrı chunk).
            const { installAds } = await import('./plugins/ads');
            this.adsController = await installAds(
                {
                    videoEl: this.videoEl,
                    hostEl: this,
                    adLayerEl: this.adLayerEl,
                    hideChrome: () => this.blockChrome('ads', 'reduced'),
                    showChrome: () => this.unblockChrome('ads'),
                    // IMA'nın KENDİ UI'ı üzerinden (ör. reklam video'suna
                    // tıklama) duraklatılır/devam ettirilirse toolbar'ımızın
                    // ikonu da senkron kalsın diye.
                    onAdPlayStateChange: () => this.controlBar.refreshAdPlayState(),
                    locale: this.localeCode,
                },
                adsOptions
            );
        }

        if (options.gesture && !this.gestureControls) {
            const gestureOptions = options.gesture === true ? {} : options.gesture;
            const { installGesture } = await import('./plugins/gesture');
            this.gestureControls = installGesture(
                { videoEl: this.videoEl, overlayContainerEl: this.videoArea, isAdActive: () => this.isAdPlaying() },
                gestureOptions
            );
        }

        if (options.loopSection && !this.loopSection) {
            const loopOptions = options.loopSection === true ? {} : options.loopSection;
            const { installLoopSection } = await import('./plugins/loop-section');
            this.loopSection = installLoopSection(
                {
                    videoEl: this.videoEl,
                    seekBarEl: this.controlBar.seekBar.el,
                    markers: this.controlBar.seekBar,
                    addControlButton: (label, icon, onClick) => this.controlBar.addButton(label, icon, onClick),
                    i18n: this.i18n,
                },
                loopOptions
            );
        }

        if (options.inViewAutoplay && !this.inViewAutoplay) {
            const inViewOptions = options.inViewAutoplay === true ? {} : options.inViewAutoplay;
            const { installInViewAutoplay } = await import('./plugins/in-view-autoplay');
            this.inViewAutoplay = installInViewAutoplay(
                { videoEl: this.videoEl, observeEl: this, isAdActive: () => this.isAdPlaying() },
                inViewOptions
            );
        }

        if (options.sticky && !this.unregisterSticky) {
            const stickyOptions = options.sticky === true ? {} : options.sticky;
            const { installSticky } = await import('./plugins/sticky');
            this.unregisterSticky = installSticky(
                {
                    key: this.instanceKey,
                    videoEl: this.videoEl,
                    hostEl: this,
                    wrapperEl: this,
                    closeButtonMountEl: this.videoArea,
                    isAdActive: () => this.isAdPlaying(),
                    i18n: this.i18n,
                },
                stickyOptions
            );
        }

        if (options.playlist && !this.playlistRunner) {
            const { installPlaylist } = await import('./plugins/playlist');
            this.playlistRunner = installPlaylist(
                {
                    videoEl: this.videoEl,
                    hostEl: this,
                    panelEl: this.getOrCreatePanelContainer(),
                    loadSource: (src, type) => this.sourceManager.load(src, type),
                    setPoster: (url) => {
                        this.videoEl.poster = url;
                    },
                    requestFreshAd: (tag) => this.adsController?.resetForNewItem(tag),
                    i18n: this.i18n,
                },
                options.playlist
            );
        }

        if (options.story && !this.hopeStory) {
            const { installStory } = await import('./plugins/story');
            this.hopeStory = installStory(
                {
                    videoEl: this.videoEl,
                    hostEl: this,
                    videoAreaEl: this.videoArea,
                    playerBodyEls: [this.root.querySelector<HTMLDivElement>('.media-layer')!, this.chromeEl, this.centerPlayButton],
                    loadSource: (src, type) => this.sourceManager.load(src, type),
                    setPoster: (url) => {
                        this.videoEl.poster = url;
                    },
                    requestFreshAd: (tag) => this.adsController?.resetForNewItem(tag),
                    i18n: this.i18n,
                },
                options.story
            );
        }

        if (options.markers && !this.markProgress) {
            const { installMarkers } = await import('./plugins/markers');
            this.markProgress = installMarkers(
                {
                    videoEl: this.videoEl,
                    overlayContainerEl: this.videoArea,
                    addSeekBarMarker: (ratio, extraClass) => this.controlBar.seekBar.addMarker(ratio, extraClass),
                    i18n: this.i18n,
                },
                options.markers
            );
        }

        if (options.segments?.length && !this.segments) {
            const { installSegments } = await import('./plugins/segments');
            this.segments = installSegments({ videoEl: this.videoEl, seekBar: this.controlBar.seekBar }, options.segments);
        }

        if (options.spriteThumbnails && !this.spriteThumbnails) {
            const { installSpriteThumbnails } = await import('./plugins/sprite-thumbnails');
            this.spriteThumbnails = installSpriteThumbnails(
                {
                    videoEl: this.videoEl,
                    seekBar: this.controlBar.seekBar,
                    playerWidth: () => this.videoArea.clientWidth,
                },
                options.spriteThumbnails
            );
        }

        if (options.redirectScreen && !this.redirectScreen) {
            const { installRedirectScreen } = await import('./plugins/redirect-screen');
            this.redirectScreen = installRedirectScreen(
                { videoEl: this.videoEl, overlayContainerEl: this.videoArea, isAdActive: () => this.isAdPlaying(), i18n: this.i18n },
                options.redirectScreen
            );
        }

        if (options.qrResume && !this.qrResume) {
            const { installQrResume } = await import('./plugins/qr-resume');
            this.qrResume = installQrResume({ videoEl: this.videoEl, overlayContainerEl: this.videoArea, i18n: this.i18n }, options.qrResume);
        }
        if (this.qrResume) {
            // QrResume aç/kapa satırı her initPlayback'te yeniden eklenir (dil değişimi vb.).
            const qr = this.qrResume;
            this.controlBar.settingsMenu.setQrResumeToggle({
                label: this.i18n.qrResumeMenuLabel,
                getValueLabel: () => (qr.isEnabled() ? this.i18n.qrResumeOn : this.i18n.qrResumeOff),
                onToggle: () => qr.setEnabled(!qr.isEnabled()),
            });
        }

        if (options.pauseAd?.adUnitPath && !this.pauseAd) {
            const { installPauseAd } = await import('./plugins/pause-ad');
            this.pauseAd = installPauseAd(
                { videoEl: this.videoEl, hostEl: this, videoArea: this.videoArea, i18n: this.i18n, isBlocked: () => this.isChromeBlocked },
                options.pauseAd
            );
        }

        if (options.dubbing && !this.dubbing) {
            const { installDubbing } = await import('./plugins/dubbing');
            this.dubbing = installDubbing(
                {
                    videoEl: this.videoEl,
                    loadSource: (src, type) => this.sourceManager.load(src, type),
                    registerSubmenu: (def) => this.controlBar.settingsMenu.registerSubmenu(def),
                    unregisterSubmenu: (key) => this.controlBar.settingsMenu.unregisterSubmenu(key),
                    i18n: this.i18n,
                },
                options.dubbing
            );
        }

        if (options.liveWallClock && !this.liveWallClock) {
            const liveWallClockOptions = options.liveWallClock === true ? {} : options.liveWallClock;
            const { installLiveWallClock } = await import('./plugins/live');
            this.liveWallClock = installLiveWallClock(
                {
                    videoEl: this.videoEl,
                    seekBarEl: this.controlBar.seekBar.el,
                    addControlElement: (el) => this.controlBar.addElement(el),
                    i18n: this.i18n,
                },
                liveWallClockOptions
            );
        }

        if (options.dai && !this.daiController) {
            const { installDai } = await import('./plugins/dai');
            this.daiController = await installDai(
                {
                    videoEl: this.videoEl,
                    hostEl: this,
                    adUiEl: this.adLayerEl,
                    loadStreamUrl: (url) => this.sourceManager.load(url),
                    disableSeeking: () => this.disableSeeking(),
                    enableSeeking: () => this.enableSeeking(),
                },
                options.dai
            );
        }

        if (options.subtitles?.length) {
            this.subtitleTracks = attachSubtitleTracks(this.videoEl, options.subtitles);
            const defaultTrack = options.subtitles.find((s) => s.default);
            // selectCaption: altyazı seçiminin tek doğruluk kaynağı (track mode + renderer + ayarlar menüsü).
            const selectCaption = (label: string | null): void => {
                const track = selectSubtitleTrack(this.subtitleTracks, label);
                this.captionRenderer.setActiveTrack(track);
                this.captionTrackActive = track !== null;
                this.controlBar.settingsMenu.setActiveCaption(label ?? this.i18n.captionsOff);
                this.controlBar.settingsMenu.setCaptionAppearance(track !== null ? this.buildCaptionAppearance() : null);
            };
            this.selectCaption = selectCaption;
            this.controlBar.setCaptions(
                [
                    { label: this.i18n.captionsOff, onSelect: () => selectCaption(null) },
                    ...this.subtitleTracks.map(({ label }) => ({
                        label,
                        onSelect: () => selectCaption(label),
                    })),
                ],
                defaultTrack?.label ?? this.i18n.captionsOff
            );
            selectCaption(defaultTrack?.label ?? null);
        } else {
            clearSubtitleTracks(this.videoEl);
            this.subtitleTracks = [];
            this.selectCaption = null;
            this.captionRenderer.setActiveTrack(null);
            this.captionTrackActive = false;
            this.controlBar.settingsMenu.setCaptionAppearance(null);
        }
    }

    /** Ayarlar menüsünün "Altyazı" alt menüsüne eklenen Boyut/Renk/Konum satırları — her zaman GÜNCEL `this.i18n`'i okur (dil sonradan değişse bile). */
    private buildCaptionAppearance(): SettingsCaptionAppearance {
        const sizes: CaptionFontSize[] = ['small', 'normal', 'large'];
        const buildColorOptions = (
            presets: readonly string[],
            get: () => string,
            set: (value: string) => void,
            label: string
        ): SettingsColorOption[] =>
            presets.map((value, i) => ({
                value,
                active: get() === value,
                ariaLabel: `${label} ${i + 1}`,
                onSelect: () => set(value),
            }));
        return {
            sizeLabel: this.i18n.captionSize,
            getSizeOptions: () =>
                sizes.map((size) => ({
                    label:
                        size === 'small'
                            ? this.i18n.captionSizeSmall
                            : size === 'large'
                              ? this.i18n.captionSizeLarge
                              : this.i18n.captionSizeNormal,
                    active: this.captionRenderer.getFontSize() === size,
                    onSelect: () => this.captionRenderer.setFontSize(size),
                })),
            bgColorLabel: this.i18n.captionBgColor,
            getBgColorOptions: () =>
                buildColorOptions(
                    CaptionRenderer.BG_COLOR_PRESETS,
                    () => this.captionRenderer.getBgColor(),
                    (v) => this.captionRenderer.setBgColor(v),
                    this.i18n.captionBgColor
                ),
            textColorLabel: this.i18n.captionTextColor,
            getTextColorOptions: () =>
                buildColorOptions(
                    CaptionRenderer.TEXT_COLOR_PRESETS,
                    () => this.captionRenderer.getTextColor(),
                    (v) => this.captionRenderer.setTextColor(v),
                    this.i18n.captionTextColor
                ),
            resetPositionLabel: this.i18n.captionResetPosition,
            onResetPosition: () => this.captionRenderer.resetPosition(),
        };
    }

    /** Playlist panelinin monte edileceği, .video-area'nın ALTINDAKİ (shadow root içi) kapsayıcı — ilk ihtiyaçta oluşturulur. */
    private panelContainer: HTMLDivElement | null = null;
    private getOrCreatePanelContainer(): HTMLDivElement {
        if (!this.panelContainer) {
            this.panelContainer = document.createElement('div');
            this.root.appendChild(this.panelContainer);
        }
        return this.panelContainer;
    }

    /** Kalite değişirken oynatma konumunu ve play/pause durumunu korur. */
    private async switchQualitySource(source: NonNullable<HopePlayerOptions['sources']>[number]): Promise<void> {
        const resumeTime = this.videoEl.currentTime;
        const wasPlaying = !this.videoEl.paused;
        await this.sourceManager.load(source.src, source.type);
        this.videoEl.currentTime = resumeTime;
        if (wasPlaying) this.videoEl.play().catch(() => {});
        this.dispatchEvent(new CustomEvent('hp:qualitychange', { detail: { label: source.label } }));
    }

    private readonly onHlsLevelsChanged = (levels: HlsQualityLevel[], activeIndex: number): void => {
        // Kaynak değişince boş liste gelir — önceki HLS kaynağının seviyeleri menüde kalmasın.
        if (levels.length === 0 && this.hlsQualitiesShown) {
            this.hlsQualitiesShown = false;
            this.controlBar.setQualities([], '');
            return;
        }
        if (levels.length <= 1) return;
        this.hlsQualitiesShown = true;
        const label = (l: HlsQualityLevel) => `${l.height}p`;
        this.controlBar.setQualities(
            [
                { label: this.i18n.autoQuality, onSelect: () => this.sourceManager.setLevel(-1) },
                // Yüksekten düşüğe (hls.js artan sıralıyor) — l.index hls.js'teki gerçek seviye numarası, sıradan bağımsız.
                ...[...levels]
                    .sort((x, y) => y.height - x.height)
                    .map((l) => ({ label: label(l), onSelect: () => this.sourceManager.setLevel(l.index) })),
            ],
            activeIndex === -1 ? this.i18n.autoQuality : label(levels[activeIndex]!)
        );
    };

    // ── Fullscreen (vendor-prefix uyumlu) ───────────────────────────────

    /** iPhone Safari element tam ekranını desteklemiyor — yalnızca <video>'nun kendi (native kontrollü) tam ekranı. */
    private get iosVideo(): HTMLVideoElement & {
        webkitEnterFullscreen?: () => void;
        webkitExitFullscreen?: () => void;
        webkitDisplayingFullscreen?: boolean;
    } {
        return this.videoEl;
    }

    private requestFullscreenCompat(): void {
        const el = this as unknown as {
            requestFullscreen?: () => Promise<void>;
            webkitRequestFullscreen?: () => void;
        };
        const videoFallback = (): void => this.iosVideo.webkitEnterFullscreen?.();
        if (el.requestFullscreen) el.requestFullscreen().catch(videoFallback);
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else videoFallback();
    }

    private exitFullscreenCompat(): void {
        if (this.iosVideo.webkitDisplayingFullscreen) {
            this.iosVideo.webkitExitFullscreen?.();
            return;
        }
        const doc = document as unknown as { webkitExitFullscreen?: () => void };
        if (document.exitFullscreen) void document.exitFullscreen();
        else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    }

    private isFullscreenActive(): boolean {
        const doc = document as unknown as { webkitFullscreenElement?: Element | null };
        return document.fullscreenElement === this || doc.webkitFullscreenElement === this || !!this.iosVideo.webkitDisplayingFullscreen;
    }

    private readonly onFullscreenChange = (e?: Event): void => {
        this.controlBar.setFullscreenState(this.isFullscreenActive());
        if (e?.type === 'webkitbeginfullscreen') this.showCaptionsNatively();
        else if (e?.type === 'webkitendfullscreen') this.syncCaptionsFromNative();
    };

    /**
     * iPhone native tam ekranında bizim altyazı katmanımız görünmez — seçili izi 'showing' yapıp iOS'un çizmesine bırakırız.
     */
    private showCaptionsNatively(): void {
        for (const { track } of this.subtitleTracks) if (track.mode === 'hidden') track.mode = 'showing';
    }

    /**
     * Native tam ekrandan dönüş: iOS menüsünde seçilen iz 'showing' kalır ve kendi katmanımızla çift altyazı çizilir.
     * Seçimi bizim tarafa aktarıp izi tekrar 'hidden' yaparız (hiçbiri showing değilse kullanıcı kapatmıştır).
     */
    private syncCaptionsFromNative(): void {
        if (!this.selectCaption) return;
        const showing = this.subtitleTracks.find(({ track }) => track.mode === 'showing');
        this.selectCaption(showing?.label ?? null);
    }

    // ── Oynatma durumuna göre merkez buton + otomatik gizlenme ──

    // Değer: 'hidden' (tamamen gizle — countdown/geo) ya da 'reduced' (yalnızca oynat/duraklat + ses — ads).
    private readonly chromeBlockers = new Map<string, 'hidden' | 'reduced'>();
    private get isChromeBlocked(): boolean {
        return this.chromeBlockers.size > 0;
    }
    private get isChromeFullyHidden(): boolean {
        for (const mode of this.chromeBlockers.values()) if (mode === 'hidden') return true;
        return false;
    }

    private readonly onPlay = (): void => {
        if (!this.isChromeBlocked) {
            this.centerPlayButton.style.opacity = '0';
            this.centerPlayButton.style.pointerEvents = 'none';
            this.scheduleAutoHide();
        }
        this.dispatchEvent(new CustomEvent('hp:play'));
    };

    private readonly onPause = (): void => {
        // Oynarken kurulan gizleme zamanlayıcısını iptal et — yoksa duraklatınca kontroller birazdan kayboluyordu.
        if (this.hideTimer) clearTimeout(this.hideTimer);
        if (!this.isChromeBlocked) {
            this.centerPlayButton.style.opacity = '1';
            this.centerPlayButton.style.pointerEvents = 'auto';
            this.showChrome();
        }
        this.dispatchEvent(new CustomEvent('hp:pause'));
    };

    private readonly onPointerDownFocus = (): void => {
        this.focus();
        // AdDisplayContainer.initialize() bir kullanıcı jestinde çağrılmalı (IMA) — player'a ilk dokunuşta.
        this.adsController?.initializeDisplayContainerOnce();
    };

    private readonly onVideoPressStart = (e: MouseEvent | TouchEvent): void => {
        this.tapCandidate = true;
        const point = 'touches' in e ? e.touches[0] : e;
        if (!point) return;
        this.tapStartX = point.clientX;
        this.tapStartY = point.clientY;
    };

    private readonly onVideoPressEnd = (e: MouseEvent | TouchEvent): void => {
        if (!this.tapCandidate) return;
        this.tapCandidate = false;
        if (this.isChromeBlocked) return;
        if (this.gestureControls?.isCurrentlyHolding()) return;

        const point = 'changedTouches' in e ? e.changedTouches[0] : e;
        if (point) {
            const moved = Math.hypot(point.clientX - this.tapStartX, point.clientY - this.tapStartY);
            if (moved > TAP_MAX_MOVE_PX) return;
        }
        if (this.videoEl.paused) void this.videoEl.play().catch(() => {});
        else this.videoEl.pause();
    };

    private readonly onVideoPressCancel = (): void => {
        this.tapCandidate = false;
    };

    private showChrome(): void {
        this.setChromeOpacity('1');
    }

    /** Chrome görünürlüğünün tek giriş noktası — altyazı da haberdar olur (kontroller gizlenince en alta iner). */
    private setChromeOpacity(value: '0' | '1'): void {
        this.chromeEl.style.opacity = value;
        this.chromeVisible = value === '1';
        // captionRenderer constructor'da chrome'dan SONRA kuruluyor — o ana kadarki çağrılar için güvenli.
        this.captionRenderer?.setChromeVisible(this.chromeVisible);
        this.updateMiniProgress();
    }

    /** İnce ilerleme çizgisi: yalnızca kontroller gizliyken; reklam/giriş ekranı (chrome bloklu) sırasında değil. */
    private updateMiniProgress(): void {
        this.miniProgress?.setVisible(!this.chromeVisible && !this.isChromeBlocked);
    }

    /**
     * Plugin (ads/countdown/geo) chrome'u kendi key'iyle gizler; unblockChrome aynı key'le açar.
     * 'reduced' (ads): yalnızca oynat/duraklat + ses kalır. Merkez buton her modda gizli.
     */
    blockChrome(key: string, mode: 'hidden' | 'reduced' = 'hidden'): void {
        this.chromeBlockers.set(key, mode);
        this.updateMiniProgress();
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.centerPlayButton.style.opacity = '0';
        this.centerPlayButton.style.pointerEvents = 'none';
        if (this.isChromeFullyHidden) {
            this.setChromeOpacity('0');
            this.chromeEl.style.pointerEvents = 'none';
        } else {
            // pointerEvents'e inline dokunma — CSS'teki pointer-events-none'ı ezip reklamın "Reklamı Geç" butonunu kapatırdı.
            this.setChromeOpacity('1');
        }
        this.controlBar.setAdMode(this.chromeBlockers.get('ads') === 'reduced');
    }

    /** Bloklayan plugin işini bitirince çağırır — başka bir blocker hâlâ aktifse chrome açılmaz. */
    unblockChrome(key: string): void {
        this.chromeBlockers.delete(key);
        this.updateMiniProgress();
        this.controlBar.setAdMode(this.chromeBlockers.get('ads') === 'reduced');
        if (this.isChromeBlocked) {
            if (this.isChromeFullyHidden) {
                this.setChromeOpacity('0');
                this.chromeEl.style.pointerEvents = 'none';
            } else {
                // bkz. blockChrome'daki not — pointerEvents'a KASITLI dokunulmuyor.
                this.setChromeOpacity('1');
                this.chromeEl.style.pointerEvents = '';
            }
            return;
        }

        this.chromeEl.style.pointerEvents = '';
        if (this.videoEl.paused) {
            this.centerPlayButton.style.opacity = '1';
            this.centerPlayButton.style.pointerEvents = 'auto';
            this.showChrome();
        } else {
            this.scheduleAutoHide();
        }
    }

    /** DAI reklam arası boyunca kullanıcı reklamın İÇİNE seek edemesin diye (sunucu taraflı eklenen reklamlar seekable aralığın parçası). */
    disableSeeking(): void {
        this.controlBar.setSeekingEnabled(false);
        this.controlBar.seekBar.el.style.pointerEvents = 'none';
        this.controlBar.seekBar.el.style.opacity = '0.5';
    }

    enableSeeking(): void {
        this.controlBar.setSeekingEnabled(true);
        this.controlBar.seekBar.el.style.pointerEvents = '';
        this.controlBar.seekBar.el.style.opacity = '';
    }

    private readonly onPointerMove = (e: PointerEvent): void => {
        // chromeEl pointer-events-none; olay yolunda yalnızca imleç bir kontrolün (pointer-events-auto) üzerindeyse görünür.
        this.pointerOverControls = e.pointerType === 'mouse' && e.composedPath().includes(this.chromeEl);
        this.scheduleAutoHide();
    };

    private readonly onPointerLeave = (e: PointerEvent): void => {
        if (e.pointerType !== 'mouse') return;
        this.pointerOverControls = false;
        this.scheduleAutoHide();
    };

    private readonly scheduleAutoHide = (): void => {
        this.showChrome();
        if (this.hideTimer) clearTimeout(this.hideTimer);
        if (this.videoEl.paused) return;
        this.hideTimer = setTimeout(() => {
            // Duraklatılmışken, fare kontrollerin üzerindeyken ya da ayarlar menüsü açıkken gizleme.
            if (this.videoEl.paused || this.pointerOverControls || this.controlBar.settingsMenu.isOpen) return;
            this.setChromeOpacity('0');
        }, this.autoHideDelayMs);
    };
}
