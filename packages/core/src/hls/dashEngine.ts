// dash.js sarmalayıcısı — yalnızca DASH kaynağı gelince indirilen parça.
import { MediaPlayer, type MediaPlayerClass, type Representation } from 'dashjs';
import type { HopeDashOptions, HopeDrmOptions } from '../types';
import { dashProtectionData, hasDrm } from '../drm/keySystems';

export interface DashLevel {
    index: number;
    height: number;
    bitrate: number;
}

export interface DashTrack {
    index: number;
    label: string;
    lang: string;
}

export interface DashCallbacks {
    onLevels(levels: DashLevel[], active: number): void;
    onAudioTracks(tracks: DashTrack[], active: number): void;
    onFatal(kind: 'network' | 'media' | 'drm' | 'unsupported'): void;
    onError(info: { code: number; message: string; fatal: boolean }): void;
    /** Şifreli içerikte seçilen anahtar sistemi. */
    onDrm?(keySystem: string): void;
}

/** DRM hata kodları (dash.js MediaPlayerErrors). */
const isDrmCode = (code: number): boolean => code === 24 || (code >= 100 && code <= 116);
const NETWORK_CODES = new Set([10, 11, 12, 15, 16, 17, 18, 19, 25, 26, 27, 28, 29]);
/** Tarayıcı bu içeriği çözemiyor (MSE / codec). */
const UNSUPPORTED_CODES = new Set([23, 35]);
/** Ölümcül sayılmayan: altyazı ayrıştırma. */
const NON_FATAL = new Set([33]);

export class DashEngine {
    private readonly player: MediaPlayerClass;
    private auto = true;

    constructor(
        video: HTMLVideoElement,
        src: string,
        options: { dash?: HopeDashOptions; drm?: HopeDrmOptions; autoplay: boolean },
        private readonly cb: DashCallbacks
    ) {
        const player = MediaPlayer().create();
        this.player = player;
        player.updateSettings({ streaming: { text: { defaultEnabled: false } }, ...(options.dash?.settings ?? {}) });
        if (options.dash?.withCredentials) {
            for (const t of ['MPD', 'MediaSegment', 'InitializationSegment', 'IndexSegment']) player.setXHRWithCredentialsForType(t, true);
        }
        if (hasDrm(options.drm)) player.setProtectionData(dashProtectionData(options.drm!));

        const ev = (MediaPlayer as unknown as { events?: Record<string, string> }).events;
        const E = (name: string, fallback: string): string => ev?.[name] ?? fallback;

        player.on(E('STREAM_INITIALIZED', 'streamInitialized') as never, () => {
            this.reportLevels();
            this.reportAudio();
        });
        player.on(E('QUALITY_CHANGE_RENDERED', 'qualityChangeRendered') as never, ((e: { mediaType: string }) => {
            if (e.mediaType === 'video') this.reportLevels();
        }) as never);
        player.on(E('TRACK_CHANGE_RENDERED', 'trackChangeRendered') as never, ((e: { mediaType: string }) => {
            if (e.mediaType === 'audio') this.reportAudio();
        }) as never);
        player.on(E('KEY_SYSTEM_SELECTED', 'public_keySystemSelected') as never, ((e: { data?: { keySystem?: { systemString?: string } } | null }) => {
            const ks = e.data?.keySystem?.systemString;
            if (ks) cb.onDrm?.(ks);
        }) as never);
        player.on(E('ERROR', 'error') as never, ((e: { error?: { code?: number; message?: string } }) => {
            const code = Number(e.error?.code ?? 0);
            const fatal = !NON_FATAL.has(code);
            cb.onError({ code, message: String(e.error?.message ?? 'DASH error'), fatal });
            if (!fatal) return;
            cb.onFatal(isDrmCode(code) ? 'drm' : NETWORK_CODES.has(code) ? 'network' : UNSUPPORTED_CODES.has(code) ? 'unsupported' : 'media');
        }) as never);

        player.initialize(video, src, options.autoplay);
    }

    private reps(): Representation[] {
        try {
            return this.player.getRepresentationsByType('video') ?? [];
        } catch {
            return [];
        }
    }

    private reportLevels(): void {
        const reps = this.reps();
        const current = this.player.getCurrentRepresentationForType('video');
        const levels = reps.map((r, index) => ({ index, height: r.height, bitrate: r.bandwidth }));
        this.cb.onLevels(levels, this.auto ? -1 : reps.findIndex((r) => r.id === current?.id));
    }

    private reportAudio(): void {
        const tracks = this.player.getTracksFor('audio') ?? [];
        const current = this.player.getCurrentTrackFor('audio');
        const list = tracks.map((t, index) => ({ index, label: t.labels?.[0]?.text || t.lang || `${index + 1}`, lang: t.lang ?? '' }));
        this.cb.onAudioTracks(list.length > 1 ? list : [], tracks.findIndex((t) => t.id === current?.id && t.lang === current?.lang));
    }

    /** -1 = otomatik. */
    setLevel(index: number): void {
        const rep = this.reps()[index];
        this.auto = index < 0 || !rep;
        this.player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: this.auto } } } });
        if (!this.auto) this.player.setRepresentationForTypeById('video', rep!.id, true);
        this.reportLevels();
    }

    /** ABR üst sınırı; -1 = yok. */
    setMaxLevel(index: number): void {
        const rep = this.reps()[index];
        this.player.updateSettings({ streaming: { abr: { maxBitrate: { video: index < 0 || !rep ? -1 : Math.ceil(rep.bandwidth / 1000) } } } });
    }

    setAudioTrack(index: number): void {
        const track = this.player.getTracksFor('audio')?.[index];
        if (track) this.player.setCurrentTrack(track);
    }

    /** O an oynayan video temsili. */
    currentLevel(): { height: number; bitrate: number } | null {
        const r = this.player.getCurrentRepresentationForType('video');
        return r ? { height: r.height, bitrate: r.bandwidth } : null;
    }

    get isLive(): boolean {
        try {
            return this.player.isDynamic();
        } catch {
            return false;
        }
    }

    destroy(): void {
        try {
            this.player.destroy();
        } catch {
            /* yok say */
        }
    }
}
