import type { HlsConfig } from 'hls.js';
import type { HopeCmcdOptions, HopeDashOptions, HopeDrmOptions, HopeHlsOptions, QualityLimitOptions } from '../types';

/** Oturum kimliği (CMCD `sid` ve analitik oturumu). */
function newId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}
import type { DashEngine } from './dashEngine';
import type { NativeEme } from '../drm/NativeEme';
import { hasFatalMediaError } from '../utils/media-error';


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

type MediaSourceType = 'hls' | 'dash' | 'mp4' | 'unknown';

/** Hangi yoldan oynatılıyor — `reason` native'e neden düşüldüğünü açıklar (ör. CORS). */
export interface PlaybackEngineInfo {
    engine: 'native' | 'native-hls' | 'hls.js' | 'dash.js';
    /** Şifreli içerikte kullanılan anahtar sistemi (ör. `com.widevine.alpha`). */
    drm?: string;
    /** hls.js ile oynarken hangi paket (`options.hls.build`). */
    build?: 'full' | 'light';
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

/** `options.drm`'de lisans adresi olan bir sistem var mı (DRM kodu yalnızca o zaman iner). */
function hasDrm(drm: HopeDrmOptions | undefined): boolean {
    return !!drm && Object.values(drm).some((k) => !!(k as { licenseUrl?: string } | undefined)?.licenseUrl);
}

function hasMse(): boolean {
    const w = window as unknown as { MediaSource?: unknown; ManagedMediaSource?: unknown };
    return typeof w.MediaSource !== 'undefined' || typeof w.ManagedMediaSource !== 'undefined';
}

/**
 * Kaynak türünü MIME type veya URL uzantısından belirler.
 * URL'deki query string ve fragment değerlerini de destekler.
 */
export function detectSourceType(src: string, type?: string): MediaSourceType {
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

    // DASH
    if (normalizedType === 'application/dash+xml' || /\.mpd(?:$|[?#])/i.test(src)) {
        return 'dash';
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
    /** Sesli betimleme izi (HLS CHARACTERISTICS describes-video, Safari kind 'description' / 'main-desc'). */
    description?: boolean;
}

export interface SourceManagerCallbacks {
    onLevelsChanged(levels: HlsQualityLevel[], activeIndex: number): void;
    /** Boş liste = kaynak değişti, önceki izler kalmasın. */
    onAudioTracksChanged(tracks: StreamAudioTrack[], activeIndex: number): void;
    /** hls.js yayın altyazıları — boş liste = sıfırla. Liste büyüyebilir (CEA-608 izleri oynarken bulunur). */
    onTextTracksFound(tracks: StreamTextTrack[]): void;
    onCues(trackId: string, cues: VTTCue[]): void;
    /** hls.js kurtarılamayan bir hata verdi (video.error oluşmaz) — `network` = yayın/segment indirilemiyor, `media` = çözümlenemiyor. */
    onFatalError(kind: 'network' | 'media' | 'drm' | 'unsupported'): void;
    /** hls.js'in her hatası (kurtarılanlar dahil) — hata ayıklama kaydı için. */
    onStreamError?(info: { type: string; details: string; fatal: boolean; url?: string; httpStatus?: number; reason?: string; engine?: string }): void;
}

interface NativeAudioTrack {
    label: string;
    language: string;
    enabled: boolean;
    kind?: string;
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
    private dash: DashEngine | null = null;
    private dashOptions: HopeDashOptions | undefined;
    private drm: HopeDrmOptions | undefined;
    private nativeEme: NativeEme | null = null;
    private qualityLimit: QualityLimitOptions | undefined;
    private cmcd: (HopeCmcdOptions & { contentId?: string }) | null = null;
    /** Her `load()`'da yenilenir. */
    private sid = newId();

    constructor(
        video: HTMLVideoElement,
        private readonly callbacks: SourceManagerCallbacks
    ) {
        this.video = video;
    }

    /** `options.hls` — sonraki `load()`'da uygulanır. */
    configure(
        options: HopeHlsOptions | undefined,
        media?: { dash?: HopeDashOptions; drm?: HopeDrmOptions; qualityLimit?: QualityLimitOptions; cmcd?: HopeCmcdOptions | null }
    ): void {
        this.hlsOptions = options ?? {};
        this.cmcd = media?.cmcd ?? null;
        this.qualityLimit = media?.qualityLimit;
        this.dashOptions = media?.dash;
        this.drm = media?.drm;
    }

    /** Bu kaynak zaten yüklü ve hatasız mı — aynı kaynak için yeniden yükleme (başa sarma) gerekmez. */
    isLoaded(src: string, type?: string): boolean {
        return !!this.last && this.last.src === src && this.last.type === type && !hasFatalMediaError(this.video) && this.video.readyState > 0;
    }

    /** O anki oynatma oturumu (CMCD `sid`). */
    get sessionId(): string {
        return this.sid;
    }

    async load(src: string, type?: string): Promise<void> {
        this.last = { src, type };
        this.sid = newId();
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

        if (sourceType === 'dash') {
            await this.attachDash(src);
            return;
        }

        // MP4 veya uzantısı belirlenemeyen doğrudan video kaynağı.
        if (sourceType !== 'hls') {
            this.engineInfo = { engine: 'native' };
            await this.prepareNativeDrm();
            if (this.last?.src !== src) return;
            this.video.src = src;
            return;
        }

        const engine = this.hlsOptions.engine ?? 'auto';
        const canNative = this.video.canPlayType('application/vnd.apple.mpegurl') !== '';
        if (engine === 'native' && canNative) {
            await this.prepareNativeDrm();
            this.loadNativeHls(src, 'option');
            return;
        }
        // Safari / iOS: native HLS (başarısız olursa probeNativeHls hls.js'e geçer). MSE yoksa da tek yol native.
        // `engine: 'hls.js'` bunu atlar — Safari'de de kalite/ses menüsü için hls.js (iOS 17.1+ ManagedMediaSource).
        if (engine !== 'hls.js' && canNative && (prefersNativeHls() || !hasMse())) {
            await this.prepareNativeDrm();
            if (this.last?.src !== src) return;
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

    /** Native oynatmada şifreli içerik için EME işleyicisi (kaynak atanmadan önce). */
    private async prepareNativeDrm(): Promise<void> {
        if (!hasDrm(this.drm)) return;
        const { NativeEme } = await import('../drm/NativeEme');
        this.nativeEme?.destroy();
        this.nativeEme = new NativeEme(this.video, this.drm!, {
            onError: (message, keySystem) => {
                this.callbacks.onStreamError?.({ type: 'drm', details: message, fatal: true, engine: 'eme', reason: keySystem });
                this.callbacks.onFatalError('drm');
            },
            onLicense: (keySystem) => {
                this.engineInfo = { ...this.engineInfo, drm: keySystem };
            },
        });
    }

    private async attachDash(src: string): Promise<void> {
        // MSE yoksa (ör. eski iOS) DASH oynatılamaz: önceki kaynak çalmaya devam etmesin.
        if (!hasMse()) {
            this.engineInfo = { engine: 'dash.js' };
            this.video.removeAttribute('src');
            this.video.load();
            this.callbacks.onFatalError('unsupported');
            return;
        }
        const { DashEngine } = await import('./dashEngine');
        if (this.last?.src !== src) return;
        this.engineInfo = { engine: 'dash.js' };
        this.dash = new DashEngine(this.video, src, { dash: this.dashOptions, drm: this.drm, autoplay: this.video.autoplay, fitPlayer: !!this.qualityLimit?.fitPlayer, cmcd: this.cmcd ? { ...this.cmcd, sessionId: this.sid } : null }, {
            onLevels: (levels, active) => this.callbacks.onLevelsChanged(levels, active),
            onAudioTracks: (tracks, active) => this.callbacks.onAudioTracksChanged(tracks, active),
            onFatal: (kind) => this.callbacks.onFatalError(kind),
            onError: (e) => this.callbacks.onStreamError?.({ type: 'dash', details: `${e.code}: ${e.message}`, fatal: e.fatal, engine: 'dash.js' }),
            onTextTracks: (tracks) => {
                this.streamTextTracks.clear();
                for (const t of tracks) this.streamTextTracks.set(t.id, t);
                this.callbacks.onTextTracksFound([...this.streamTextTracks.values()]);
            },
            onCues: (id, cues) => this.callbacks.onCues(id, cues),
            onDrm: (keySystem) => {
                this.engineInfo = { ...this.engineInfo, drm: keySystem };
            },
        });
    }

    /** O an oynayan kalite (ABR'de de gerçek seviye). */
    currentLevel(): { height: number; bitrate: number | null } | null {
        if (this.dash) return this.dash.currentLevel();
        if (this.hls) {
            const l = this.hls.levels[this.hls.currentLevel];
            return l ? { height: l.height, bitrate: l.bitrate } : null;
        }
        return this.video.videoHeight ? { height: this.video.videoHeight, bitrate: null } : null;
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
            const tracks: StreamAudioTrack[] = Array.from(list, (t, index) => ({
                index,
                label: t.label || t.language || `${index + 1}`,
                lang: t.language,
                description: t.kind === 'description' || t.kind === 'main-desc',
            }));
            this.callbacks.onAudioTracksChanged(tracks, Array.from(list).findIndex((t) => t.enabled));
        };
        for (const ev of ['addtrack', 'removetrack', 'change']) list.addEventListener(ev, report);
        this.nativeAudioCleanup = () => {
            for (const ev of ['addtrack', 'removetrack', 'change']) list.removeEventListener(ev, report);
            this.nativeAudioCleanup = null;
        };
    }

    private async attachHlsJs(src: string): Promise<void> {
        // Diğer tarayıcılar: hls.js'i yalnızca gerektiğinde yükle. İki paket ayrı parçalarda — biri seçilince öbürü inmez.
        // Hafif pakette EME ve CMCD yok — o zaman tam paket.
        const build = this.hlsOptions.build === 'light' && !hasDrm(this.drm) && !this.cmcd ? 'light' : 'full';
        const { default: Hls } = build === 'light' ? await import('hls.js/light') : await import('hls.js');
        // import sırasında başka bir kaynak yüklenmiş olabilir.
        if (this.last?.src !== src) return;

        // hls.js desteklenmiyorsa native oynatmayı dene.
        if (!Hls.isSupported()) {
            this.engineInfo = { engine: 'native-hls', reason: 'no-mse' };
            this.video.src = src;
            return;
        }

        const drmConfig = hasDrm(this.drm) ? (await import('../drm/keySystems')).hlsDrmConfig(this.drm!, this.hlsOptions.config ?? {}) : {};
        if (this.last?.src !== src) return;
        const hls = new Hls(this.buildHlsConfig(drmConfig));

        this.hls = hls;
        this.engineInfo = { engine: 'hls.js', build };
        let parsed = false;
        let mediaRecoveryTried = false;

        // Manifest indirilemezse (çoğunlukla CDN'in CORS izni yok — hls.js fetch kullanır, native oynatıcı
        // CORS'a tabi değil) ve tarayıcı native HLS oynatabiliyorsa ona düş: yayın oynar, kalite menüsü olmaz.
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (this.hls === hls) {
                const d = data as unknown as { url?: string; frag?: { url?: string }; context?: { url?: string }; response?: { code?: number }; reason?: string; error?: Error };
                this.callbacks.onStreamError?.({
                    engine: 'hls.js',
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
            const kind = data.type === Hls.ErrorTypes.KEY_SYSTEM_ERROR ? 'drm' : data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'media';
            this.callbacks.onFatalError(kind);
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
            hls.audioTracks.map((t, index) => ({
                index,
                label: t.name || t.lang || `${index + 1}`,
                lang: t.lang ?? '',
                description: /describes-video/.test(t.characteristics ?? ''),
            }));
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

    private buildHlsConfig(drmConfig: Partial<HlsConfig>): Partial<HlsConfig> {
        const user = this.hlsOptions.config ?? {};
        // liveDurationInfinity: hls.js canlıda varsayılan olarak SONLU bir duration verir (kayan pencere sonu) — player
        // canlıyı duration === Infinity ile tanıdığı için canlı rozeti/duvar saati açılmıyor, süre "0:35 / 0:54" görünüyordu.
        const config: Partial<HlsConfig> = { enableWorker: true, renderTextTracksNatively: false, liveDurationInfinity: true, ...(this.qualityLimit?.fitPlayer ? { capLevelToPlayerSize: true } : {}),
            ...(this.cmcd ? { cmcd: { sessionId: this.sid, contentId: this.cmcd.contentId, useHeaders: this.cmcd.mode === 'header' } } : {}),
            ...user,
            ...drmConfig,
        };
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
    /** Son `load()` edilen kaynak (playlist/dublaj gibi eklentilerin yüklediği dahil). */
    get currentSrc(): string | null {
        return this.last?.src ?? null;
    }

    reload(): Promise<void> {
        return this.last ? this.load(this.last.src, this.last.type) : Promise.resolve();
    }

    /** ABR'nin çıkabileceği en yüksek seviye (kalite kilidi); -1 = sınır yok. */
    setMaxLevel(index: number): void {
        this.dash?.setMaxLevel(index);
        if (this.hls && this.hls.autoLevelCapping !== index) this.hls.autoLevelCapping = index;
    }

    /** -1 = otomatik kalite (ABR). */
    setLevel(index: number): void {
        this.dash?.setLevel(index);
        if (this.hls) {
            this.hls.currentLevel = index;
        }
    }

    setAudioTrack(index: number): void {
        if (this.dash) {
            this.dash.setAudioTrack(index);
            return;
        }
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
        if (this.dash) {
            this.dash.selectText(id);
            return;
        }
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
        this.dash?.destroy();
        this.dash = null;
        this.nativeEme?.destroy();
        this.nativeEme = null;
    }
}
