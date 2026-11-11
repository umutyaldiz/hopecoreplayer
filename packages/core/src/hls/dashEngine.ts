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

export interface DashTextTrack {
    id: string;
    kind: 'subtitles' | 'captions';
    label: string;
    lang: string;
}

export interface DashCallbacks {
    /** Manifest altyazıları (boş = yok). */
    onTextTracks?(tracks: DashTextTrack[]): void;
    /** Seçili izin cue'ları (player'ın kendi katmanına kopyalanır). */
    onCues?(trackId: string, cues: VTTCue[]): void;
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
/** dash.js MediaPlayerEvents.MANAGED_MEDIA_SOURCE_START_STREAMING. */
const E_MMS_START = 'managedMediaSourceStartStreaming';

export class DashEngine {
    private readonly player: MediaPlayerClass;
    private auto = true;
    /** Dışarıdan gelen üst sınır (seviye sırası); -1 = yok. */
    private extCap = -1;
    private fitPlayer = false;
    private resize: ResizeObserver | null = null;
    /** Seçili manifest altyazısı (dash.js sırası); -1 = yok. */
    private textIndex = -1;
    /** Cue'lar dash.js dosyayı indirince eklenir — seçiliyken sayıyı izler. */
    private cueTimer: ReturnType<typeof setInterval> | null = null;
    private copied = -1;
    private readonly video: HTMLVideoElement;

    constructor(
        video: HTMLVideoElement,
        src: string,
        options: { dash?: HopeDashOptions; drm?: HopeDrmOptions; autoplay: boolean; fitPlayer?: boolean; cmcd?: { sessionId: string; contentId?: string; mode?: 'query' | 'header' } | null },
        private readonly cb: DashCallbacks
    ) {
        const player = MediaPlayer().create();
        this.player = player;
        this.video = video;
        video.addEventListener('timeupdate', this.syncCues);
        video.textTracks.addEventListener('addtrack', this.syncCues);
        player.updateSettings({ streaming: { text: { defaultEnabled: false } } });
        if (options.cmcd) {
            player.updateSettings({ streaming: { cmcd: { enabled: true, sid: options.cmcd.sessionId, cid: options.cmcd.contentId ?? null, mode: options.cmcd.mode ?? 'query' } } });
        }
        this.fitPlayer = !!options.fitPlayer;
        if (this.fitPlayer && typeof ResizeObserver !== 'undefined') {
            this.resize = new ResizeObserver(() => this.applyCap());
            this.resize.observe(video);
        }
        if (options.dash?.settings) player.updateSettings(options.dash.settings);
        if (options.dash?.withCredentials) {
            for (const t of ['MPD', 'MediaSegment', 'InitializationSegment', 'IndexSegment']) player.setXHRWithCredentialsForType(t, true);
        }
        if (hasDrm(options.drm)) player.setProtectionData(dashProtectionData(options.drm!));

        const ev = (MediaPlayer as unknown as { events?: Record<string, string> }).events;
        const E = (name: string, fallback: string): string => ev?.[name] ?? fallback;

        player.on(E('STREAM_INITIALIZED', 'streamInitialized') as never, () => {
            this.applyCap();
            this.reportLevels();
            this.reportAudio();
            this.reportText();
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

    private textInfos() {
        try {
            return this.player.getTracksFor('text') ?? [];
        } catch {
            return [];
        }
    }

    private reportText(): void {
        const list = this.textInfos().map((t, i) => {
            const role = (t.roles ?? []).map((r) => String((r as { value?: string }).value ?? '')).join(' ');
            return {
                id: `dash:${i}`,
                kind: /caption/i.test(role) ? ('captions' as const) : ('subtitles' as const),
                label: t.labels?.[0]?.text || '',
                lang: t.lang ?? '',
            };
        });
        this.cb.onTextTracks?.(list);
    }

    /** Altyazı seç (`dash:<i>`); null = kapalı. */
    selectText(id: string | null): void {
        const i = id?.startsWith('dash:') ? Number(id.slice(5)) : -1;
        this.textIndex = Number.isInteger(i) && i >= 0 ? i : -1;
        try {
            // Safari ManagedMediaSource: tampon doluyken "endstreaming" altyazı isteğini de durdurur — izin ver.
            if (this.textIndex >= 0 && 'ManagedMediaSource' in window) this.player.trigger(E_MMS_START as never, {}, {});
            this.player.setTextTrack(this.textIndex);
        } catch {
            /* yok say */
        }
        this.copied = -1;
        if (this.cueTimer) clearInterval(this.cueTimer);
        this.cueTimer = this.textIndex >= 0 ? setInterval(this.syncCues, 500) : null;
        this.syncCues();
    }

    /** dash.js'in video üstündeki izi: kendi çizimini gizle, cue'ları player katmanına kopyala. */
    private readonly syncCues = (): void => {
        const info = this.textInfos()[this.textIndex];
        for (const t of Array.from(this.video.textTracks)) {
            if (t.mode === 'showing' && this.isDashTrack(t)) t.mode = 'hidden';
        }
        if (!info || !this.cb.onCues) return;
        const track = Array.from(this.video.textTracks).find((t) => this.isDashTrack(t) && t.language === (info.lang ?? '') && t.label === String(info.id ?? t.label));
        if (!track?.cues?.length || track.cues.length === this.copied) return;
        this.copied = track.cues.length;
        const cues: VTTCue[] = [];
        for (const c of Array.from(track.cues) as VTTCue[]) cues.push(new VTTCue(c.startTime, c.endTime, c.text));
        this.cb.onCues(`dash:${this.textIndex}`, cues);
    };

    /** dash.js'in oluşturduğu iz: adı manifestteki AdaptationSet kimliği. */
    private isDashTrack(t: TextTrack): boolean {
        return this.textInfos().some((i) => String(i.id ?? '') === t.label && (i.lang ?? '') === t.language);
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
        this.extCap = index;
        this.applyCap();
    }

    /** Üst sınır: dış sınır ve player boyutu (fitPlayer). Şu anki kalite üstündeyse tampon değiştirilerek hemen düşülür. */
    private applyCap(): void {
        const reps = this.reps();
        if (!reps.length) return;
        let cap: Representation | undefined = reps[this.extCap];
        if (this.fitPlayer && this.video.clientHeight > 0) {
            const need = this.video.clientHeight * (window.devicePixelRatio || 1);
            const sorted = [...reps].sort((a, b) => a.height - b.height);
            const fit = sorted.find((r) => r.height >= need) ?? sorted[sorted.length - 1]!;
            if (!cap || fit.bandwidth < cap.bandwidth) cap = fit;
        }
        this.player.updateSettings({ streaming: { abr: { maxBitrate: { video: cap ? Math.ceil(cap.bandwidth / 1000) : -1 } } } });
        const current = this.player.getCurrentRepresentationForType('video');
        if (!cap || !this.auto || !current || current.bandwidth <= cap.bandwidth) return;
        // ABR bir sonraki kararı beklemesin: sınırdaki kaliteye geç, otomatiği geri aç.
        this.player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
        this.player.setRepresentationForTypeById('video', cap.id, true);
        this.player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
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
        this.video.removeEventListener('timeupdate', this.syncCues);
        this.resize?.disconnect();
        if (this.cueTimer) clearInterval(this.cueTimer);
        this.video.textTracks.removeEventListener('addtrack', this.syncCues);
        try {
            this.player.destroy();
        } catch {
            /* yok say */
        }
    }
}
