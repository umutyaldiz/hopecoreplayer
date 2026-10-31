/** Google IMA SDK için minimal ambient tipler (yalnızca kullanılan yüzey). */
declare namespace google.ima {
    class AdDisplayContainer {
        constructor(containerEl: Element, videoEl?: HTMLMediaElement);
        initialize(): void;
        destroy(): void;
    }

    class AdsLoader {
        constructor(adDisplayContainer: AdDisplayContainer);
        addEventListener(type: string, listener: (event: any) => void): void;
        requestAds(request: AdsRequest): void;
        contentComplete(): void;
        destroy(): void;
    }

    class AdsRequest {
        adTagUrl: string;
        linearAdSlotWidth?: number;
        linearAdSlotHeight?: number;
        nonLinearAdSlotWidth?: number;
        nonLinearAdSlotHeight?: number;
        /** VAST/wrapper zincirinin TAMAMEN çözülmesi için üst sınır (ms). */
        vastLoadTimeout?: number;
        setAdWillAutoPlay?(autoPlay: boolean): void;
        setAdWillPlayMuted?(muted: boolean): void;
        /** İçerik TV gibi art arda otomatik oynuyor mu (playlist / story) — reklam alıcılarına envanter tipi sinyali (vconp). */
        setContinuousPlayback?(continuous: boolean): void;
        /** Open Measurement: ölçüm firması (OmidVerificationVendor) → erişim modu (OmidAccessMode). */
        omidAccessModeRules?: Record<string, string>;
    }

    class AdsManager {
        addEventListener(type: string, listener: (event: any) => void): void;
        init(width: number, height: number, viewMode: string): void;
        start(): void;
        resize(width: number, height: number, viewMode: string): void;
        destroy(): void;
        pause(): void;
        resume(): void;
        getRemainingTime(): number;
        /** 0 (sessiz) – 1 (tam ses) arası. */
        setVolume(volume: number): void;
        getVolume(): number;
        /** VMAP'teki reklam aralarının zamanları (sn) — 0 preroll, -1 postroll. */
        getCuePoints?(): number[];
    }

    class AdsManagerLoadedEvent {
        static Type: { ADS_MANAGER_LOADED: string };
        getAdsManager(videoEl: HTMLMediaElement, settings?: Record<string, unknown>): AdsManager;
    }

    class AdError {
        getMessage(): string;
        getErrorCode(): number;
        /** VAST spesifikasyonundaki hata numarası (ör. 303 boş VAST, 402 medya zaman aşımı). */
        getVastErrorCode?(): number;
        /** 'adLoadError' | 'adPlayError' */
        getType?(): string;
    }

    class AdErrorEvent {
        static Type: { AD_ERROR: string };
        getError(): AdError;
    }

    class Ad {
        getAdPodInfo(): { getAdPosition(): number; getTotalAds(): number; getPodIndex(): number; getTimeOffset?(): number };
        /** false: overlay (non-linear) reklam — içeriği durdurmaz, içerik oynarken üstünde gösterilir. */
        isLinear?(): boolean;
        /** Seçilen overlay (non-linear) creative'in yüksekliği (px). */
        getHeight?(): number;
        /** Seçilen creative'in MIME tipi (ör. 'video/mp4', 'audio/mpeg'). */
        getContentType?(): string;
    }

    class AdEvent {
        static Type: {
            CONTENT_PAUSE_REQUESTED: string;
            CONTENT_RESUME_REQUESTED: string;
            LOADED: string;
            STARTED: string;
            COMPLETE: string;
            ALL_ADS_COMPLETED: string;
            USER_CLOSE?: string;
            SKIPPED: string;
            CLICK: string;
            /** Toolbar'daki oynat/duraklat butonuyla (adsManager.pause()/resume()) tetiklenir; ayrıca IMA'nın KENDİ reklam UI'ı (ör. reklam video'suna tıklama) üzerinden de gelebilir — ikisini senkron tutmak için dinleniyor. */
            PAUSED: string;
            RESUMED: string;
        };
        getAd(): Ad | null;
    }

    const ViewMode: { NORMAL: string; FULLSCREEN: string };

    /** Open Measurement erişim modları: 'limited' | 'domain' | 'full'. */
    const OmidAccessMode: { LIMITED: string; DOMAIN: string; FULL: string } | undefined;
    /** Ölçüm firmaları (GOOGLE, DOUBLEVERIFY, INTEGRAL_AD_SCIENCE, MOAT, ... OTHER) → sayısal kimlik. */
    const OmidVerificationVendor: Record<string, number> | undefined;

    const ImaSdkSettings: {
        VpaidMode: { DISABLED: number; ENABLED: number; INSECURE: number };
    };

    const settings: {
        setLocale(locale: string): void;
        setPpid(ppid: string): void;
        setDisableCustomPlaybackForIOS10Plus(disable: boolean): void;
        setVpaidMode(mode: number): void;
        setPrivacySettings(settings: { nonPersonalizedAds?: boolean }): void;
        /** VAST'ın takip edeceği maksimum WRAPPER (redirect) sayısı — SDK varsayılanı 4. */
        setNumRedirects(numRedirects: number): void;
        /** Deneysel IMA özellikleri — ör. ses reklamı görseli (audioPosterImageEnabled / audioPosterImageDefaultUrl). */
        setFeatureFlags?(flags: Record<string, unknown>): void;
    };
}
