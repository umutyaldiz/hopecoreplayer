import { AdSurfaceGuard, type AdSurfaceGuardContext } from './AdSurfaceGuard';
import { loadImaSdk } from './loadImaSdk';
import { generateVastUrl } from './generateVastUrl';
import { RetryController, type AdBreakType } from './RetryController';
import { initConsentAware } from './consent';
import { Scte35LiveAdManager } from './scte35';
import type { AdsOptions, PrebidBreakOptions } from '../../types';
import type { VideoPrebid } from '../prebid/VideoPrebid';
import type { PrerollGate } from './PrerollGate';

export interface AdsPlayerContext {
    videoEl: HTMLVideoElement;
    hostEl: HTMLElement;
    /** IMA'nın ad UI'ını (skip butonu/sayaç) çizdiği, video'nun üzerindeki katman. */
    adLayerEl: HTMLElement;
    hideChrome(): void;
    showChrome(): void;
    /** `options.locale` (ör. 'tr'/'en') — IMA SDK'nın KENDİ ad-UI'ının (skip butonu/sayaç/"Reklam" etiketi) dili de oynatıcının geri kalanıyla AYNI dili takip etsin diye `ima.settings.setLocale()`'a aktarılıyor. */
    locale: string;
    /** Reklamın oynat/duraklat durumu DIŞARIDAN (IMA'nın kendi UI'ı üzerinden) değişince toolbar'ı tazelemesi için — bkz. `adPaused` notu. */
    onAdPlayStateChange?(): void;
    /** Preroll sonuçlanana kadar içeriği bekleten kapı (elementte, plugin yüklenmeden önce kurulur) — bkz. PrerollGate. */
    prerollGate?: PrerollGate;
    /** Player'ın hata kaydına (hata ayıklama penceresi) — yeniden denenen hatalar dahil her reklam hatası. */
    log?(entry: { message: string; fatal?: boolean; details?: Record<string, string | number | boolean | undefined> }): void;
    /** Reklam geri sayımı + pod bilgisi (toolbar'daki "Reklam 2/3 · 0:12"); null → gizle. */
    onAdProgress?(info: { remaining: number; position: number; total: number } | null): void;
    /** İçerik art arda otomatik oynuyor mu (playlist / story autoplayNext) — sürekli oynatma bildirimi. */
    isContinuousPlayback?(): boolean;
    /** iPhone native tam ekranı / PiP'te reklam görünmez — reklam arasında bu yüzeylerden çıkılır (bkz. AdSurfaceGuard). */
    surface?: AdSurfaceGuardContext;
}

/** Bir IMA hatasının ayrıntıları — hp:aderror olayı ve hata ayıklama kaydı için. */
interface AdErrorInfo {
    message: string;
    code?: number;
    vastCode?: number;
    errorType?: string;
}

const AD_PROGRESS_INTERVAL_MS = 250;

/** Hazırda bekleyen preroll bundan eskiyse oynatılırken yeniden istenir (teklif / VAST yanıtı bayatlamasın). */
const PREROLL_MAX_AGE_MS = 5 * 60 * 1000;
/** 'visible': player ekranın bu kadar yakınına girince (bir ekran boyu) reklam istenir. */
const VISIBLE_ROOT_MARGIN = '100% 0px 100% 0px';

function tagConfigFor(options: AdsOptions, type: AdBreakType): string | string[] | undefined {
    if (type === 'Preroll') return options.adTagPreroll;
    if (type === 'Midroll') return options.adTagMidroll;
    return options.adTagPostroll;
}

/** Google IMA SDK ile doğrudan konuşan reklam çekirdeği (preroll/midroll/postroll, VMAP, retry, Prebid, SCTE-35). */
export class AdsController {
    private ima: typeof google.ima | null = null;
    private adDisplayContainer: google.ima.AdDisplayContainer | null = null;
    private adsLoader: google.ima.AdsLoader | null = null;
    private adsManager: google.ima.AdsManager | null = null;

    private readonly retry: RetryController;
    private currentBreakType: AdBreakType = 'Preroll';
    private vmapRequested = false;
    private postrollPending = false;
    private postrollShown = false;
    private lastMidrollTime = 0;
    private displayContainerInitialized = false;
    /**
     * Reklam sırasında toolbar oynat/duraklat + ses buraya yönlenir (IMA reklamı ayrı bir video'da oynatır).
     * Durum hem bizim çağrılarımızdan hem IMA'nın kendi PAUSED/RESUMED event'lerinden senkron tutulur.
     */
    private adPaused = false;
    private adVolumeBeforeMute = 1;
    private readonly prebidIdSuffix: string;
    private readonly prebidInstances: Partial<Record<AdBreakType, VideoPrebid>> = {};
    private scte35Manager: Scte35LiveAdManager | null = null;
    private scte35BreakActive = false;
    private scte35BreakTimeout: ReturnType<typeof setTimeout> | null = null;
    /**
     * Preroll yüklendi ama içerik henüz oynatılmak istenmedi — init() + start() oynatma isteğine kadar bekler.
     * init() de ertelenir: VMAP'te IMA, start() beklemeden init() anında 0 noktasındaki preroll'u kendiliğinden
     * oynatıyor (autoPlayAdBreaks: false bile durdurmuyor); init edilmemiş bir AdsManager hiçbir şey oynatamaz.
     */
    private prerollStartPending = false;
    /** İlk preroll/VMAP isteği atıldı mı (requestWhen'e göre zamanlanır). */
    private initialRequestFired = false;
    /** İlk preroll/VMAP isteğinin zamanı — bayatlama kontrolü için. */
    private prerollRequestedAt = 0;
    /** requestWhen: 'visible' — player ekrana yaklaşınca isteği tetikler. */
    private visibilityObserver: IntersectionObserver | null = null;
    /** Bir lineer reklam arası başladı ve henüz bitmedi (CONTENT_PAUSE_REQUESTED → CONTENT_RESUME_REQUESTED). */
    private linearBreakActive = false;
    /** Ekranda bir overlay (non-linear) reklam var — reklam katmanı içerikle birlikte görünür. */
    private nonLinearActive = false;
    /** Son IMA hatası — vazgeçilince hp:aderror bununla gönderilir. */
    private lastAdError: AdErrorInfo | null = null;
    /** Reklam geri sayımı zamanlayıcısı (lineer reklam oynarken). */
    private progressTimer: ReturnType<typeof setInterval> | null = null;
    private podPosition = 1;
    private podTotal = 1;
    /** Son istek ham bir VMAP mı — VMAP'te aranın tipi isteğin tipinden değil, IMA'nın verdiği konumdan okunur. */
    private lastRequestIsVmap = false;
    /** Şu an oynayan / son oynayan reklam arasının tipi (hp:adstart / hp:adend ve sonrasındaki içerik kararı). */
    private activeBreak: 'preroll' | 'midroll' | 'postroll' = 'preroll';
    /** Preroll zaman aşımına uğradı — geç gelen cevap gösterilmez (içerik çoktan başladı). */
    private prerollAbandoned = false;
    private readonly surfaceGuard: AdSurfaceGuard | null;
    /** Player boyutu değişince (tam ekran, pencere, yön) IMA'ya bildirmek için — IMA boyutu kendisi izlemiyor. */
    private resizeObserver: ResizeObserver | null = null;
    private resizeFrame = 0;
    /** Açık overlay creative'inin yüksekliği — yeniden boyutlandırmada şerit yüksekliği için. */
    private nonLinearCreativeHeight = 0;

    constructor(
        private readonly ctx: AdsPlayerContext,
        readonly options: AdsOptions
    ) {
        this.retry = new RetryController(options.retry ?? {});
        this.prebidIdSuffix = ctx.hostEl.id || Math.random().toString(36).slice(2, 8);
        this.surfaceGuard = ctx.surface ? new AdSurfaceGuard(ctx.surface) : null;
    }

    async install(): Promise<void> {
        let ima: typeof google.ima;
        const gate = this.ctx.prerollGate;
        if (gate) {
            gate.onPlayIntent = this.onPrerollPlayIntent;
            gate.onTimeout = this.onPrerollTimeout;
        }
        try {
            ima = await loadImaSdk();
        } catch (err) {
            // Reklam engelleyici / ağ hatası — içerik reklamsız normal oynar (bekleyen oynatma isteği hemen başlar).
            gate?.release(true);
            this.ctx.log?.({ message: `IMA SDK failed to load: ${String(err)}`, details: { hint: 'ad blocker / network' } });
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:aderror', { detail: { message: String(err), errorType: 'sdkLoadError' } }));
            return;
        }
        this.ima = ima;

        try {
            ima.settings.setLocale(this.ctx.locale);
        } catch {
            /* eski SDK sürümünde olmayabilir — kritik değil */
        }

        // setNumRedirects kritik: SDK varsayılanı 4 wrapper — çok hoplu zincirlerde IMA reklamı hata vermeden bırakır.
        // Her ayar ayrı try/catch'te (eski SDK'da olmayabilir).
        try {
            ima.settings.setNumRedirects(this.options.numRedirects ?? 15);
        } catch {
            /* eski SDK sürümünde olmayabilir */
        }
        try {
            ima.settings.setDisableCustomPlaybackForIOS10Plus(true);
        } catch {
            /* eski SDK sürümünde olmayabilir */
        }
        try {
            if (ima.ImaSdkSettings?.VpaidMode) {
                ima.settings.setVpaidMode(ima.ImaSdkSettings.VpaidMode.INSECURE);
            }
        } catch {
            /* eski SDK sürümünde olmayabilir */
        }

        // consentAware (TCF/USP) — options.consentAware===true gerektirir, non-blocking.
        initConsentAware(this.options, this.ima);

        this.adDisplayContainer = new ima.AdDisplayContainer(this.ctx.adLayerEl, this.ctx.videoEl);
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(this.scheduleResize);
            this.resizeObserver.observe(this.ctx.videoEl);
        }
        this.adsLoader = new ima.AdsLoader(this.adDisplayContainer);
        this.adsLoader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, this.onAdsManagerLoaded);
        this.adsLoader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, this.onAdsLoaderError);

        // iOS/Safari: AdDisplayContainer.initialize() kullanıcı jestiyle çağrılmalı.
        this.ctx.videoEl.addEventListener('play', this.initializeDisplayContainerOnce);

        // Plugin dinamik yüklendiği için autoplay video'yu bu dinleyici bağlanmadan başlatmış olabilir —
        // kaçırılan 'play'i telafi et, yoksa initialize() hiç çağrılmaz (AdError 400).
        const hasPageLevelUserActivation =
            typeof navigator !== 'undefined' &&
            'userActivation' in navigator &&
            (navigator as unknown as { userActivation: { hasBeenActive: boolean } }).userActivation.hasBeenActive;
        // Preroll kapısı SDK yüklenirken gelen oynatma isteğini (autoplay dahil) tuttu — onu da say.
        if (!this.ctx.videoEl.paused || hasPageLevelUserActivation || gate?.hasPlayIntent) {
            this.initializeDisplayContainerOnce();
        }

        // Her zaman: VMAP postroll'u IMA'ya içeriğin bittiği (contentComplete) bildirilmeden oynamaz.
        this.ctx.videoEl.addEventListener('ended', this.onContentEnded);

        if (this.options.adTagMidroll && !this.options.adTagVmap && this.options.midrollIntervalSeconds) {
            this.ctx.videoEl.addEventListener('timeupdate', this.onTimeUpdateForMidroll);
        }

        this.requestInitialPrerollOrVmap();

        // Canlı + SCTE-35: normal preroll/midroll zamanlayıcısı yerine yayın
        // içindeki OUT/IN sinyalleri reklamı tetikler/bitirir — preroll YOK
        // (yayının "başlangıcı" olmadığı için auto-request edilmiyor).
        if (this.options.live?.scte35 && this.options.live.adTagLive) {
            this.scte35Manager = new Scte35LiveAdManager(this.ctx.videoEl, {
                onAdBreakStart: (duration) => this.onScte35AdBreakStart(duration),
                onAdBreakEnd: () => this.onScte35AdBreakEnd(),
            });
        }
    }

    /**
     * İlk preroll/VMAP isteğinin zamanı (requestWhen):
     * - 'visible' (varsayılan): player ekrana yaklaşınca — uzun bir makalenin sonundaki player için, oraya hiç inmeyen
     *   ziyaretçi adına boşa istek atılmaz (raporlarda istek/gösterim oranı düşmez, teklifler bayatlamaz); kullanıcı
     *   player'a ulaştığında reklam çoğunlukla hazırdır.
     * - 'load': hemen. - 'play': oynatma isteğinde (en geç; bekleme istek süresi kadar uzar).
     * Hangi moddan olursa olsun oynatma isteği geldiğinde istek hâlâ atılmadıysa hemen atılır.
     */
    private requestInitialPrerollOrVmap(): void {
        if (!this.options.adTagPreroll && !this.options.adTagVmap) return;
        const when = this.options.requestWhen ?? (this.options.requestOnPlay ? 'play' : 'visible');
        if (when === 'load' || !this.ctx.videoEl.paused) {
            this.fireInitialRequest();
            return;
        }
        if (when === 'visible' && typeof IntersectionObserver !== 'undefined') {
            this.visibilityObserver = new IntersectionObserver(
                (entries) => {
                    if (entries.some((e) => e.isIntersecting)) this.fireInitialRequest();
                },
                { rootMargin: VISIBLE_ROOT_MARGIN }
            );
            this.visibilityObserver.observe(this.ctx.hostEl);
            return;
        }
        if (when === 'visible') {
            this.fireInitialRequest();
            return;
        }
        // 'play': kapı varsa oynatma isteği onPrerollPlayIntent'ten gelir (kapı 'play' olayını yutuyor).
        if (!this.ctx.prerollGate) this.ctx.videoEl.addEventListener('play', () => this.fireInitialRequest(), { once: true });
    }

    private fireInitialRequest(): void {
        this.visibilityObserver?.disconnect();
        this.visibilityObserver = null;
        if (this.initialRequestFired) return;
        this.initialRequestFired = true;
        this.prerollRequestedAt = Date.now();
        if (this.options.adTagPreroll) {
            this.requestAd('Preroll', this.options.adTagPreroll);
        } else if (this.options.adTagVmap) {
            // Ayrı bir preroll tag'i yok — VMAP tek başına (preroll dahil) kullanılıyor.
            this.vmapRequested = true;
            this.requestAd('Preroll', this.options.adTagVmap, 0, true);
        }
    }

    /** Playlist/story item değişiminde: önceki item'ın reklam durumunu sıfırla. */
    resetForNewItem(newPrerollTag?: string | string[]): void {
        this.retry.reset();
        this.vmapRequested = false;
        this.postrollShown = false;
        this.postrollPending = false;
        this.lastMidrollTime = 0;
        this.prerollAbandoned = false;
        this.prerollStartPending = false;
        if (newPrerollTag !== undefined) this.options.adTagPreroll = newPrerollTag;
        // Yeni öğe kullanıcı etkileşimiyle (playlist / story) geldiği için reklam hemen istenir.
        this.initialRequestFired = true;
        this.prerollRequestedAt = Date.now();

        if (this.options.adTagPreroll) {
            void this.requestAd('Preroll', this.options.adTagPreroll);
        } else if (this.options.adTagVmap) {
            this.vmapRequested = true;
            void this.requestAd('Preroll', this.options.adTagVmap, 0, true);
        }
    }

    destroy(): void {
        if (this.ctx.prerollGate) {
            this.ctx.prerollGate.onPlayIntent = null;
            this.ctx.prerollGate.onTimeout = null;
            this.ctx.prerollGate.release(false);
        }
        this.visibilityObserver?.disconnect();
        this.visibilityObserver = null;
        this.stopAdProgress();
        this.ctx.videoEl.removeEventListener('play', this.initializeDisplayContainerOnce);
        this.ctx.videoEl.removeEventListener('ended', this.onContentEnded);
        this.ctx.videoEl.removeEventListener('timeupdate', this.onTimeUpdateForMidroll);
        this.surfaceGuard?.destroy();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        cancelAnimationFrame(this.resizeFrame);
        this.retry.cancelPending();
        this.adsManager?.destroy();
        this.adsLoader?.destroy();
        this.adDisplayContainer?.destroy();
        this.scte35Manager?.destroy();
        if (this.scte35BreakTimeout) clearTimeout(this.scte35BreakTimeout);
    }

    /** SCTE-35 OUT sinyali: IMA'ya reklam iste (normal midroll gibi) + IMA cevap vermezse N ms sonra vazgeç. */
    private onScte35AdBreakStart(_duration: number | null): void {
        this.scte35BreakActive = true;
        this.requestAd('Midroll', this.options.live!.adTagLive!);

        const timeoutMs = this.options.live?.breakTimeoutMs ?? 10000;
        if (this.scte35BreakTimeout) clearTimeout(this.scte35BreakTimeout);
        this.scte35BreakTimeout = setTimeout(() => {
            // Ad gerçekten başladıysa (onContentPauseRequested) bu timer zaten iptal edilmiş olur.
            this.endScte35Break();
        }, timeoutMs);
    }

    /** SCTE-35 IN sinyali: yayıncının sinyaline güvenilir — reklam hâlâ oynuyor olsa bile içeriğe dönülür. */
    private onScte35AdBreakEnd(): void {
        this.endScte35Break();
    }

    private endScte35Break(): void {
        if (!this.scte35BreakActive) return;
        this.scte35BreakActive = false;
        if (this.scte35BreakTimeout) {
            clearTimeout(this.scte35BreakTimeout);
            this.scte35BreakTimeout = null;
        }
        this.adsManager?.destroy();
        this.adsManager = null;
        this.hideAdLayer();
        if (this.ctx.videoEl.paused) this.ctx.videoEl.play().catch(() => {});
    }

    /**
     * initialize() yalnızca 'play'e değil, player'a ilk dokunuşa da bağlı: preroll kullanıcı oynatmadan
     * adsManager.start()'a ulaşabiliyor ve initialize() önce çağrılmazsa IMA AdError 400 veriyor.
     */
    readonly initializeDisplayContainerOnce = (): void => {
        if (this.displayContainerInitialized) return;
        this.displayContainerInitialized = true;
        this.adDisplayContainer?.initialize();
    };

    private readonly onTimeUpdateForMidroll = (): void => {
        const interval = this.options.midrollIntervalSeconds ?? 0;
        if (interval <= 0 || !this.options.adTagMidroll) return;
        // iosFullscreen: 'defer' — tam ekran / PiP'ten çıkılana kadar beklet; çıkınca ilk timeupdate'te istenir.
        if (this.options.iosFullscreen === 'defer' && this.surfaceGuard?.current()) return;
        const currentTime = this.ctx.videoEl.currentTime;
        if (currentTime > 60 && currentTime - this.lastMidrollTime >= interval) {
            this.lastMidrollTime = currentTime;
            this.requestAd('Midroll', this.options.adTagMidroll);
        }
    };

    private readonly onContentEnded = (): void => {
        if (this.postrollShown) return;
        // IMA'ya içerik bitti: VMAP'teki postroll (-1 noktası) bununla başlar; tek VAST postroll'u ayrıca istenir.
        if (this.options.adTagVmap) {
            this.postrollShown = true;
            this.adsLoader?.contentComplete();
            return;
        }
        if (!this.options.adTagPostroll) return;
        this.postrollPending = true;
        this.postrollShown = true;
        this.requestAd('Postroll', this.options.adTagPostroll);
    };

    /** Preroll: options.prebid, Midroll: options.prebid.midroll. Postroll'da prebid yok. */
    private getPrebidConfigFor(type: AdBreakType): PrebidBreakOptions | null {
        const prebid = this.options.prebid;
        if (!prebid) return null;
        if (type === 'Preroll') return prebid.enabled ? prebid : null;
        if (type === 'Midroll') return prebid.midroll?.enabled ? { ...prebid, ...prebid.midroll } : null;
        return null;
    }

    private async getOrCreatePrebidInstance(type: AdBreakType, config: PrebidBreakOptions): Promise<VideoPrebid> {
        const existing = this.prebidInstances[type];
        if (existing) return existing;

        const { VideoPrebid: VideoPrebidClass } = await import('../prebid/VideoPrebid');
        const defaultCode = type === 'Midroll' ? 'hope-video-midroll' : 'hope-video-preroll';
        const instance = new VideoPrebidClass({
            ...config,
            adUnitCode: `${config.adUnitCode || defaultCode}-${this.prebidIdSuffix}`,
            consentManagement: this.options.prebid?.consentManagement,
        });
        this.prebidInstances[type] = instance;
        return instance;
    }

    private async requestAd(type: AdBreakType, rawTag: string | string[], attempt = 0, skipUrlProcessing = false): Promise<void> {
        if (!this.adsLoader || !this.ima) return;
        this.currentBreakType = type;
        this.lastRequestIsVmap = skipUrlProcessing;

        const tag = Array.isArray(rawTag) ? rawTag[0]! : rawTag;
        let vastUrl = skipUrlProcessing
            ? tag
            : generateVastUrl(tag, { includeRefreshCount: !!this.options.retry?.enabled, adRefreshCount: attempt });

        // Prebid yalnızca ham VAST tag'lerinde ve ilk denemede; retry'da auction tekrarlanmaz.
        if (!skipUrlProcessing && attempt === 0) {
            const prebidConfig = this.getPrebidConfigFor(type);
            if (prebidConfig) {
                const instance = await this.getOrCreatePrebidInstance(type, prebidConfig);
                if (instance.isAvailable()) {
                    vastUrl = await instance.runAuction(vastUrl);
                }
            }
        }

        if (!this.adsLoader || !this.ima) return; // await sırasında destroy() olmuş olabilir

        const request = new this.ima.AdsRequest();
        request.adTagUrl = vastUrl;
        request.linearAdSlotWidth = this.ctx.videoEl.clientWidth || 640;
        request.linearAdSlotHeight = this.ctx.videoEl.clientHeight || 360;
        // Overlay (non-linear) reklam yuvası: tam genişlik, yüksekliğin üçte biri — verilmezse overlay creative seçilemiyor.
        request.nonLinearAdSlotWidth = this.ctx.videoEl.clientWidth || 640;
        request.nonLinearAdSlotHeight = Math.round((this.ctx.videoEl.clientHeight || 360) / 3);
        // Uzun wrapper zincirlerinde SDK'nın 5000ms varsayılanı yetmeyebilir.
        request.vastLoadTimeout = this.options.vastLoadTimeoutMs ?? 10000;
        // Reklam sunucusu otomatik / sessiz oynatmaya uygun creative'i seçsin (Google doğru dolum için bunu istiyor).
        try {
            request.setAdWillAutoPlay?.(this.ctx.videoEl.autoplay || !!this.ctx.prerollGate?.hasPlayIntent || !this.ctx.videoEl.paused);
            request.setAdWillPlayMuted?.(this.ctx.videoEl.muted);
            request.setContinuousPlayback?.(!!this.ctx.isContinuousPlayback?.());
        } catch {
            /* eski SDK sürümünde olmayabilir */
        }
        const omid = this.omidRules();
        if (omid) request.omidAccessModeRules = omid;

        try {
            this.adsLoader.requestAds(request);
        } catch (err) {
            this.giveUpOrRetry(type, String(err));
        }
    }

    /**
     * Open Measurement erişim kuralları: her ölçüm firması için mod (varsayılan 'full').
     * IMA'nın enum'ları yoksa (eski SDK) hiçbir şey ayarlanmaz — IMA kendi varsayılanını kullanır.
     */
    private omidRules(): Record<string, string> | null {
        const vendors = this.ima?.OmidVerificationVendor;
        const modes = this.ima?.OmidAccessMode;
        if (!vendors || !modes) return null;
        const cfg = this.options.omidAccessMode ?? 'full';
        const toMode = (m: string | undefined): string | undefined =>
            m === 'full' ? modes.FULL : m === 'domain' ? modes.DOMAIN : m === 'limited' ? modes.LIMITED : undefined;
        const perVendor: Record<string, string | undefined> = typeof cfg === 'string' ? {} : cfg;
        const fallback = toMode(typeof cfg === 'string' ? cfg : (cfg.default ?? 'full')) ?? modes.FULL;
        const rules: Record<string, string> = {};
        for (const [name, id] of Object.entries(vendors)) {
            if (typeof id === 'number') rules[id] = toMode(perVendor[name]) ?? fallback;
        }
        return rules;
    }

    private readonly onAdsManagerLoaded = (event: google.ima.AdsManagerLoadedEvent): void => {
        if (!this.ima) return;
        const isPreroll = this.currentBreakType === 'Preroll';
        // Zaman aşımından sonra gelen preroll gösterilmez — içerik çoktan başladı; araya girmesin.
        if (isPreroll && this.prerollAbandoned) {
            event.getAdsManager(this.ctx.videoEl).destroy();
            return;
        }
        this.adsManager = event.getAdsManager(this.ctx.videoEl, {
            restoreCustomPlaybackStateOnAdBreakComplete: true,
            // VAST çözüldükten sonra creative'in yüklenmesi için üst sınır.
            loadVideoTimeout: this.options.loadVideoTimeoutMs ?? 10000,
            enablePreloading: true,
            // false: IMA'nın KENDİ styled linear ad UI'ı (skip/sayaç
            // kutusu) yerine bizim ControlBar'ımız (ad mode) kullanılıyor —
            // ikisi üst üste binmesin diye.
            useStyledLinearAds: false,
            useStyledNonLinearAds: true,
        });

        const AdEvent = this.ima.AdEvent;
        this.adsManager.addEventListener(AdEvent.Type.CONTENT_PAUSE_REQUESTED, this.onContentPauseRequested);
        this.adsManager.addEventListener(AdEvent.Type.CONTENT_RESUME_REQUESTED, this.onContentResumeRequested);
        this.adsManager.addEventListener(AdEvent.Type.ALL_ADS_COMPLETED, this.onAllAdsCompleted);
        this.adsManager.addEventListener(AdEvent.Type.LOADED, this.onAdLoaded);
        this.adsManager.addEventListener(AdEvent.Type.STARTED, this.onAdStarted);
        this.adsManager.addEventListener(AdEvent.Type.COMPLETE, this.stopAdProgress);
        this.adsManager.addEventListener(AdEvent.Type.SKIPPED, this.stopAdProgress);
        if (AdEvent.Type.USER_CLOSE) this.adsManager.addEventListener(AdEvent.Type.USER_CLOSE, this.endNonLinear);
        this.adsManager.addEventListener(this.ima.AdErrorEvent.Type.AD_ERROR, this.onAdsManagerError);
        // IMA'nın KENDİ reklam UI'ı üzerinden (ör. reklam video'suna tıklama)
        // de duraklatılabilir/devam ettirilebilir — bizim toolbar'ımızın
        // ikonu bu durumda da senkron kalsın diye dinleniyor.
        this.adsManager.addEventListener(AdEvent.Type.PAUSED, this.onAdPaused);
        this.adsManager.addEventListener(AdEvent.Type.RESUMED, this.onAdResumed);

        const gate = this.ctx.prerollGate;
        if (isPreroll && gate?.isArmed) {
            // Yalnızca VMAP: 0 noktasında reklam yoksa preroll yok — içerik beklemesin, aralar normal zamanlanır.
            const cuePoints = this.adsManager.getCuePoints?.() ?? [];
            if (cuePoints.length > 0 && !cuePoints.includes(0)) {
                gate.release(true);
                this.startAdsManager();
                return;
            }
            if (!gate.hasPlayIntent) {
                // Reklam hazır; içerik oynatılmak istenince (onPrerollPlayIntent) anında başlar.
                this.prerollStartPending = true;
                return;
            }
        }
        this.startAdsManager();
    };

    private startAdsManager(): void {
        if (!this.adsManager || !this.ima) return;
        try {
            this.adsManager.init(this.ctx.videoEl.clientWidth || 640, this.ctx.videoEl.clientHeight || 360, this.viewMode());
            this.adsManager.start();
        } catch (err) {
            this.giveUpOrRetry(this.currentBreakType, String(err));
        }
    }

    /** Preroll kapısında ilk oynatma isteği: IMA'yı kullanıcı jestiyle hazırla, hazır bekleyen preroll'u başlat. */
    private readonly onPrerollPlayIntent = (): void => {
        this.initializeDisplayContainerOnce();
        // Henüz istenmedi ('play' modu ya da görünüme gelmeden programatik play()) — şimdi iste.
        if (!this.initialRequestFired) {
            this.fireInitialRequest();
            return;
        }
        if (!this.prerollStartPending) return;
        this.prerollStartPending = false;
        // Hazırdaki reklam çok eskiyse (teklif / VAST bayatlamış olabilir) at ve taze iste — kapı bekler.
        if (Date.now() - this.prerollRequestedAt > PREROLL_MAX_AGE_MS) {
            this.adsManager?.destroy();
            this.adsManager = null;
            this.initialRequestFired = false;
            this.vmapRequested = false;
            this.fireInitialRequest();
            return;
        }
        this.startAdsManager();
    };

    /** Preroll süresinde gelmedi: bekleyen istekleri bırak, içerik reklamsız başlasın (kapı kendisi açılır). */
    private readonly onPrerollTimeout = (): void => {
        this.prerollAbandoned = true;
        this.prerollStartPending = false;
        this.retry.cancelPending();
        if (this.currentBreakType === 'Preroll') {
            this.adsManager?.destroy();
            this.adsManager = null;
        }
        const timeoutMs = this.options.prerollTimeoutMs ?? 8000;
        this.ctx.log?.({ message: `Preroll did not arrive within ${timeoutMs} ms — content started without it`, details: { prerollTimeoutMs: timeoutMs } });
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:aderror', { detail: { message: 'preroll-timeout', breakType: 'preroll' } }));
        // VMAP split: preroll'dan vazgeçildi — VMAP (midroll/postroll) yine bir kez istenir.
        this.maybeRequestVmapAfterPreroll();
    };

    /** Toolbar'daki oynat/duraklat butonunun (reklam modunda) hedefi — content videoEl yerine bu çağrılır. */
    toggleAdPlayPause(): void {
        if (!this.adsManager) return;
        if (this.adPaused) this.adsManager.resume();
        else this.adsManager.pause();
        // Optimistic: IMA'nın PAUSED/RESUMED event'ini beklemeden ikon hemen
        // güncellensin — event zaten aynı değere ayarlayıp no-op olacak.
        this.adPaused = !this.adPaused;
    }

    isAdPaused(): boolean {
        return this.adPaused;
    }

    getAdVolume(): number {
        return this.adsManager?.getVolume() ?? 1;
    }

    setAdVolume(volume: number): void {
        this.adsManager?.setVolume(Math.min(1, Math.max(0, volume)));
    }

    isAdMuted(): boolean {
        return this.getAdVolume() === 0;
    }

    /** VolumePanel'deki `onToggleMute` ile AYNI desen: 0 ↔ son bilinen (ya da varsayılan 0.5) ses seviyesi arasında geçiş. */
    toggleAdMute(): void {
        if (!this.adsManager) return;
        const current = this.adsManager.getVolume();
        if (current > 0) {
            this.adVolumeBeforeMute = current;
            this.adsManager.setVolume(0);
        } else {
            this.adsManager.setVolume(this.adVolumeBeforeMute > 0 ? this.adVolumeBeforeMute : 0.5);
        }
    }

    private readonly onAdPaused = (): void => {
        this.adPaused = true;
        this.ctx.onAdPlayStateChange?.();
    };

    private readonly onAdResumed = (): void => {
        this.adPaused = false;
        this.ctx.onAdPlayStateChange?.();
    };

    private readonly onContentPauseRequested = (event?: google.ima.AdEvent): void => {
        this.linearBreakActive = true;
        this.activeBreak = this.breakTypeOf(event);
        // Preroll başladı — kapının işi bitti; içerik reklam bitince (CONTENT_RESUME_REQUESTED) başlar.
        if (this.activeBreak === 'preroll') this.ctx.prerollGate?.release(false);
        this.ctx.videoEl.pause();
        this.adPaused = false;
        this.ctx.hideChrome();
        this.ctx.adLayerEl.classList.remove('hp:hidden');
        this.ctx.adLayerEl.classList.add('hp:block');
        // Reklam gerçekten başladı — retry sayaçlarını sıfırla.
        this.retry.reset();
        // SCTE-35 ad gerçekten başladı — güvenlik timeout'una artık gerek yok.
        if (this.scte35BreakActive && this.scte35BreakTimeout) {
            clearTimeout(this.scte35BreakTimeout);
            this.scte35BreakTimeout = null;
        }
        // iPhone native tam ekranı / PiP'te reklam görünmez — önce çık.
        this.surfaceGuard?.onBreakStart();
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adstart', { detail: { type: this.activeBreak } }));
    };

    private readonly onContentResumeRequested = (): void => {
        this.stopAdProgress();
        this.hideAdLayer();
        const finished = this.activeBreak;
        // IMA, preroll'u olmayan VMAP'te başlangıçta da "içeriğe dön" der — başlamamış bir ara için hp:adend gönderme.
        if (this.linearBreakActive) {
            this.linearBreakActive = false;
            this.surfaceGuard?.onBreakEnd(finished !== 'postroll');
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adend', { detail: { type: finished } }));
        }
        // Reklam IMA tarafında doğal yoldan (ALL_ADS_COMPLETED) bitti — SCTE-35
        // IN sinyali hiç gelmemiş olabilir (broadcaster planlanan süreden
        // kısa kesmiş olabilir), bu yüzden flag'i burada da temizliyoruz.
        this.scte35BreakActive = false;

        if (finished === 'preroll') {
            this.maybeRequestVmapAfterPreroll();
        }
        // Postroll'dan sonra play() çağırmak videoyu baştan başlatır — yapma.
        if (finished !== 'postroll') {
            this.ctx.videoEl.play().catch(() => {});
        }
    };

    private readonly onAllAdsCompleted = (): void => {
        this.stopAdProgress();
        this.endNonLinear();
        this.adsManager?.destroy();
        this.adsManager = null;
    };

    /**
     * Overlay (non-linear) reklam yüklendi: içeriği DURDURMAZ (CONTENT_PAUSE_REQUESTED gelmez) — preroll kapısı onu
     * beklerse içerik zaman aşımına kadar bekliyor, overlay de hiç gösterilmiyordu. Kapı hemen açılır, içerik başlar;
     * reklam katmanı içerikle birlikte görünür, kontrol çubuğunun üstünde durur ve yalnızca overlay tıklanabilir.
     */
    private readonly onAdLoaded = (event?: google.ima.AdEvent): void => {
        const ad = event?.getAd?.();
        if (!ad || typeof ad.isLinear !== 'function' || ad.isLinear()) return;
        this.nonLinearActive = true;
        const layer = this.ctx.adLayerEl;
        this.nonLinearCreativeHeight = ad.getHeight?.() || 0;
        layer.setAttribute('data-nonlinear', '');
        layer.classList.remove('hp:hidden');
        layer.classList.add('hp:block');
        this.resizeAd();
        if (this.currentBreakType === 'Preroll') this.ctx.prerollGate?.release(true);
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adstart', { detail: { type: this.breakTypeOf(event), linear: false } }));
    };

    private viewMode(): string {
        const doc = document as Document & { webkitFullscreenElement?: Element | null };
        const host = this.ctx.hostEl;
        const full = document.fullscreenElement === host || doc.webkitFullscreenElement === host;
        return full ? this.ima!.ViewMode.FULLSCREEN : this.ima!.ViewMode.NORMAL;
    }

    /** Boyut değişimleri (ResizeObserver) kare başına bire indirilir — pencere sürüklenirken IMA'yı boğmasın. */
    private readonly scheduleResize = (): void => {
        cancelAnimationFrame(this.resizeFrame);
        this.resizeFrame = requestAnimationFrame(() => this.resizeAd());
    };

    /**
     * Reklamı player'ın şimdiki boyutuna getirir: tam ekrana giriş/çıkış, pencere küçültme, cihaz döndürme.
     * IMA boyutu yalnızca init()'te alır; resize() çağrılmazsa reklam eski boyutunda kalıyordu.
     */
    private resizeAd(): void {
        if (!this.adsManager || !this.ima) return;
        const video = this.ctx.videoEl;
        if (!video.clientWidth || !video.clientHeight) return; // gizli / henüz yerleşmemiş
        try {
            if (this.nonLinearActive) {
                // IMA overlay'i tam boyutlu bir iframe'de çiziyor — katman tüm videoyu kaplarsa tıklamaları yutar. Katman,
                // overlay yüksekliğinde (+ kapatma butonu payı) alttaki bir şeride indirilir; videonun geri kalanı tıklanabilir.
                const layer = this.ctx.adLayerEl;
                const slotHeight = Math.round(video.clientHeight / 3);
                const creativeHeight = this.nonLinearCreativeHeight || slotHeight;
                layer.style.setProperty('--hp-nonlinear-ad-height', `${Math.min(slotHeight + 40, creativeHeight + 24)}px`);
                this.adsManager.resize(layer.clientWidth || video.clientWidth, layer.clientHeight || slotHeight, this.viewMode());
            } else {
                this.adsManager.resize(video.clientWidth, video.clientHeight, this.viewMode());
            }
        } catch {
            /* boyut güncellenemedi — reklam önceki boyutunda kalır */
        }
    }

    /** Overlay kapandı (kullanıcı kapattı / süresi doldu): katman gizlenir. */
    private readonly endNonLinear = (): void => {
        if (!this.nonLinearActive) return;
        this.nonLinearActive = false;
        this.ctx.adLayerEl.removeAttribute('data-nonlinear');
        this.ctx.adLayerEl.style.removeProperty('--hp-nonlinear-ad-height');
        this.ctx.adLayerEl.classList.add('hp:hidden');
        this.ctx.adLayerEl.classList.remove('hp:block');
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adend', { detail: { type: this.activeBreak, linear: false } }));
    };

    private readonly onAdsLoaderError = (event: google.ima.AdErrorEvent): void => {
        this.adsManager?.destroy();
        this.adsManager = null;
        if (this.scte35BreakActive) {
            this.endScte35Break();
            return;
        }
        this.giveUpOrRetry(this.currentBreakType, this.recordAdError(event));
    };

    private readonly onAdsManagerError = (event: google.ima.AdErrorEvent): void => {
        this.stopAdProgress();
        this.adsManager?.destroy();
        this.adsManager = null;
        if (this.scte35BreakActive) {
            this.endScte35Break();
            return;
        }
        this.giveUpOrRetry(this.currentBreakType, this.recordAdError(event));
    };

    /** IMA hatasının kodlarını çıkarır, hata kaydına yazar (yeniden denenecek olsa da) ve mesajı döndürür. */
    private recordAdError(event: google.ima.AdErrorEvent): string {
        const err = event.getError?.();
        const info: AdErrorInfo = {
            message: err?.getMessage?.() ?? 'ad-error',
            code: err?.getErrorCode?.(),
            vastCode: err?.getVastErrorCode?.(),
            errorType: err?.getType?.(),
        };
        // IMA'nın "bilinmiyor" değerleri (-1 / 0) gösterilmez.
        if (info.vastCode !== undefined && info.vastCode <= 0) info.vastCode = undefined;
        this.lastAdError = info;
        this.ctx.log?.({
            message: info.message,
            details: { code: info.code, vastCode: info.vastCode, errorType: info.errorType, break: this.breakTypeLower() },
        });
        return info.message;
    }

    /** Lineer reklam başladı: pod bilgisi + kalan süre toolbar'a (geri sayım). */
    private readonly onAdStarted = (event?: google.ima.AdEvent): void => {
        const ad = event?.getAd?.();
        if (!ad || (typeof ad.isLinear === 'function' && !ad.isLinear())) return;
        try {
            const pod = ad.getAdPodInfo();
            this.podPosition = pod.getAdPosition() || 1;
            this.podTotal = pod.getTotalAds() || 1;
        } catch {
            this.podPosition = 1;
            this.podTotal = 1;
        }
        this.stopAdProgress();
        this.reportAdProgress();
        this.progressTimer = setInterval(this.reportAdProgress, AD_PROGRESS_INTERVAL_MS);
    };

    private readonly reportAdProgress = (): void => {
        const remaining = this.adsManager?.getRemainingTime() ?? -1;
        this.ctx.onAdProgress?.({ remaining, position: this.podPosition, total: this.podTotal });
    };

    private readonly stopAdProgress = (): void => {
        if (this.progressTimer) clearInterval(this.progressTimer);
        this.progressTimer = null;
        this.ctx.onAdProgress?.(null);
    };

    private giveUpOrRetry(type: AdBreakType, message?: string): void {
        // Zaman aşımında zaten vazgeçildi (hp:aderror gönderildi) — geç gelen hata için yeniden deneme / ikinci olay yok.
        if (type === 'Preroll' && this.prerollAbandoned) return;
        // Canlı + SCTE-35: yayıncının OUT/IN sinyaline güveniliyor, normal
        // preroll/midroll fallback zinciri/retry'ı kullanılmıyor.
        if (this.scte35BreakActive) {
            this.endScte35Break();
            return;
        }
        const rawTag = tagConfigFor(this.options, type);
        if (!rawTag) {
            this.resumeContentAfterGiveUp(type, message);
            return;
        }
        this.retry.retry(
            type,
            rawTag,
            (tag, attempt) => this.requestAd(type, tag, attempt),
            () => this.resumeContentAfterGiveUp(type, message)
        );
    }

    private resumeContentAfterGiveUp(type: AdBreakType, message?: string): void {
        this.hideAdLayer();
        const last = this.lastAdError;
        this.lastAdError = null;
        this.ctx.hostEl.dispatchEvent(
            new CustomEvent('hp:aderror', {
                detail: {
                    message: message ?? last?.message ?? 'ad-error',
                    code: last?.code,
                    vastCode: last?.vastCode,
                    errorType: last?.errorType,
                    breakType: type.toLowerCase() as 'preroll' | 'midroll' | 'postroll',
                },
            })
        );
        if (type === 'Preroll') this.maybeRequestVmapAfterPreroll();
        const gate = this.ctx.prerollGate;
        if (type === 'Preroll' && gate?.isArmed) {
            // Kapı: içerik yalnızca oynatılmak istendiyse başlar (kullanıcı henüz play'e basmadıysa kendiliğinden başlamaz).
            gate.release(true);
            return;
        }
        if (type !== 'Postroll' && this.ctx.videoEl.paused) {
            this.ctx.videoEl.play().catch(() => {});
        }
    }

    /** VMAP split: preroll (başarılı ya da vazgeçilerek) bitince, VMAP TAM OLARAK BİR KEZ, değiştirilmeden istenir. */
    private maybeRequestVmapAfterPreroll(): void {
        if (this.vmapRequested || !this.options.adTagVmap) return;
        this.vmapRequested = true;
        this.requestAd('Midroll', this.options.adTagVmap, 0, true);
    }

    private hideAdLayer(): void {
        // Overlay reklam hâlâ ekrandaysa (ör. genişleyen VPAID overlay'i kapandı) katman açık kalır.
        if (!this.nonLinearActive) {
            this.ctx.adLayerEl.classList.add('hp:hidden');
            this.ctx.adLayerEl.classList.remove('hp:block');
        }
        this.ctx.showChrome();
    }

    /**
     * Başlayan aranın gerçek tipi. VMAP tek istekle preroll + midroll + postroll getirir; isteğin tipi (currentBreakType)
     * yalnızca ilk arayı anlatır — midroll'lar "preroll" diye bildiriliyor, VMAP postroll'undan sonra video baştan
     * başlıyordu. IMA reklamın arasındaki konumu verir: 0 preroll, -1 postroll, diğerleri midroll.
     */
    private breakTypeOf(event?: google.ima.AdEvent): 'preroll' | 'midroll' | 'postroll' {
        // Tek VAST reklamında konum 0 dönebilir (ör. 60. saniyede istenen midroll) — yalnızca VMAP'te güvenilir.
        if (!this.lastRequestIsVmap) return this.breakTypeLower();
        try {
            const offset = event?.getAd?.()?.getAdPodInfo?.()?.getTimeOffset?.();
            if (typeof offset === 'number') return offset === 0 ? 'preroll' : offset < 0 ? 'postroll' : 'midroll';
        } catch {
            /* reklam bilgisi yok — istek tipine düş */
        }
        return this.breakTypeLower();
    }

    private breakTypeLower(): 'preroll' | 'midroll' | 'postroll' {
        return this.currentBreakType.toLowerCase() as 'preroll' | 'midroll' | 'postroll';
    }
}
