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
    }

    class AdsManagerLoadedEvent {
        static Type: { ADS_MANAGER_LOADED: string };
        getAdsManager(videoEl: HTMLMediaElement, settings?: Record<string, unknown>): AdsManager;
    }

    class AdError {
        getMessage(): string;
        getErrorCode(): number;
    }

    class AdErrorEvent {
        static Type: { AD_ERROR: string };
        getError(): AdError;
    }

    class Ad {
        getAdPodInfo(): { getAdPosition(): number; getTotalAds(): number; getPodIndex(): number };
    }

    class AdEvent {
        static Type: {
            CONTENT_PAUSE_REQUESTED: string;
            CONTENT_RESUME_REQUESTED: string;
            LOADED: string;
            STARTED: string;
            COMPLETE: string;
            ALL_ADS_COMPLETED: string;
            SKIPPED: string;
            CLICK: string;
            /** Toolbar'daki oynat/duraklat butonuyla (adsManager.pause()/resume()) tetiklenir; ayrıca IMA'nın KENDİ reklam UI'ı (ör. reklam video'suna tıklama) üzerinden de gelebilir — ikisini senkron tutmak için dinleniyor. */
            PAUSED: string;
            RESUMED: string;
        };
        getAd(): Ad | null;
    }

    const ViewMode: { NORMAL: string; FULLSCREEN: string };

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
    };
}
