// İzleyici deneyimi (QoE) ölçümleri ve izlenme olayları: hp:analytics, onEvent, GA4, toplu gönderim.
import type { HopeAnalyticsEvent, HopeAnalyticsEventType, HopeAnalyticsOptions, HopeAnalyticsPayload, HopeQoeMetrics } from '../../types';

export interface AnalyticsPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    currentSrc(): string | null;
    isAdActive(): boolean;
    currentLevel(): { height: number; bitrate: number | null } | null;
    engine(): string;
    isFullscreen(): boolean;
    /** `options.id`. */
    playerId(): string | undefined;
}

const DEFAULT_INTERVAL_MS = 15_000;
const MILESTONES = [25, 50, 75];
/** Bu kadar kısa takılmalar sayılmaz (ms). */
const MIN_REBUFFER_MS = 250;
/** Ses sürüklenirken tek olay. */
const VOLUME_DEBOUNCE_MS = 500;
const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;
const VIDEO_FULLSCREEN_EVENTS = ['webkitbeginfullscreen', 'webkitendfullscreen'] as const;
const PIP_EVENTS = ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged'] as const;

type Gtag = (cmd: 'event', name: string, params: Record<string, unknown>) => void;

function newSessionId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

export class QoeTracker {
    private sessionId = newSessionId();
    private sessionStart = performance.now();
    private queue: HopeAnalyticsEvent[] = [];
    private m: HopeQoeMetrics = emptyMetrics();
    private playIntentAt: number | null = null;
    private started = false;
    private lastPos = 0;
    private seeking = false;
    private stallAt: number | null = null;
    private adStartAt: number | null = null;
    private volumeTimer: ReturnType<typeof setTimeout> | null = null;
    private lastVolumeKey = '';
    private fullscreen = false;
    private pip = false;
    private bitrateTime = 0;
    private bitrateSum = 0;
    private lastLevelKey = '';
    private milestones = new Set<number>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private srcAtStart: string | null = null;

    constructor(
        private readonly ctx: AnalyticsPlayerContext,
        private readonly options: HopeAnalyticsOptions
    ) {
        const v = ctx.videoEl;
        v.addEventListener('play', this.onPlay);
        v.addEventListener('playing', this.onPlaying);
        v.addEventListener('pause', this.onPause);
        v.addEventListener('waiting', this.onWaiting);
        v.addEventListener('seeking', this.onSeeking);
        v.addEventListener('seeked', this.onSeeked);
        v.addEventListener('timeupdate', this.onTimeUpdate);
        v.addEventListener('ended', this.onEnded);
        v.addEventListener('error', this.onError);
        v.addEventListener('loadstart', this.onLoadStart);
        v.addEventListener('volumechange', this.onVolume);
        for (const n of VIDEO_FULLSCREEN_EVENTS) v.addEventListener(n, this.onFullscreen);
        for (const n of PIP_EVENTS) v.addEventListener(n, this.onPip);
        for (const n of FULLSCREEN_EVENTS) document.addEventListener(n, this.onFullscreen);
        this.lastVolumeKey = volumeKey(v);
        ctx.hostEl.addEventListener('hp:error', this.onPlayerError);
        ctx.hostEl.addEventListener('hp:adstart', this.onAdStart);
        ctx.hostEl.addEventListener('hp:adend', this.onAdEnd);
        window.addEventListener('pagehide', this.onPageHide);
        document.addEventListener('visibilitychange', this.onVisibility);
        this.timer = setInterval(this.onInterval, Math.max(1000, options.intervalMs ?? DEFAULT_INTERVAL_MS));
        this.srcAtStart = ctx.currentSrc();
        this.track('session_start');
    }

    get metrics(): HopeQoeMetrics {
        return this.snapshot();
    }

    destroy(): void {
        this.endSession('destroy');
        const v = this.ctx.videoEl;
        v.removeEventListener('play', this.onPlay);
        v.removeEventListener('playing', this.onPlaying);
        v.removeEventListener('pause', this.onPause);
        v.removeEventListener('waiting', this.onWaiting);
        v.removeEventListener('seeking', this.onSeeking);
        v.removeEventListener('seeked', this.onSeeked);
        v.removeEventListener('timeupdate', this.onTimeUpdate);
        v.removeEventListener('ended', this.onEnded);
        v.removeEventListener('error', this.onError);
        v.removeEventListener('loadstart', this.onLoadStart);
        v.removeEventListener('volumechange', this.onVolume);
        for (const n of VIDEO_FULLSCREEN_EVENTS) v.removeEventListener(n, this.onFullscreen);
        for (const n of PIP_EVENTS) v.removeEventListener(n, this.onPip);
        for (const n of FULLSCREEN_EVENTS) document.removeEventListener(n, this.onFullscreen);
        if (this.volumeTimer) clearTimeout(this.volumeTimer);
        this.ctx.hostEl.removeEventListener('hp:error', this.onPlayerError);
        this.ctx.hostEl.removeEventListener('hp:adstart', this.onAdStart);
        this.ctx.hostEl.removeEventListener('hp:adend', this.onAdEnd);
        window.removeEventListener('pagehide', this.onPageHide);
        document.removeEventListener('visibilitychange', this.onVisibility);
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    // ── Olaylar ──

    private readonly onLoadStart = (): void => {
        const src = this.ctx.currentSrc();
        if (!src || src === this.srcAtStart) return;
        // Oynatma başlamadıysa aynı oturum yeni kaynakla sürer.
        if (!this.started) {
            this.srcAtStart = src;
            return;
        }
        // Yeni içerik: eski oturumu kapat, yenisini aç.
        this.endSession('source');
        this.sessionId = newSessionId();
        this.sessionStart = performance.now();
        this.m = emptyMetrics();
        this.playIntentAt = null;
        this.started = false;
        this.lastPos = 0;
        this.stallAt = null;
        this.bitrateTime = 0;
        this.bitrateSum = 0;
        this.lastLevelKey = '';
        this.milestones.clear();
        this.srcAtStart = src;
        this.track('session_start');
    };

    private readonly onPlay = (): void => {
        if (this.ctx.isAdActive()) return;
        if (!this.started) {
            this.playIntentAt ??= performance.now();
            return;
        }
        this.track('resume');
    };

    private readonly onPlaying = (): void => {
        this.endStall();
        if (this.ctx.isAdActive() || this.started) return;
        this.started = true;
        const from = this.playIntentAt ?? performance.now();
        this.m.startupMs = Math.max(0, Math.round(performance.now() - from));
        this.track('start', { startupMs: this.m.startupMs, engine: this.ctx.engine() });
        this.ga4('video_start', {});
    };

    private readonly onPause = (): void => {
        this.endStall();
        const v = this.ctx.videoEl;
        if (!this.started || v.ended || this.ctx.isAdActive()) return;
        this.track('pause');
    };

    private readonly onWaiting = (): void => {
        const v = this.ctx.videoEl;
        if (!this.started || this.seeking || v.seeking || v.paused || this.ctx.isAdActive() || this.stallAt !== null) return;
        this.stallAt = performance.now();
    };

    private endStall(): void {
        if (this.stallAt === null) return;
        const ms = Math.round(performance.now() - this.stallAt);
        this.stallAt = null;
        if (ms < MIN_REBUFFER_MS) return;
        this.m.rebufferCount++;
        this.m.rebufferMs += ms;
        this.track('rebuffer', { durationMs: ms });
    }

    private readonly onSeeking = (): void => {
        this.stallAt = null;
        if (this.seeking) return;
        this.seeking = true;
        if (!this.started) return;
        this.m.seekCount++;
        this.track('seek', { from: round(this.lastPos), to: round(this.ctx.videoEl.currentTime) });
    };

    private readonly onSeeked = (): void => {
        this.seeking = false;
        this.lastPos = this.ctx.videoEl.currentTime;
    };

    private readonly onTimeUpdate = (): void => {
        const v = this.ctx.videoEl;
        const pos = v.currentTime;
        const delta = pos - this.lastPos;
        this.lastPos = pos;
        if (this.ctx.isAdActive() || !this.started) return;
        if (this.stallAt !== null && delta > 0) this.endStall();
        // Yalnızca doğal ilerleme (sarma değil).
        if (!v.paused && !this.seeking && delta > 0 && delta < 2) {
            this.m.watchedSeconds += delta;
            const lvl = this.ctx.currentLevel();
            if (lvl?.bitrate) {
                this.bitrateTime += delta;
                this.bitrateSum += delta * lvl.bitrate;
            }
        }
        this.checkLevel();
        const d = v.duration;
        if (Number.isFinite(d) && d > 0) {
            const pct = Math.min(100, (pos / d) * 100);
            if (pct > this.m.maxProgress) this.m.maxProgress = Math.round(pct * 10) / 10;
            for (const ms of MILESTONES) {
                if (pct >= ms && !this.milestones.has(ms)) {
                    this.milestones.add(ms);
                    this.track('progress', { percent: ms });
                    this.ga4('video_progress', { video_percent: ms });
                }
            }
        }
    };

    private checkLevel(): void {
        const lvl = this.ctx.currentLevel();
        if (!lvl) return;
        const key = `${lvl.height}:${lvl.bitrate ?? ''}`;
        if (key === this.lastLevelKey) return;
        const first = this.lastLevelKey === '';
        this.lastLevelKey = key;
        this.m.height = lvl.height;
        this.m.bitrate = lvl.bitrate;
        if (first) return;
        this.m.qualitySwitches++;
        this.track('quality', { height: lvl.height, bitrate: lvl.bitrate });
    }

    private readonly onEnded = (): void => {
        if (this.ctx.isAdActive()) return;
        this.endStall();
        this.m.maxProgress = 100;
        this.track('ended');
        this.ga4('video_complete', {});
        this.flush('end');
    };

    private readonly onError = (): void => {
        const e = this.ctx.videoEl.error;
        if (!e || this.ctx.isAdActive()) return;
        this.m.errors++;
        this.track('error', { code: e.code, message: e.message || null, fatal: true });
    };

    private readonly onPlayerError = (e: Event): void => {
        const d = (e as CustomEvent<{ code?: number; message: string }>).detail;
        // video.error zaten sayıldıysa tekrar sayma.
        if (this.ctx.videoEl.error && d?.code === this.ctx.videoEl.error.code) return;
        this.m.errors++;
        this.track('error', { code: d?.code ?? null, message: d?.message ?? null, fatal: true });
    };

    private readonly onAdStart = (e: Event): void => {
        const type = (e as CustomEvent<{ type?: string }>).detail?.type ?? null;
        this.adStartAt = performance.now();
        this.m.adCount++;
        this.track('ad_start', { adType: type });
    };

    private readonly onVolume = (): void => {
        // Oynatma isteğinden önceki değişiklik (seçeneklerle `muted`) izleyicinin değil.
        if (this.playIntentAt === null && !this.started) {
            this.lastVolumeKey = volumeKey(this.ctx.videoEl);
            return;
        }
        if (this.volumeTimer) clearTimeout(this.volumeTimer);
        this.volumeTimer = setTimeout(() => {
            this.volumeTimer = null;
            const v = this.ctx.videoEl;
            const key = volumeKey(v);
            if (key === this.lastVolumeKey) return;
            this.lastVolumeKey = key;
            const data = { volume: Math.round(v.volume * 100) / 100, muted: v.muted };
            this.track('volume', data);
            this.ga4('video_volume', data);
        }, VOLUME_DEBOUNCE_MS);
    };

    private readonly onFullscreen = (e: Event): void => {
        const active = e.type === 'webkitbeginfullscreen' ? true : e.type === 'webkitendfullscreen' ? false : this.ctx.isFullscreen();
        if (active === this.fullscreen) return;
        this.fullscreen = active;
        this.track('fullscreen', { active });
        this.ga4('video_fullscreen', { active });
    };

    private readonly onPip = (e: Event): void => {
        const v = this.ctx.videoEl as HTMLVideoElement & { webkitPresentationMode?: string };
        const active = e.type === 'enterpictureinpicture' ? true : e.type === 'leavepictureinpicture' ? false : v.webkitPresentationMode === 'picture-in-picture';
        if (active === this.pip) return;
        this.pip = active;
        this.track('pip', { active });
        this.ga4('video_pip', { active });
    };

    private readonly onAdEnd = (e: Event): void => {
        const type = (e as CustomEvent<{ type?: string }>).detail?.type ?? null;
        if (this.adStartAt !== null) this.m.adMs += Math.round(performance.now() - this.adStartAt);
        this.adStartAt = null;
        // Preroll'dan sonra açılış süresi reklam bitiminden ölçülür.
        if (!this.started && this.playIntentAt !== null) this.playIntentAt = performance.now();
        this.track('ad_end', { adType: type });
    };

    private readonly onInterval = (): void => {
        const v = this.ctx.videoEl;
        if (this.started && !v.paused && !v.ended) this.track('heartbeat');
        this.flush('interval');
    };

    private readonly onPageHide = (): void => this.endSession('pagehide');

    private readonly onVisibility = (): void => {
        if (document.visibilityState === 'hidden') this.flush('pagehide');
    };

    // ── Kayıt / gönderim ──

    private track(type: HopeAnalyticsEventType, data?: HopeAnalyticsEvent['data']): void {
        const event: HopeAnalyticsEvent = { type, at: Math.round(performance.now() - this.sessionStart), position: round(this.ctx.videoEl.currentTime), ...(data ? { data } : {}) };
        this.queue.push(event);
        const metrics = this.snapshot();
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:analytics', { detail: { event, metrics } }));
        try {
            this.options.onEvent?.(event, metrics);
        } catch (err) {
            console.error('[hope-player] analytics.onEvent:', err);
        }
    }

    private endSession(reason: string): void {
        if (!this.queue.length && !this.started) return;
        this.endStall();
        this.track('session_end');
        this.flush(reason);
    }

    private flush(reason: string): void {
        if (!this.queue.length) return;
        const events = this.queue.splice(0);
        if (!this.options.endpoint) return;
        const v = this.ctx.videoEl;
        let payload: HopeAnalyticsPayload | false = {
            v: 1,
            sessionId: this.sessionId,
            videoId: this.options.videoId ?? this.ctx.playerId() ?? this.ctx.currentSrc() ?? '',
            src: this.ctx.currentSrc(),
            reason,
            sentAt: Date.now(),
            events,
            metrics: this.snapshot(),
            ...(this.options.custom ? { custom: this.options.custom } : {}),
            engine: this.ctx.engine(),
            live: v.duration === Infinity,
            duration: Number.isFinite(v.duration) ? round(v.duration) : null,
        };
        try {
            if (this.options.beforeSend) payload = this.options.beforeSend(payload);
        } catch (err) {
            console.error('[hope-player] analytics.beforeSend:', err);
        }
        if (!payload) return;
        const body = JSON.stringify(payload);
        const url = this.options.endpoint;
        const leaving = reason === 'pagehide' || reason === 'destroy';
        if (!this.options.headers && leaving && navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
        void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json', ...this.options.headers } }).catch(() => {});
    }

    private ga4(name: string, params: Record<string, unknown>): void {
        const mode = this.options.ga4;
        if (!mode) return;
        const w = window as unknown as { gtag?: Gtag; dataLayer?: unknown[] };
        const v = this.ctx.videoEl;
        const data = {
            video_url: this.ctx.currentSrc() ?? undefined,
            video_title: this.options.videoId ?? this.ctx.playerId(),
            video_current_time: Math.round(v.currentTime),
            video_duration: Number.isFinite(v.duration) ? Math.round(v.duration) : undefined,
            video_provider: 'hopeplayer',
            ...params,
        };
        // true: gtag varsa gtag, yoksa (yalnızca GTM) dataLayer.
        const useGtag = mode === 'gtag' || (mode === true && typeof w.gtag === 'function');
        if (useGtag) {
            if (typeof w.gtag === 'function') w.gtag('event', name, data);
            return;
        }
        if (mode === 'dataLayer' || Array.isArray(w.dataLayer)) {
            w.dataLayer = w.dataLayer ?? [];
            w.dataLayer.push({ event: name, ...data });
        }
    }

    private snapshot(): HopeQoeMetrics {
        const m = this.m;
        const stall = this.stallAt !== null ? performance.now() - this.stallAt : 0;
        const rebufferMs = m.rebufferMs + (stall >= MIN_REBUFFER_MS ? Math.round(stall) : 0);
        const watchMs = m.watchedSeconds * 1000;
        const q = (this.ctx.videoEl as HTMLVideoElement & { getVideoPlaybackQuality?: () => VideoPlaybackQuality }).getVideoPlaybackQuality?.();
        return {
            ...m,
            watchedSeconds: round(m.watchedSeconds),
            rebufferMs,
            rebufferRatio: watchMs + rebufferMs > 0 ? Math.round((rebufferMs / (watchMs + rebufferMs)) * 10000) / 10000 : 0,
            avgBitrate: this.bitrateTime > 0 ? Math.round(this.bitrateSum / this.bitrateTime) : null,
            droppedFrames: q?.droppedVideoFrames ?? 0,
        };
    }
}

function emptyMetrics(): HopeQoeMetrics {
    return {
        startupMs: null,
        watchedSeconds: 0,
        rebufferCount: 0,
        rebufferMs: 0,
        rebufferRatio: 0,
        seekCount: 0,
        qualitySwitches: 0,
        avgBitrate: null,
        height: null,
        bitrate: null,
        maxProgress: 0,
        errors: 0,
        adCount: 0,
        adMs: 0,
        droppedFrames: 0,
    };
}

const round = (n: number): number => Math.round(n * 100) / 100;
const volumeKey = (v: HTMLVideoElement): string => `${Math.round(v.volume * 100)}:${v.muted}`;
