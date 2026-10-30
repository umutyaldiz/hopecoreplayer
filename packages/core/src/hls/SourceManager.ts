import type { HlsConfig } from 'hls.js';
import type { HopeHlsOptions } from '../types';


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
    /** `option` = `options.hls.engine: 'native'` ile istendi. */
    reason?: 'apple-native' | 'no-mse' | 'hlsjs-failed' | 'option';
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

/** Yayının kendi altyazı/kapalı altyazı izi (HLS manifest altyazıları, CEA-608). */
export interface StreamTextTrack {
    /** `sub:<hls.js id>` (manifest altyazısı) ya da `cc:<textTrackN>` (CEA-608). */
    id: string;
    kind: 'subtitles' | 'captions';
    label: string;
    lang: string;
}

/** Yayının alternatif ses izi (HLS EXT-X-MEDIA TYPE=AUDIO ya da Safari native `audioTracks`). */
export interface StreamAudioTrack {
    index: number;
    label: string;
    lang: string;
}

export interface SourceManagerCallbacks {
    onLevelsChanged(levels: HlsQualityLevel[], activeIndex: number): void;
    /** Boş liste = kaynak değişti, önceki izler kalmasın. */
    onAudioTracksChanged(tracks: StreamAudioTrack[], activeIndex: number): void;
    /** hls.js yayın altyazıları — boş liste = sıfırla. Liste büyüyebilir (CEA-608 izleri oynarken bulunur). */
    onTextTracksFound(tracks: StreamTextTrack[]): void;
    onCues(trackId: string, cues: VTTCue[]): void;
    /** hls.js kurtarılamayan bir hata verdi (video.error oluşmaz) — `network` = yayın/segment indirilemiyor, `media` = çözümlenemiyor. */
    onFatalError(kind: 'network' | 'media'): void;
    /** hls.js'in her hatası (kurtarılanlar dahil) — hata ayıklama kaydı için. */
    onStreamError?(info: { type: string; details: string; fatal: boolean; url?: string; httpStatus?: number; reason?: string }): void;
}

interface NativeAudioTrack {
    label: string;
    language: string;
    enabled: boolean;
}
type NativeAudioTrackList = EventTarget & ArrayLike<NativeAudioTrack>;

export class SourceManager {
    private hls: HlsInstance | null = null;

    private readonly video: HTMLVideoElement;

    /** Son yüklenen kaynak — `reload()` (hata ekranındaki "Tekrar dene") için. */
    private last: { src: string; type?: string } | null = null;
    /** Native HLS denemesi sürerken (ilk loadedmetadata'ya kadar) — başarısız olursa hls.js'e geçilir. */
    private nativeHlsProbe: (() => void) | null = null;
    private engineInfo: PlaybackEngineInfo = { engine: 'native' };
    private hlsOptions: HopeHlsOptions = {};
    private streamTextTracks = new Map<string, StreamTextTrack>();
    /** Safari native HLS ses izi dinleyicilerini kaldırır. */
    private nativeAudioCleanup: (() => void) | null = null;

    constructor(
        video: HTMLVideoElement,
        private readonly callbacks: SourceManagerCallbacks
    ) {
        this.video = video;
    }

    /** `options.hls` — sonraki `load()`'da uygulanır. */
    configure(options: HopeHlsOptions | undefined): void {
        this.hlsOptions = options ?? {};
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
        // Önceki kaynağın kalite / ses / altyazı listeleri kalmasın.
        this.callbacks.onLevelsChanged([], -1);
        this.callbacks.onAudioTracksChanged([], -1);
        this.streamTextTracks.clear();
        this.callbacks.onTextTracksFound([]);

        // MP4 veya uzantısı belirlenemeyen doğrudan video kaynağı.
        if (sourceType !== 'hls') {
            this.engineInfo = { engine: 'native' };
            this.video.src = src;
            return;
        }

        const engine = this.hlsOptions.engine ?? 'auto';
        const canNative = this.video.canPlayType('application/vnd.apple.mpegurl') !== '';
        if (engine === 'native' && canNative) {
            this.loadNativeHls(src, 'option');
            return;
        }
        // Safari / iOS: native HLS (başarısız olursa probeNativeHls hls.js'e geçer). MSE yoksa da tek yol native.
        // `engine: 'hls.js'` bunu atlar — Safari'de de kalite/ses menüsü için hls.js (iOS 17.1+ ManagedMediaSource).
        if (engine !== 'hls.js' && canNative && (prefersNativeHls() || !hasMse())) {
            this.loadNativeHls(src, prefersNativeHls() ? 'apple-native' : 'no-mse');
            return;
        }

        await this.attachHlsJs(src);
    }

    /** Şu anki oynatma yolu — docs demosu/entegratör teşhisi için (ör. CORS yüzünden native'e düşüldü mü). */
    get engine(): PlaybackEngineInfo {
        return this.engineInfo;
    }

    /** hls.js ile oynatılıyorsa instance (gelişmiş kullanım: olaylar, istatistik); değilse null. */
    get hlsInstance(): HlsInstance | null {
        return this.hls;
    }

    private loadNativeHls(src: string, reason: PlaybackEngineInfo['reason']): void {
        this.engineInfo = { engine: 'native-hls', reason };
        this.probeNativeHls(src);
        this.watchNativeAudioTracks();
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
        // hls.js zaten denenip başarısız olduysa (CORS vb.) ya da native özellikle istendiyse hls.js'e dönme.
        if (!hasMse() || this.engineInfo.reason === 'hlsjs-failed' || this.engineInfo.reason === 'option') return;
        const onMeta = (): void => cleanup();
        const onError = (): void => {
            const unsupported = this.video.error?.code === 4;
            cleanup();
            if (unsupported) {
                this.nativeAudioCleanup?.();
                void this.attachHlsJs(src);
            }
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

    /** Safari native HLS: alternatif ses izleri `video.audioTracks`'te (diğer tarayıcılarda bu API yok). */
    private watchNativeAudioTracks(): void {
        const list = (this.video as unknown as { audioTracks?: NativeAudioTrackList }).audioTracks;
        if (!list) return;
        const report = (): void => {
            const tracks: StreamAudioTrack[] = Array.from(list, (t, index) => ({ index, label: t.label || t.language || `${index + 1}`, lang: t.language }));
            this.callbacks.onAudioTracksChanged(tracks, Array.from(list).findIndex((t) => t.enabled));
        };
        for (const ev of ['addtrack', 'removetrack', 'change']) list.addEventListener(ev, report);
        this.nativeAudioCleanup = () => {
            for (const ev of ['addtrack', 'removetrack', 'change']) list.removeEventListener(ev, report);
            this.nativeAudioCleanup = null;
        };
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

        const hls = new Hls(this.buildHlsConfig());

        this.hls = hls;
        this.engineInfo = { engine: 'hls.js' };
        let parsed = false;
        let mediaRecoveryTried = false;

        // Manifest indirilemezse (çoğunlukla CDN'in CORS izni yok — hls.js fetch kullanır, native oynatıcı
        // CORS'a tabi değil) ve tarayıcı native HLS oynatabiliyorsa ona düş: yayın oynar, kalite menüsü olmaz.
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (this.hls === hls) {
                const d = data as unknown as { url?: string; frag?: { url?: string }; context?: { url?: string }; response?: { code?: number }; reason?: string; error?: Error };
                this.callbacks.onStreamError?.({
                    type: String(data.type),
                    details: String(data.details),
                    fatal: !!data.fatal,
                    url: d.url ?? d.frag?.url ?? d.context?.url,
                    httpStatus: d.response?.code,
                    reason: d.reason ?? d.error?.message,
                });
            }
            if (!data.fatal || this.hls !== hls) return;
            // Yalnızca İNDİREMEME (CORS/ağ/zaman aşımı) — bozuk manifest'i native de oynatamaz.
            const loadFailed = [Hls.ErrorDetails.MANIFEST_LOAD_ERROR, Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT].includes(data.details);
            if (!parsed && loadFailed && this.video.canPlayType('application/vnd.apple.mpegurl') !== '') {
                hls.destroy();
                this.hls = null;
                this.loadNativeHls(src, 'hlsjs-failed');
                return;
            }
            // Medya hatası: hls.js'in önerdiği gibi bir kez kurtarmayı dene (decoder/MSE takılması çoğu zaman düzelir).
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecoveryTried) {
                mediaRecoveryTried = true;
                hls.recoverMediaError();
                return;
            }
            // Ağ hataları zaten hls.js'in kendi retry ayarlarıyla denendi — kurtarılamadı.
            hls.stopLoad();
            this.callbacks.onFatalError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'media');
        });

        const levels = (): HlsQualityLevel[] => hls.levels.map((level, index) => ({ index, height: level.height, bitrate: level.bitrate }));

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            parsed = true;
            this.callbacks.onLevelsChanged(levels(), hls.currentLevel);
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
            // Otomatik (ABR) modda menü "Otomatik"i seçili göstersin, o anki seviyeyi değil.
            this.callbacks.onLevelsChanged(levels(), hls.autoLevelEnabled ? -1 : data.level);
        });

        const audio = (): StreamAudioTrack[] =>
            hls.audioTracks.map((t, index) => ({ index, label: t.name || t.lang || `${index + 1}`, lang: t.lang ?? '' }));
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.callbacks.onAudioTracksChanged(audio(), hls.audioTrack));
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => this.callbacks.onAudioTracksChanged(audio(), data.id));

        // Yayın altyazıları: renderTextTracksNatively:false ile hls.js <track> oluşturmaz (iOS'ta <track> videoyu
        // kod 4 ile düşürüyor), izleri ve cue'ları olayla verir — player kendi addTextTrack havuzuna koyar.
        hls.on(Hls.Events.NON_NATIVE_TEXT_TRACKS_FOUND, (_event, data) => {
            for (const t of data.tracks) {
                const sub = t.subtitleTrack;
                const id = sub ? `sub:${sub.id}` : `cc:${(t as { _id?: string })._id ?? t.label}`;
                const kind = t.kind === 'captions' ? 'captions' : 'subtitles';
                this.streamTextTracks.set(id, { id, kind, label: t.label, lang: sub?.lang ?? t.closedCaptions?.lang ?? '' });
            }
            this.callbacks.onTextTracksFound([...this.streamTextTracks.values()]);
        });
        hls.on(Hls.Events.CUES_PARSED, (_event, data) => {
            const id = data.type === 'subtitles' && data.subtitleTrack ? `sub:${data.subtitleTrack.id}` : `cc:${data.track}`;
            this.callbacks.onCues(id, data.cues as VTTCue[]);
        });

        hls.attachMedia(this.video);
        hls.loadSource(src);
    }

    private buildHlsConfig(): Partial<HlsConfig> {
        const user = this.hlsOptions.config ?? {};
        // liveDurationInfinity: hls.js canlıda varsayılan olarak SONLU bir duration verir (kayan pencere sonu) — player
        // canlıyı duration === Infinity ile tanıdığı için canlı rozeti/duvar saati açılmıyor, süre "0:35 / 0:54" görünüyordu.
        const config: Partial<HlsConfig> = { enableWorker: true, renderTextTracksNatively: false, liveDurationInfinity: true, ...user };
        if (this.hlsOptions.withCredentials) {
            const { xhrSetup, fetchSetup } = user;
            config.xhrSetup = (xhr, url, context) => {
                xhr.withCredentials = true;
                return xhrSetup?.(xhr, url, context);
            };
            config.fetchSetup = (context, init) => {
                const withCreds = { ...init, credentials: 'include' as RequestCredentials };
                return fetchSetup ? fetchSetup(context, withCreds) : new Request(context.url, withCreds);
            };
        }
        return config;
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

    setAudioTrack(index: number): void {
        if (this.hls) {
            this.hls.audioTrack = index;
            return;
        }
        const list = (this.video as unknown as { audioTracks?: NativeAudioTrackList }).audioTracks;
        if (!list) return;
        // Önce yeniyi aç, sonra diğerlerini kapat — Safari tüm izler kapalı kalınca sesi kesiyor.
        if (list[index]) list[index]!.enabled = true;
        Array.from(list).forEach((t, i) => {
            if (i !== index) t.enabled = false;
        });
    }

    /**
     * Yayın altyazısı seçildi (null = yayın altyazısı yok). hls.js manifest altyazısının segmentlerini yalnızca
     * seçili `subtitleTrack` için indirir; CEA-608 cue'ları zaten video segmentlerinden sürekli gelir.
     */
    selectTextTrack(id: string | null): void {
        if (!this.hls) return;
        const hlsId = id?.startsWith('sub:') ? Number(id.slice(4)) : NaN;
        this.hls.subtitleTrack = Number.isNaN(hlsId) ? -1 : this.hls.subtitleTracks.findIndex((t) => t.id === hlsId);
    }

    destroy(): void {
        this.nativeHlsProbe?.();
        this.nativeAudioCleanup?.();
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }
}
