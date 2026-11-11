// Eklenti reklam API'si: reklam arası, preroll kapısı, midroll noktaları, duraklatma / bitiş kancaları, tag dönüşümü.
import type { PluginAdBreak, PluginAdBreakOptions, PluginAdBreakType, PluginCleanup } from './types';

export interface PluginAdsContext {
    element: HTMLElement;
    video: HTMLVideoElement;
    videoArea: HTMLElement;
    isAdPlaying(): boolean;
    /** Player'ın reklam kilidi (kontroller gizli, isAdPlaying true). */
    blockAds(): void;
    unblockAds(): void;
    log(message: string, details?: Record<string, string | number | boolean | undefined>): void;
}

const DEFAULT_BREAK_TIMEOUT_MS = 60_000;
const PREROLL_GATE_TIMEOUT_MS = 15_000;
const DEFAULT_PAUSE_DELAY_MS = 300;
/** Reklam arasında engellenen içerik kısayolları. */
const BLOCKED_KEYS = new Set([' ', 'k', 'j', 'l', 'ArrowLeft', 'ArrowRight']);

type Guard = <A extends unknown[]>(fn: (...args: A) => unknown, where?: string) => (...args: A) => void;

interface Mid {
    owner: string;
    marks: number[];
    fired: Set<number>;
    seekPast: 'last' | 'skip';
    fire: (mark: number) => void;
}

interface Active {
    owner: string;
    finish: () => void;
}

export class PluginAds {
    private active: Active | null = null;
    private prerolls: Array<{ owner: string; run: () => unknown }> = [];
    private mids: Mid[] = [];
    private pauses: Array<{ owner: string; run: () => unknown; delayMs: number }> = [];
    private endeds: Array<{ owner: string; run: () => void }> = [];
    private transforms: Array<{ owner: string; fn: (url: string, type: PluginAdBreakType) => string }> = [];
    private prerollDone = false;
    private gateRunning = false;
    private contentStarted = false;
    private lastPos = 0;
    private seekPending = false;
    private pauseTimer: ReturnType<typeof setTimeout> | null = null;
    private pauseCleanups: Array<() => void> = [];

    constructor(private readonly ctx: PluginAdsContext) {
        const v = ctx.video;
        v.addEventListener('loadstart', this.onLoadStart);
        v.addEventListener('play', this.onPlay, true);
        v.addEventListener('playing', this.onPlaying);
        v.addEventListener('timeupdate', this.onTimeUpdate);
        v.addEventListener('seeking', this.onSeeking);
        v.addEventListener('pause', this.onPause);
        // Capture: playlist / yönlendirme dinleyicilerinden önce — postroll arası onlar çalışmadan başlar.
        v.addEventListener('ended', this.onEnded, true);
        ctx.element.addEventListener('keydown', this.onKeyDown, true);
    }

    destroy(): void {
        const v = this.ctx.video;
        v.removeEventListener('loadstart', this.onLoadStart);
        v.removeEventListener('play', this.onPlay, true);
        v.removeEventListener('playing', this.onPlaying);
        v.removeEventListener('timeupdate', this.onTimeUpdate);
        v.removeEventListener('seeking', this.onSeeking);
        v.removeEventListener('pause', this.onPause);
        v.removeEventListener('ended', this.onEnded, true);
        this.ctx.element.removeEventListener('keydown', this.onKeyDown, true);
        this.active?.finish();
        this.clearPause();
    }

    /** Eklenti kaldırılınca onun kayıtları ve süren arası. */
    removeOwner(owner: string): void {
        this.prerolls = this.prerolls.filter((x) => x.owner !== owner);
        this.mids = this.mids.filter((x) => x.owner !== owner);
        this.pauses = this.pauses.filter((x) => x.owner !== owner);
        this.endeds = this.endeds.filter((x) => x.owner !== owner);
        this.transforms = this.transforms.filter((x) => x.owner !== owner);
        if (this.active?.owner === owner) this.active.finish();
    }

    /** IMA isteği öncesi tüm eklentilerin dönüşümleri. */
    transformTag(url: string, type: PluginAdBreakType): string {
        let out = url;
        for (const t of this.transforms) {
            try {
                const next = t.fn(out, type);
                if (typeof next === 'string' && next) out = next;
            } catch (err) {
                this.ctx.log(`Plugin "${t.owner}" failed in ads.transformTag: ${(err as Error)?.message ?? err}`, { plugin: t.owner });
            }
        }
        return out;
    }

    /** Bir eklentiye verilen `ads` nesnesi. */
    api(owner: string, guard: Guard) {
        const add = <T>(list: T[], item: T): (() => void) => {
            list.push(item);
            return () => {
                const i = list.indexOf(item);
                if (i >= 0) list.splice(i, 1);
            };
        };
        return {
            requestBreak: (run: (ad: PluginAdBreak) => void | Promise<void>, options?: PluginAdBreakOptions) => this.requestBreak(owner, run, options),
            beforeContent: (run: () => unknown) => add(this.prerolls, { owner, run }),
            atTime: (seconds: number | number[], run: (s: number) => unknown, options?: { seekPast?: 'last' | 'skip' }) => {
                const marks = (Array.isArray(seconds) ? seconds : [seconds]).filter((s) => Number.isFinite(s) && s >= 0).sort((a, b) => a - b);
                const fire = guard((m: number) => run(m), 'ads.atTime');
                return add(this.mids, { owner, marks, fired: new Set<number>(), seekPast: options?.seekPast ?? 'last', fire });
            },
            onPause: (run: () => void | PluginCleanup, options?: { delayMs?: number }) =>
                add(this.pauses, { owner, run: () => run(), delayMs: options?.delayMs ?? DEFAULT_PAUSE_DELAY_MS }),
            onEnded: (run: () => unknown) => add(this.endeds, { owner, run: guard(() => run(), 'ads.onEnded') }),
            transformTag: (fn: (url: string, type: PluginAdBreakType) => string) => add(this.transforms, { owner, fn }),
        };
    }

    // ── Reklam arası ──

    private requestBreak(owner: string, run: (ad: PluginAdBreak) => void | Promise<void>, options?: PluginAdBreakOptions): Promise<boolean> {
        if (this.active || this.ctx.isAdPlaying()) return Promise.resolve(false);
        const v = this.ctx.video;
        const type: PluginAdBreakType = options?.type ?? (v.ended ? 'postroll' : !this.contentStarted ? 'preroll' : 'midroll');
        const wasPlaying = !v.paused && !v.ended;
        if (!v.paused) v.pause();
        this.ctx.blockAds();

        const layer = document.createElement('div');
        layer.className = 'hp-plugin-layer hp-plugin-ad';
        layer.setAttribute('part', `plugin-ad plugin-${owner}`);
        layer.dataset.plugin = owner;
        layer.dataset.position = 'fill';
        layer.toggleAttribute('data-above', true);
        layer.toggleAttribute('data-interactive', true);
        for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick'] as const) layer.addEventListener(ev, (e) => e.stopPropagation());
        this.ctx.videoArea.appendChild(layer);

        const ctrl = new AbortController();
        this.emit('hp:adstart', type, owner);

        return new Promise<boolean>((resolve) => {
            let done = false;
            const finish = (): void => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                ctrl.abort();
                layer.remove();
                this.active = null;
                this.ctx.unblockAds();
                this.emit('hp:adend', type, owner);
                if (wasPlaying && type !== 'postroll') void v.play().catch(() => {});
                resolve(true);
            };
            const timer = setTimeout(() => {
                this.ctx.log(`Plugin "${owner}" ad break timed out`, { plugin: owner, type });
                finish();
            }, options?.timeoutMs ?? DEFAULT_BREAK_TIMEOUT_MS);
            this.active = { owner, finish };
            const fail = (err: unknown): void => {
                this.ctx.log(`Plugin "${owner}" failed in ads.requestBreak: ${(err as Error)?.message ?? err}`, { plugin: owner, type });
                finish();
            };
            try {
                Promise.resolve(run({ type, layer, signal: ctrl.signal, end: finish })).then(finish, fail);
            } catch (err) {
                fail(err);
            }
        });
    }

    private emit(name: 'hp:adstart' | 'hp:adend', type: PluginAdBreakType, plugin: string): void {
        this.ctx.element.dispatchEvent(new CustomEvent(name, { detail: { type, linear: true, plugin } }));
    }

    // ── Olaylar ──

    private readonly onLoadStart = (): void => {
        this.prerollDone = false;
        this.contentStarted = false;
        this.lastPos = 0;
        for (const m of this.mids) m.fired.clear();
        this.clearPause();
    };

    private readonly onPlay = (): void => {
        const v = this.ctx.video;
        // Reklam arasında / preroll beklenirken içerik oynamaz.
        if (this.active || this.gateRunning) {
            v.pause();
            return;
        }
        this.clearPause();
        if (this.prerollDone || !this.prerolls.length || this.ctx.isAdPlaying()) return;
        this.prerollDone = true;
        v.pause();
        void this.runPrerolls();
    };

    private async runPrerolls(): Promise<void> {
        this.gateRunning = true;
        const all = Promise.all(
            this.prerolls.map((p) =>
                Promise.resolve()
                    .then(() => p.run())
                    .catch((err) => this.ctx.log(`Plugin "${p.owner}" failed in ads.beforeContent: ${(err as Error)?.message ?? err}`, { plugin: p.owner }))
            )
        );
        await Promise.race([all, new Promise((r) => setTimeout(r, PREROLL_GATE_TIMEOUT_MS))]);
        // Süren bir ara varsa onun bitmesini bekle.
        while (this.active) await new Promise((r) => setTimeout(r, 100));
        this.gateRunning = false;
        void this.ctx.video.play().catch(() => {});
    }

    private readonly onPlaying = (): void => {
        if (!this.active && !this.ctx.isAdPlaying()) this.contentStarted = true;
    };

    private readonly onSeeking = (): void => {
        this.seekPending = true;
    };

    private readonly onTimeUpdate = (): void => {
        const v = this.ctx.video;
        const pos = v.currentTime;
        const prev = this.lastPos;
        this.lastPos = pos;
        const seeked = this.seekPending;
        this.seekPending = false;
        if (this.active || this.ctx.isAdPlaying() || v.paused || v.seeking || pos <= prev) return;
        for (const m of this.mids) {
            const crossed = m.marks.filter((s) => prev < s && s <= pos && !m.fired.has(s));
            if (!crossed.length) continue;
            for (const s of crossed) m.fired.add(s);
            // İleri sarınca geçilen noktalardan yalnızca sonuncusu (ya da hiçbiri).
            if (seeked && m.seekPast === 'skip') continue;
            m.fire(crossed[crossed.length - 1]!);
        }
    };

    private readonly onPause = (): void => {
        const v = this.ctx.video;
        if (!this.pauses.length || v.ended || v.seeking || this.active || this.gateRunning || this.ctx.isAdPlaying()) return;
        this.clearPause();
        const delay = Math.min(...this.pauses.map((p) => p.delayMs));
        this.pauseTimer = setTimeout(() => {
            this.pauseTimer = null;
            if (!v.paused || v.ended || this.active || this.ctx.isAdPlaying()) return;
            for (const p of this.pauses) {
                try {
                    const cleanup = p.run();
                    if (typeof cleanup === 'function') this.pauseCleanups.push(cleanup as () => void);
                } catch (err) {
                    this.ctx.log(`Plugin "${p.owner}" failed in ads.onPause: ${(err as Error)?.message ?? err}`, { plugin: p.owner });
                }
            }
        }, delay);
    };

    private clearPause(): void {
        if (this.pauseTimer) clearTimeout(this.pauseTimer);
        this.pauseTimer = null;
        for (const c of this.pauseCleanups.splice(0)) {
            try {
                c();
            } catch {
                /* yok say */
            }
        }
    }

    private readonly onEnded = (): void => {
        this.clearPause();
        for (const e of this.endeds) e.run();
    };

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        if ((this.active || this.gateRunning) && BLOCKED_KEYS.has(e.key)) e.preventDefault();
    };
}
