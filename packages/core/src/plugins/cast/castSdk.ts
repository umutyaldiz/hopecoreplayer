/**
 * Google Cast Web Sender SDK (CAF) — kullanılan yüzeyin minimal tipleri ve yükleyicisi.
 * https://developers.google.com/cast/docs/web_sender
 */

export interface CastImage {
    url: string;
}

export interface CastMediaMetadata {
    metadataType?: number;
    title?: string;
    subtitle?: string;
    artist?: string;
    albumName?: string;
    images?: CastImage[];
}

export interface CastTrack {
    trackContentId?: string;
    trackContentType?: string;
    subtype?: string;
    name?: string;
    language?: string;
}

export interface CastVastAdsRequest {
    adTagUrl?: string;
}

export interface CastBreakClip {
    vastAdsRequest?: CastVastAdsRequest;
}

export interface CastMediaInfo {
    contentId: string;
    contentType: string;
    streamType?: string;
    metadata?: CastMediaMetadata;
    tracks?: CastTrack[];
    hlsSegmentFormat?: string;
    hlsVideoSegmentFormat?: string;
    vmapAdsRequest?: CastVastAdsRequest;
    breakClips?: CastBreakClip[];
    breaks?: unknown[];
}

export interface CastLoadRequest {
    currentTime?: number;
    autoplay?: boolean;
    activeTrackIds?: number[];
}

export interface CastSessionLike {
    loadMedia(request: CastLoadRequest): Promise<unknown>;
    getCastDevice(): { friendlyName?: string };
    getMediaSession(): { media?: { contentId?: string } } | null;
}

export interface RemotePlayerLike {
    isConnected: boolean;
    isMediaLoaded: boolean;
    isPaused: boolean;
    currentTime: number;
    duration: number;
    volumeLevel: number;
    isMuted: boolean;
    playerState: string | null;
    isPlayingBreak: boolean;
}

export interface RemotePlayerControllerLike {
    addEventListener(type: string, fn: (e: { field: string; value: unknown }) => void): void;
    removeEventListener(type: string, fn: (e: { field: string; value: unknown }) => void): void;
    playOrPause(): void;
    seek(): void;
    setVolumeLevel(): void;
    muteOrUnmute(): void;
    stop(): void;
}

export interface CastContextLike {
    setOptions(options: Record<string, unknown>): void;
    addEventListener(type: string, fn: (e: { castState?: string; sessionState?: string; session?: CastSessionLike }) => void): void;
    removeEventListener(type: string, fn: (e: { castState?: string; sessionState?: string; session?: CastSessionLike }) => void): void;
    requestSession(): Promise<unknown>;
    getCurrentSession(): CastSessionLike | null;
    getCastState(): string;
    endCurrentSession(stopCasting: boolean): void;
}

type Ctor<T> = new (...args: never[]) => T;

/** `window.cast.framework` + `window.chrome.cast` — yalnızca kullandıklarımız. */
export interface CastApi {
    framework: {
        CastContext: { getInstance(): CastContextLike };
        CastContextEventType: { CAST_STATE_CHANGED: string; SESSION_STATE_CHANGED: string };
        RemotePlayer: Ctor<RemotePlayerLike>;
        RemotePlayerController: new (player: RemotePlayerLike) => RemotePlayerControllerLike;
        RemotePlayerEventType: { ANY_CHANGE: string };
    };
    chrome: {
        AutoJoinPolicy: { ORIGIN_SCOPED: string };
        media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: string;
            MediaInfo: new (contentId: string, contentType: string) => CastMediaInfo;
            GenericMediaMetadata: Ctor<CastMediaMetadata>;
            MusicTrackMediaMetadata: Ctor<CastMediaMetadata>;
            LoadRequest: new (media: CastMediaInfo) => CastLoadRequest;
            Track: new (trackId: number, type: string) => CastTrack;
            TrackType: { TEXT: string };
            TextTrackType: { SUBTITLES: string };
            StreamType: { BUFFERED: string; LIVE: string };
            VastAdsRequest: Ctor<CastVastAdsRequest>;
            BreakClip: new (id: string) => CastBreakClip;
            Break: new (id: string, breakClipIds: string[], position: number) => unknown;
            HlsSegmentFormat?: { TS: string; FMP4: string; AAC: string };
            HlsVideoSegmentFormat?: { MPEG2_TS: string; FMP4: string };
        };
        Image: new (url: string) => CastImage;
    };
}

const CAST_SDK_SRC = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const LOAD_TIMEOUT_MS = 10_000;
let loading: Promise<CastApi | null> | null = null;

function current(): CastApi | null {
    const w = window as unknown as { cast?: { framework?: CastApi['framework'] }; chrome?: { cast?: CastApi['chrome'] } };
    return w.cast?.framework && w.chrome?.cast ? { framework: w.cast.framework, chrome: w.chrome.cast } : null;
}

/**
 * Cast SDK'yı bir kez yükler. Yalnızca Chromium tarayıcılarda (Chrome / Edge) ve güvenli bağlamda (HTTPS) denenir;
 * diğerlerinde ya da SDK "Cast yok" derse null — buton hiç görünmez.
 */
export function loadCastSdk(): Promise<CastApi | null> {
    if (loading) return loading;
    const w = window as unknown as { chrome?: unknown; __onGCastApiAvailable?: (available: boolean, reason?: string) => void };
    if (current()) return (loading = Promise.resolve(current()));
    if (!w.chrome || !window.isSecureContext) return (loading = Promise.resolve(null));
    loading = new Promise<CastApi | null>((resolve) => {
        const previous = w.__onGCastApiAvailable;
        const timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
        // SDK hazır olunca bu global geri çağrıyı çağırır — sayfa kendi kurduysa onu da çağır.
        w.__onGCastApiAvailable = (available, reason) => {
            previous?.(available, reason);
            clearTimeout(timer);
            resolve(available ? current() : null);
        };
        if (!document.querySelector('script[src*="cast_sender.js"]')) {
            const s = document.createElement('script');
            s.async = true;
            s.src = CAST_SDK_SRC;
            s.onerror = () => {
                clearTimeout(timer);
                loading = null;
                resolve(null);
            };
            document.head.appendChild(s);
        }
    });
    return loading;
}
