import type { HistoryOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { formatTime } from '../../utils/format-time';
import { seekWhenReady } from '../shared/seekWhenReady';

export interface HistoryPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayContainerEl: HTMLElement;
    i18n: HopeLocaleStrings;
    /** Şu an yüklü kaynağın adresi (hls.js'te blob değil gerçek .m3u8) — `id` verilmezse videonun anahtarı. */
    currentSrc(): string | null;
    isAdActive(): boolean;
    /** `options.muted` — otomatik oynatma için sessiz istendiyse hatırlanan "sesli" durumu onu bozmasın. */
    mutedRequested(): boolean;
    /** QR ile devam (`?vtime=`) bu sayfa açılışında bir konum getirdiyse — ilk yüklemede o kazanır. */
    linkTimePresent: boolean;
}

const POSITIONS_KEY = 'hp-history-positions';
const VOLUME_KEY = 'hp-history-volume';
/** Bu kadar saniye izlenmeden konum kaydedilmez (yanlışlıkla açılan video). */
const DEFAULT_MIN_WATCHED = 10;
/** Sona bu kadar kala "bitti" sayılır — kayıt silinir, sonraki açılışta baştan başlar. */
const DEFAULT_END_MARGIN = 15;
const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_TTL_DAYS = 30;
/** Oynarken konum en fazla bu sıklıkla yazılır (ms). */
const SAVE_EVERY_MS = 5000;
const NOTICE_MS = 6000;

interface Entry {
    t: number;
    d: number;
    at: number;
}

/**
 * Zaman ve ses geçmişi: video yarıda bırakılırsa bir sonraki açılışta kaldığı yerden başlar ("Kaldığınız yerden devam:
 * 0:42 · Baştan başla" bildirimiyle); ses seviyesi ve sessiz durumu sitede hatırlanır. Kayıtlar tarayıcıda (localStorage).
 * Canlı yayında, reklam sırasında ve sona yakın konumda kayıt yapılmaz.
 */
export class PlaybackHistory {
    private key: string | null = null;
    private lastSaveAt = 0;
    private noticeEl: HTMLDivElement | null = null;
    private noticeTimer: ReturnType<typeof setTimeout> | null = null;
    private skipNextRestore: boolean;
    private readonly position: boolean;
    private readonly volume: boolean;
    private readonly minWatched: number;
    private readonly endMargin: number;

    constructor(
        private readonly ctx: HistoryPlayerContext,
        private readonly options: HistoryOptions
    ) {
        this.position = options.position !== false;
        this.volume = options.volume !== false;
        this.minWatched = options.minWatched ?? DEFAULT_MIN_WATCHED;
        this.endMargin = options.endMargin ?? DEFAULT_END_MARGIN;
        this.skipNextRestore = ctx.linkTimePresent;

        const v = ctx.videoEl;
        if (this.volume) {
            this.restoreVolume();
            v.addEventListener('volumechange', this.saveVolume);
        }
        if (this.position) {
            v.addEventListener('loadedmetadata', this.onLoadedMetadata);
            v.addEventListener('timeupdate', this.onTimeUpdate);
            v.addEventListener('pause', this.savePosition);
            v.addEventListener('seeked', this.savePosition);
            v.addEventListener('ended', this.onEnded);
            window.addEventListener('pagehide', this.savePosition);
            document.addEventListener('visibilitychange', this.onVisibility);
            if (v.readyState >= 1) this.onLoadedMetadata();
        }
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        this.savePosition();
        v.removeEventListener('volumechange', this.saveVolume);
        v.removeEventListener('loadedmetadata', this.onLoadedMetadata);
        v.removeEventListener('timeupdate', this.onTimeUpdate);
        v.removeEventListener('pause', this.savePosition);
        v.removeEventListener('seeked', this.savePosition);
        v.removeEventListener('ended', this.onEnded);
        window.removeEventListener('pagehide', this.savePosition);
        document.removeEventListener('visibilitychange', this.onVisibility);
        this.hideNotice();
    }

    refreshLabels(): void {
        this.hideNotice();
    }

    // ── Konum ──

    private videoKey(): string | null {
        if (this.options.id) return `id:${this.options.id}`;
        const src = this.ctx.currentSrc();
        if (!src || src.startsWith('blob:') || src.startsWith('data:')) return null;
        try {
            const u = new URL(src, location.href);
            u.hash = '';
            return u.href;
        } catch {
            return src;
        }
    }

    private readonly onLoadedMetadata = (): void => {
        const v = this.ctx.videoEl;
        this.key = this.videoKey();
        this.lastSaveAt = 0;
        if (!this.key || !Number.isFinite(v.duration)) return;
        // Link ile gelen konum (QR ile devam) yalnızca bu açılışta kazanır.
        if (this.skipNextRestore) {
            this.skipNextRestore = false;
            return;
        }
        // Başka bir şey zaten sarmışsa (ör. kaynak değişiminde korunan konum) dokunma.
        if (v.currentTime > 1) return;
        const entry = this.entries()[this.key];
        if (!entry || entry.t < this.minWatched || entry.t > v.duration - this.endMargin) return;
        seekWhenReady(v, entry.t, { attempts: 2 });
        this.showNotice(entry.t);
        this.emit('resumed', entry.t);
    };

    private readonly onTimeUpdate = (): void => {
        if (Date.now() - this.lastSaveAt < SAVE_EVERY_MS) return;
        this.savePosition();
    };

    private readonly onVisibility = (): void => {
        if (document.visibilityState === 'hidden') this.savePosition();
    };

    private readonly savePosition = (): void => {
        const v = this.ctx.videoEl;
        if (!this.key || this.ctx.isAdActive() || v.seeking) return;
        const d = v.duration;
        if (!Number.isFinite(d) || d <= 0) return; // canlı yayın
        this.lastSaveAt = Date.now();
        const t = v.currentTime;
        const all = this.entries();
        if (t >= d - this.endMargin) delete all[this.key];
        else if (t >= this.minWatched) all[this.key] = { t: Math.floor(t), d: Math.round(d), at: Date.now() };
        else return;
        this.store(all);
    };

    private readonly onEnded = (): void => {
        if (!this.key) return;
        const all = this.entries();
        delete all[this.key];
        this.store(all);
    };

    /** Süresi geçenleri at, en yeni `maxEntries` kaydı tut. */
    private store(all: Record<string, Entry>): void {
        const ttl = (this.options.ttlDays ?? DEFAULT_TTL_DAYS) * 86_400_000;
        const max = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        const now = Date.now();
        const kept = Object.entries(all)
            .filter(([, e]) => now - e.at < ttl)
            .sort((a, b) => b[1].at - a[1].at)
            .slice(0, max);
        write(POSITIONS_KEY, Object.fromEntries(kept));
    }

    private entries(): Record<string, Entry> {
        const raw = read<Record<string, Entry>>(POSITIONS_KEY);
        return raw && typeof raw === 'object' ? raw : {};
    }

    // ── Ses ──

    private restoreVolume(): void {
        const saved = read<{ volume: number; muted: boolean }>(VOLUME_KEY);
        if (!saved || typeof saved.volume !== 'number') return;
        const v = this.ctx.videoEl;
        v.volume = Math.min(1, Math.max(0, saved.volume));
        // Sessiz otomatik oynatma istendiyse (options.muted) "sesli" kaydı onu bozmasın; kullanıcı sessize aldıysa korunur.
        v.muted = this.ctx.mutedRequested() || !!saved.muted;
    }

    private readonly saveVolume = (): void => {
        if (this.ctx.isAdActive()) return;
        const v = this.ctx.videoEl;
        write(VOLUME_KEY, { volume: Math.round(v.volume * 100) / 100, muted: v.muted });
    };

    // ── Bildirim ──

    private showNotice(time: number): void {
        if (this.options.notice === false) return;
        this.hideNotice();
        const t = this.ctx.i18n;
        const el = document.createElement('div');
        el.className = 'hp-history-notice';
        el.setAttribute('part', 'history-notice');
        el.setAttribute('role', 'status');
        const text = document.createElement('span');
        text.textContent = t.historyResumed(formatTime(time));
        const restart = document.createElement('button');
        restart.type = 'button';
        restart.className = 'hp-history-restart';
        restart.textContent = t.historyRestart;
        restart.addEventListener('click', () => {
            const v = this.ctx.videoEl;
            v.currentTime = 0;
            if (this.key) {
                const all = this.entries();
                delete all[this.key];
                this.store(all);
            }
            this.emit('restart', 0);
            this.hideNotice();
        });
        el.append(text, restart);
        // Bildirimdeki tıklama oynat / duraklat'a geçmesin.
        for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
        this.ctx.overlayContainerEl.appendChild(el);
        this.noticeEl = el;
        this.noticeTimer = setTimeout(() => this.hideNotice(), NOTICE_MS);
    }

    private hideNotice(): void {
        if (this.noticeTimer) clearTimeout(this.noticeTimer);
        this.noticeTimer = null;
        this.noticeEl?.remove();
        this.noticeEl = null;
    }

    private emit(state: 'resumed' | 'restart', time: number): void {
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:history', { detail: { state, time, id: this.key } }));
    }
}

function read<T>(key: string): T | null {
    try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
    } catch {
        return null;
    }
}

function write(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* gizli sekme / kota dolu — geçmiş yalnızca bu oturumda yok */
    }
}
