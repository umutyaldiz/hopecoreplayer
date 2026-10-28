import { loadImaSdk } from './loadImaSdk';
import { generateVastUrl } from './generateVastUrl';
import { RetryController, type AdBreakType } from './RetryController';
import { initConsentAware } from './consent';
import { Scte35LiveAdManager } from './scte35';
import type { AdsOptions, PrebidBreakOptions } from '../../types';
import type { VideoPrebid } from '../prebid/VideoPrebid';

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
}

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

    constructor(
        private readonly ctx: AdsPlayerContext,
        readonly options: AdsOptions
    ) {
        this.retry = new RetryController(options.retry ?? {});
        this.prebidIdSuffix = ctx.hostEl.id || Math.random().toString(36).slice(2, 8);
    }

    async install(): Promise<void> {
        let ima: typeof google.ima;
        try {
            ima = await loadImaSdk();
        } catch (err) {
            // Reklam engelleyici / ağ hatası — içerik reklamsız normal oynar.
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:aderror', { detail: { message: String(err) } }));
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
        if (!this.ctx.videoEl.paused || hasPageLevelUserActivation) {
            this.initializeDisplayContainerOnce();
        }

        if (this.options.adTagPostroll) {
            this.ctx.videoEl.addEventListener('ended', this.onContentEnded);
        }

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

    /** requestOnPlay yoksa preroll/VMAP hemen istenir; varsa kullanıcı oynatana kadar ertelenir. */
    private requestInitialPrerollOrVmap(): void {
        const fire = (): void => {
            if (this.options.adTagPreroll) {
                this.requestAd('Preroll', this.options.adTagPreroll);
            } else if (this.options.adTagVmap) {
                // Ayrı bir preroll tag'i yok — VMAP tek başına (preroll dahil) kullanılıyor.
                this.vmapRequested = true;
                this.requestAd('Preroll', this.options.adTagVmap, 0, true);
            }
        };
        if (!this.options.requestOnPlay || !this.ctx.videoEl.paused) {
            fire();
            return;
        }
        this.ctx.videoEl.addEventListener('play', fire, { once: true });
    }

    /** Playlist/story item değişiminde: önceki item'ın reklam durumunu sıfırla. */
    resetForNewItem(newPrerollTag?: string | string[]): void {
        this.retry.reset();
        this.vmapRequested = false;
        this.postrollShown = false;
        this.postrollPending = false;
        this.lastMidrollTime = 0;
        if (newPrerollTag !== undefined) this.options.adTagPreroll = newPrerollTag;

        if (this.options.adTagPreroll) {
            void this.requestAd('Preroll', this.options.adTagPreroll);
        } else if (this.options.adTagVmap) {
            this.vmapRequested = true;
            void this.requestAd('Preroll', this.options.adTagVmap, 0, true);
        }
    }

    destroy(): void {
        this.ctx.videoEl.removeEventListener('play', this.initializeDisplayContainerOnce);
        this.ctx.videoEl.removeEventListener('ended', this.onContentEnded);
        this.ctx.videoEl.removeEventListener('timeupdate', this.onTimeUpdateForMidroll);
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
        const currentTime = this.ctx.videoEl.currentTime;
        if (currentTime > 60 && currentTime - this.lastMidrollTime >= interval) {
            this.lastMidrollTime = currentTime;
            this.requestAd('Midroll', this.options.adTagMidroll);
        }
    };

    private readonly onContentEnded = (): void => {
        if (this.postrollShown || !this.options.adTagPostroll) return;
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
        // Uzun wrapper zincirlerinde SDK'nın 5000ms varsayılanı yetmeyebilir.
        request.vastLoadTimeout = this.options.vastLoadTimeoutMs ?? 10000;

        try {
            this.adsLoader.requestAds(request);
        } catch (err) {
            this.giveUpOrRetry(type, String(err));
        }
    }

    private readonly onAdsManagerLoaded = (event: google.ima.AdsManagerLoadedEvent): void => {
        if (!this.ima) return;
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
        this.adsManager.addEventListener(this.ima.AdErrorEvent.Type.AD_ERROR, this.onAdsManagerError);
        // IMA'nın KENDİ reklam UI'ı üzerinden (ör. reklam video'suna tıklama)
        // de duraklatılabilir/devam ettirilebilir — bizim toolbar'ımızın
        // ikonu bu durumda da senkron kalsın diye dinleniyor.
        this.adsManager.addEventListener(AdEvent.Type.PAUSED, this.onAdPaused);
        this.adsManager.addEventListener(AdEvent.Type.RESUMED, this.onAdResumed);

        try {
            this.adsManager.init(this.ctx.videoEl.clientWidth || 640, this.ctx.videoEl.clientHeight || 360, this.ima.ViewMode.NORMAL);
            this.adsManager.start();
        } catch (err) {
            this.giveUpOrRetry(this.currentBreakType, String(err));
        }
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

    private readonly onContentPauseRequested = (): void => {
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
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adstart', { detail: { type: this.breakTypeLower() } }));
    };

    private readonly onContentResumeRequested = (): void => {
        this.hideAdLayer();
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adend', { detail: { type: this.breakTypeLower() } }));
        // Reklam IMA tarafında doğal yoldan (ALL_ADS_COMPLETED) bitti — SCTE-35
        // IN sinyali hiç gelmemiş olabilir (broadcaster planlanan süreden
        // kısa kesmiş olabilir), bu yüzden flag'i burada da temizliyoruz.
        this.scte35BreakActive = false;

        if (this.currentBreakType === 'Preroll') {
            this.maybeRequestVmapAfterPreroll();
        }
        // Postroll'dan sonra play() çağırmak videoyu baştan başlatır — yapma.
        if (this.currentBreakType !== 'Postroll') {
            this.ctx.videoEl.play().catch(() => {});
        }
    };

    private readonly onAllAdsCompleted = (): void => {
        this.adsManager?.destroy();
        this.adsManager = null;
    };

    private readonly onAdsLoaderError = (event: google.ima.AdErrorEvent): void => {
        this.adsManager?.destroy();
        this.adsManager = null;
        if (this.scte35BreakActive) {
            this.endScte35Break();
            return;
        }
        this.giveUpOrRetry(this.currentBreakType, event.getError?.()?.getMessage?.());
    };

    private readonly onAdsManagerError = (event: google.ima.AdErrorEvent): void => {
        this.adsManager?.destroy();
        this.adsManager = null;
        if (this.scte35BreakActive) {
            this.endScte35Break();
            return;
        }
        this.giveUpOrRetry(this.currentBreakType, event.getError?.()?.getMessage?.());
    };

    private giveUpOrRetry(type: AdBreakType, message?: string): void {
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
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:aderror', { detail: { message: message ?? 'ad-error' } }));
        if (type === 'Preroll') this.maybeRequestVmapAfterPreroll();
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
        this.ctx.adLayerEl.classList.add('hp:hidden');
        this.ctx.adLayerEl.classList.remove('hp:block');
        this.ctx.showChrome();
    }

    private breakTypeLower(): 'preroll' | 'midroll' | 'postroll' {
        return this.currentBreakType.toLowerCase() as 'preroll' | 'midroll' | 'postroll';
    }
}
