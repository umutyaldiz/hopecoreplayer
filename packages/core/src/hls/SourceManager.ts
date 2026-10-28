
/**
 * MP4: HTML5 video üzerinden doğrudan oynatılır.
 * M3U8: Safari/iOS'ta native HLS; diğer tarayıcılarda gerektiğinde hls.js.
 */
export interface HlsQualityLevel {
    index: number;
    height: number;
    bitrate: number;
}

type HlsModule = typeof import('hls.js');
type HlsInstance = InstanceType<HlsModule['default']>;

type MediaSourceType = 'hls' | 'mp4' | 'unknown';

/** Hangi yoldan oynatılıyor — `reason` native'e neden düşüldüğünü açıklar (ör. CORS). */
export interface PlaybackEngineInfo {
    engine: 'native' | 'native-hls' | 'hls.js';
    reason?: 'apple-native' | 'no-mse' | 'hlsjs-failed';
}

/**
 * Safari (macOS) ve iOS/iPadOS'ta native HLS tercih edilir (AirPlay, pil, iPhone video tam ekranı).
 * Diğerlerinde (Chrome artık native HLS'e "maybe" diyor) hls.js — native oynatıcı kalite seviyelerini vermez.
 */
function prefersNativeHls(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    const iOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /^((?!chrome|chromium|android|crios|fxios|edg|opr).)*safari/i.test(ua);
    return iOS || safari;
}

function hasMse(): boolean {
    const w = window as unknown as { MediaSource?: unknown; ManagedMediaSource?: unknown };
    return typeof w.MediaSource !== 'undefined' || typeof w.ManagedMediaSource !== 'undefined';
}

/**
 * Kaynak türünü MIME type veya URL uzantısından belirler.
 * URL'deki query string ve fragment değerlerini de destekler.
 */
function detectSourceType(src: string, type?: string): MediaSourceType {
    const normalizedType = type
        ?.split(';')[0]
        ?.trim()
        .toLowerCase();

    // HLS / M3U8
    if (
        normalizedType === 'application/vnd.apple.mpegurl' ||
        normalizedType === 'application/x-mpegurl' ||
        /\.m3u8(?:$|[?#])/i.test(src)
    ) {
        return 'hls';
    }

    // MP4
    if (
        normalizedType === 'video/mp4' ||
        /\.mp4(?:$|[?#])/i.test(src)
    ) {
        return 'mp4';
    }

    return 'unknown';
}

export class SourceManager {
    private hls: HlsInstance | null = null;

    private readonly video: HTMLVideoElement;

    /** Son yüklenen kaynak — `reload()` (hata ekranındaki "Tekrar dene") için. */
    private last: { src: string; type?: string } | null = null;
    /** Native HLS denemesi sürerken (ilk loadedmetadata'ya kadar) — başarısız olursa hls.js'e geçilir. */
    private nativeHlsProbe: (() => void) | null = null;
    private engineInfo: PlaybackEngineInfo = { engine: 'native' };

    private readonly onLevelsChanged: (
        levels: HlsQualityLevel[],
        activeIndex: number
    ) => void;

    constructor(
        video: HTMLVideoElement,
        onLevelsChanged: (
            levels: HlsQualityLevel[],
            activeIndex: number
        ) => void
    ) {
        this.video = video;
        this.onLevelsChanged = onLevelsChanged;
    }

    async load(src: string, type?: string): Promise<void> {
        this.last = { src, type };
        // Önce önceki HLS instance'ını kapat (hls.js kendi blob kaynağını media'dan ayırır).
        this.destroy();
        this.video.pause();
        // Kaynağı boşaltıp load() ÇAĞIRMA: Safari/iOS kaynaksız load()'da MEDIA_ERR_SRC_NOT_SUPPORTED (kod 4)
        // fırlatıyor ve hata ekranı gerçek kaynak yüklenirken açılıyordu. Yeni `src` ataması yükleme
        // algoritmasını zaten baştan başlatıyor (önceki kaynak iptal edilir).

        const sourceType = detectSourceType(src, type);
        // Önceki kaynağın HLS kalite listesi kalmasın.
        this.onLevelsChanged([], -1);

        // MP4 veya uzantısı belirlenemeyen doğrudan video kaynağı.
        if (sourceType !== 'hls') {
            this.engineInfo = { engine: 'native' };
            this.video.src = src;
            return;
        }

        const canNative = this.video.canPlayType('application/vnd.apple.mpegurl') !== '';
        // Safari / iOS: native HLS (başarısız olursa probeNativeHls hls.js'e geçer). MSE yoksa da tek yol native.
        if (canNative && (prefersNativeHls() || !hasMse())) {
            this.loadNativeHls(src, prefersNativeHls() ? 'apple-native' : 'no-mse');
            return;
        }

        await this.attachHlsJs(src);
    }

    /** Şu anki oynatma yolu — docs demosu/entegratör teşhisi için (ör. CORS yüzünden native'e düşüldü mü). */
    get engine(): PlaybackEngineInfo {
        return this.engineInfo;
    }

    private loadNativeHls(src: string, reason: PlaybackEngineInfo['reason']): void {
        this.engineInfo = { engine: 'native-hls', reason };
        this.probeNativeHls(src);
        this.video.src = src;
    }

    /** Native HLS denemesi sürüyor mu — ErrorScreen bu sırada gelen hatayı göstermez (hls.js'e geçilecek). */
    isRecovering(): boolean {
        return this.nativeHlsProbe !== null;
    }

    /**
     * Bazı ortamlar canPlayType'a "maybe" deyip HLS'i native oynatamıyor (bazı Android tarayıcıları/WebView'lar).
     * İlk metadata'dan önce kod 4 gelirse ve MSE varsa hls.js'e geç.
     */
    private probeNativeHls(src: string): void {
        // hls.js zaten denenip başarısız olduysa (CORS vb.) tekrar hls.js'e dönme.
        if (!hasMse() || this.engineInfo.reason === 'hlsjs-failed') return;
        const onMeta = (): void => cleanup();
        const onError = (): void => {
            const unsupported = this.video.error?.code === 4;
            cleanup();
            if (unsupported) void this.attachHlsJs(src);
        };
        const cleanup = (): void => {
            this.video.removeEventListener('loadedmetadata', onMeta);
            this.video.removeEventListener('error', onError);
            this.nativeHlsProbe = null;
        };
        this.video.addEventListener('loadedmetadata', onMeta);
        this.video.addEventListener('error', onError);
        this.nativeHlsProbe = cleanup;
    }

    private async attachHlsJs(src: string): Promise<void> {
        // Diğer tarayıcılar: hls.js'i yalnızca gerektiğinde yükle.
        const { default: Hls } = await import('hls.js');
        // import sırasında başka bir kaynak yüklenmiş olabilir.
        if (this.last?.src !== src) return;

        // hls.js desteklenmiyorsa native oynatmayı dene.
        if (!Hls.isSupported()) {
            this.engineInfo = { engine: 'native-hls', reason: 'no-mse' };
            this.video.src = src;
            return;
        }

        const hls = new Hls({
            enableWorker: true,
        });

        this.hls = hls;
        this.engineInfo = { engine: 'hls.js' };
        let parsed = false;

        // Manifest indirilemezse (çoğunlukla CDN'in CORS izni yok — hls.js fetch kullanır, native oynatıcı
        // CORS'a tabi değil) ve tarayıcı native HLS oynatabiliyorsa ona düş: yayın oynar, kalite menüsü olmaz.
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || parsed || this.hls !== hls) return;
            // Yalnızca İNDİREMEME (CORS/ağ/zaman aşımı) — bozuk manifest'i native de oynatamaz.
            const loadFailed = [Hls.ErrorDetails.MANIFEST_LOAD_ERROR, Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT].includes(data.details);
            if (!loadFailed) return;
            if (this.video.canPlayType('application/vnd.apple.mpegurl') === '') return;
            hls.destroy();
            this.hls = null;
            this.loadNativeHls(src, 'hlsjs-failed');
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            parsed = true;
            const levels: HlsQualityLevel[] = hls.levels.map(
                (level, index) => ({
                    index,
                    height: level.height,
                    bitrate: level.bitrate,
                })
            );

            this.onLevelsChanged(levels, hls.currentLevel);
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
            const levels: HlsQualityLevel[] = hls.levels.map(
                (level, index) => ({
                    index,
                    height: level.height,
                    bitrate: level.bitrate,
                })
            );

            // Otomatik (ABR) modda menü "Otomatik"i seçili göstersin, o anki seviyeyi değil.
            this.onLevelsChanged(levels, hls.autoLevelEnabled ? -1 : data.level);
        });

        hls.attachMedia(this.video);
        hls.loadSource(src);
    }

    /** Son kaynağı baştan yükler — hls.js ile oynayan kaynakta da çalışır (çıplak video.load() blob'u yeniden açamaz). */
    reload(): Promise<void> {
        return this.last ? this.load(this.last.src, this.last.type) : Promise.resolve();
    }

    /** -1 = otomatik kalite (ABR). */
    setLevel(index: number): void {
        if (this.hls) {
            this.hls.currentLevel = index;
        }
    }

    destroy(): void {
        this.nativeHlsProbe?.();
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }
}
