import { loadDaiSdk } from './loadDaiSdk';
import type { DaiOptions } from '../../types';
import { getPrivacy } from '../../utils/privacy';

export interface DaiPlayerContext {
    videoEl: HTMLVideoElement;
    hostEl: HTMLElement;
    /** IMA DAI'nin kendi ad UI'ını (skip/countdown/clickthrough) çizdiği katman — plugins/ads'teki adLayerEl ile aynı fikir. */
    adUiEl: HTMLElement;
    loadStreamUrl(url: string, type?: string): Promise<void>;
    /** O anki oynatma motorları (hls.js / dash.js) — reklam zamanlaması metadata'sı onlardan iletilir. */
    engines?(): { hls: unknown; dash: unknown };
    /** Reklam arası boyunca kullanıcı canlı reklamın İÇİNE seek edemesin diye. */
    disableSeeking(): void;
    enableSeeking(): void;
}

/** hls.js (yalnızca kullanılan alanlar). */
interface HlsLike {
    on(event: string, cb: (event: string, data: { samples?: Array<{ data: Uint8Array; pts: number }> }) => void): void;
    off(event: string, cb: (event: string, data: { samples?: Array<{ data: Uint8Array; pts: number }> }) => void): void;
}
interface DashEventLike {
    event?: { messageData?: unknown; calculatedPresentationTime?: number; eventStream?: { schemeIdUri?: string } };
}
interface DashLike {
    on(type: string, cb: (e: DashEventLike) => void, scope?: unknown, options?: { mode?: string }): void;
    off(type: string, cb: (e: DashEventLike) => void, scope?: unknown): void;
}

/** DAI DASH yayınlarının reklam zamanlaması şemaları (emsg / EventStream). */
const DAI_DASH_SCHEMES = ['urn:google:dai:2018', 'https://aomedia.org/emsg/ID3', 'https://developer.apple.com/streaming/emsg-id3'];

/** Google IMA DAI: stream StreamManager üzerinden istenir; reklam araları sırasında seek kilitlenir. */
export class DaiController {
    private dai: typeof google.ima.dai | null = null;
    private streamManager: google.ima.dai.api.StreamManager | null = null;
    private readonly metadataTrackListeners = new Map<TextTrack, () => void>();
    private engineCleanup: (() => void) | null = null;

    constructor(
        private readonly ctx: DaiPlayerContext,
        private readonly options: DaiOptions
    ) {}

    async install(): Promise<void> {
        let dai: typeof google.ima.dai;
        try {
            dai = await loadDaiSdk();
        } catch (err) {
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:aderror', { detail: { message: String(err) } }));
            if (this.options.fallbackStreamUrl) void this.ctx.loadStreamUrl(this.options.fallbackStreamUrl);
            return;
        }
        this.dai = dai;

        this.streamManager = new dai.api.StreamManager(this.ctx.videoEl, this.ctx.adUiEl);
        this.streamManager.addEventListener(
            [
                dai.api.StreamEvent.Type.LOADED,
                dai.api.StreamEvent.Type.ERROR,
                dai.api.StreamEvent.Type.AD_BREAK_STARTED,
                dai.api.StreamEvent.Type.AD_BREAK_ENDED,
            ],
            this.onStreamEvent
        );

        const request = new dai.api.LiveStreamRequest();
        request.assetKey = this.options.assetKey;
        if (this.options.format === 'dash') request.format = 'dash';
        if (this.options.apiKey) request.apiKey = this.options.apiKey;
        const privacy = getPrivacy();
        // Gizlilik: kişiselleştirme onayı yoksa npa=1, depolama izni de yoksa ltd=1.
        const params = { ...this.options.adTagParameters, ...(privacy.personalizedAds ? {} : { npa: '1', ...(privacy.functional ? {} : { ltd: '1' }) }) };
        if (Object.keys(params).length) request.adTagParameters = params;

        this.streamManager.requestStream(request);
    }

    destroy(): void {
        this.engineCleanup?.();
        this.engineCleanup = null;
        this.ctx.videoEl.textTracks.removeEventListener('addtrack', this.onAddTrack);
        for (const [track, listener] of this.metadataTrackListeners) track.removeEventListener('cuechange', listener);
        this.metadataTrackListeners.clear();
        this.streamManager?.reset();
    }

    /** Doğrusal reklam arası: player'a data-ad (bkz. shared/adOverlays) — yardımcı reklam parçasından gelir. */
    private markAd(active: boolean): void {
        void import('../ads').then((m) => m.markLinearAd(this.ctx.hostEl, this.ctx.videoEl, active));
    }

    private readonly onStreamEvent = (event: google.ima.dai.api.StreamEvent): void => {
        if (!this.dai) return;
        const Type = this.dai.api.StreamEvent.Type;

        switch (event.type) {
            case Type.LOADED: {
                const { url } = event.getStreamData();
                const dash = this.options.format === 'dash';
                void this.ctx.loadStreamUrl(url, dash ? 'application/dash+xml' : undefined).then(() => {
                    this.attachMetadataForwarding();
                    // dash.js MSE'yi geç bağlar: veri gelmeden çağrılan play() boşa gider.
                    const v = this.ctx.videoEl;
                    const play = (): void => void v.play().catch(() => {});
                    if (!dash && v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) play();
                    else v.addEventListener('canplay', play, { once: true });
                });
                break;
            }
            case Type.ERROR: {
                this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:aderror', { detail: { message: 'DAI stream error' } }));
                if (this.options.fallbackStreamUrl) void this.ctx.loadStreamUrl(this.options.fallbackStreamUrl);
                break;
            }
            case Type.AD_BREAK_STARTED:
                this.ctx.disableSeeking();
                this.markAd(true);
                this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adstart', { detail: { type: 'midroll' } }));
                break;
            case Type.AD_BREAK_ENDED:
                this.ctx.enableSeeking();
                this.markAd(false);
                this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adend', { detail: { type: 'midroll' } }));
                break;
            default:
                break;
        }
    };

    /**
     * Reklam zamanlaması yayındaki metadata ile gelir: hls.js'te ID3 örnekleri (FRAG_PARSING_METADATA), dash.js'te
     * emsg / EventStream olayları processMetadata()'ya; Safari'nin yerel oynatıcısında metadata cue'ları onTimedMetadata()'ya.
     */
    private attachMetadataForwarding(): void {
        this.engineCleanup?.();
        this.engineCleanup = null;
        const { hls, dash } = this.ctx.engines?.() ?? { hls: null, dash: null };
        if (hls) {
            const h = hls as HlsLike;
            const onMeta = (_e: string, data: { samples?: Array<{ data: Uint8Array; pts: number }> }): void => {
                for (const sample of data.samples ?? []) this.streamManager?.processMetadata('ID3', sample.data, sample.pts);
            };
            h.on('hlsFragParsingMetadata', onMeta);
            this.engineCleanup = () => h.off('hlsFragParsingMetadata', onMeta);
            return;
        }
        if (dash) {
            const d = dash as DashLike;
            const onEvent = (e: DashEventLike): void => {
                const ev = e.event;
                const scheme = ev?.eventStream?.schemeIdUri ?? '';
                const data = ev?.messageData;
                if (!ev || (!(data instanceof Uint8Array) && typeof data !== 'string')) return;
                this.streamManager?.processMetadata(scheme === DAI_DASH_SCHEMES[0] ? scheme : 'ID3', data, ev.calculatedPresentationTime);
            };
            for (const scheme of DAI_DASH_SCHEMES) d.on(scheme, onEvent, null, { mode: 'eventModeOnReceive' });
            this.engineCleanup = () => {
                for (const scheme of DAI_DASH_SCHEMES) d.off(scheme, onEvent, null);
            };
            return;
        }
        for (let i = 0; i < this.ctx.videoEl.textTracks.length; i++) {
            this.listenMetadataTrack(this.ctx.videoEl.textTracks[i]!);
        }
        this.ctx.videoEl.textTracks.addEventListener('addtrack', this.onAddTrack);
    }

    private readonly onAddTrack = (e: TrackEvent): void => {
        if (e.track instanceof TextTrack) this.listenMetadataTrack(e.track);
    };

    private listenMetadataTrack(track: TextTrack): void {
        if (track.kind !== 'metadata' || this.metadataTrackListeners.has(track)) return;
        track.mode = 'hidden';

        const listener = () => {
            const cues = track.activeCues;
            if (!cues || !this.streamManager) return;
            for (let i = 0; i < cues.length; i++) {
                const cue = cues[i] as unknown as { value?: unknown; startTime?: number };
                if (cue.value === undefined) continue;
                try {
                    // Safari yerel HLS: ID3 çerçeveleri { key, data } olarak gelir — DAI bunu onTimedMetadata ile ister.
                    const v = cue.value as { key?: string; data?: unknown };
                    if (v && typeof v === 'object' && typeof v.key === 'string' && this.streamManager.onTimedMetadata) {
                        this.streamManager.onTimedMetadata({ [v.key]: v.data });
                    } else {
                        this.streamManager.processMetadata('ID3', cue.value as Uint8Array | string, cue.startTime);
                    }
                } catch {
                    /* DAI akışla ilgisiz bir metadata cue'su olabilir — yoksay */
                }
            }
        };
        track.addEventListener('cuechange', listener);
        this.metadataTrackListeners.set(track, listener);
    }
}
