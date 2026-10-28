import { loadDaiSdk } from './loadDaiSdk';
import type { DaiOptions } from '../../types';

export interface DaiPlayerContext {
    videoEl: HTMLVideoElement;
    hostEl: HTMLElement;
    /** IMA DAI'nin kendi ad UI'ını (skip/countdown/clickthrough) çizdiği katman — plugins/ads'teki adLayerEl ile aynı fikir. */
    adUiEl: HTMLElement;
    loadStreamUrl(url: string): Promise<void>;
    /** Reklam arası boyunca kullanıcı canlı reklamın İÇİNE seek edemesin diye. */
    disableSeeking(): void;
    enableSeeking(): void;
}

/** Google IMA DAI: stream StreamManager üzerinden istenir; reklam araları sırasında seek kilitlenir. */
export class DaiController {
    private dai: typeof google.ima.dai | null = null;
    private streamManager: google.ima.dai.api.StreamManager | null = null;
    private readonly metadataTrackListeners = new Map<TextTrack, () => void>();

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
        if (this.options.apiKey) request.apiKey = this.options.apiKey;
        if (this.options.adTagParameters) request.adTagParameters = this.options.adTagParameters;

        this.attachMetadataForwarding();
        this.streamManager.requestStream(request);
    }

    destroy(): void {
        this.ctx.videoEl.textTracks.removeEventListener('addtrack', this.onAddTrack);
        for (const [track, listener] of this.metadataTrackListeners) track.removeEventListener('cuechange', listener);
        this.metadataTrackListeners.clear();
        this.streamManager?.reset();
    }

    private readonly onStreamEvent = (event: google.ima.dai.api.StreamEvent): void => {
        if (!this.dai) return;
        const Type = this.dai.api.StreamEvent.Type;

        switch (event.type) {
            case Type.LOADED: {
                const { url } = event.getStreamData();
                void this.ctx.loadStreamUrl(url).then(() => void this.ctx.videoEl.play().catch(() => {}));
                break;
            }
            case Type.ERROR: {
                this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:aderror', { detail: { message: 'DAI stream error' } }));
                if (this.options.fallbackStreamUrl) void this.ctx.loadStreamUrl(this.options.fallbackStreamUrl);
                break;
            }
            case Type.AD_BREAK_STARTED:
                this.ctx.disableSeeking();
                this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adstart', { detail: { type: 'midroll' } }));
                break;
            case Type.AD_BREAK_ENDED:
                this.ctx.enableSeeking();
                this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adend', { detail: { type: 'midroll' } }));
                break;
            default:
                break;
        }
    };

    /** HLS live DAI reklam zamanlaması ID3/timed-metadata ile gelir — StreamManager.processMetadata()'ya iletilir. */
    private attachMetadataForwarding(): void {
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
                    this.streamManager.processMetadata('ID3', cue.value as Uint8Array | string, cue.startTime);
                } catch {
                    /* DAI akışla ilgisiz bir metadata cue'su olabilir — yoksay */
                }
            }
        };
        track.addEventListener('cuechange', listener);
        this.metadataTrackListeners.set(track, listener);
    }
}
