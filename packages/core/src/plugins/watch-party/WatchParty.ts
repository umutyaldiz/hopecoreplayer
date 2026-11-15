import type { WatchPartyMessage, WatchPartyOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { formatTime } from '../../utils/format-time';
import { showToast } from '../shared/toast';

export interface WatchPartyPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    isAdActive(): boolean;
}

/** Uzaktan uygulanan değişikliğin doğuracağı olay bu süre içinde gelmezse beklenmez (ms). */
const EXPECT_MS = 1500;
type Expect = 'play' | 'pause' | 'seek' | 'rate';

/**
 * Birlikte izle: yerel oynat / durdur / sarma / hız değişikliği `send` (ve `hp:watchparty` `send`) ile dışarı verilir;
 * kanalınızdan gelen mesaj `receive()` ile uygulanır — gecikme telafi edilir, `tolerance`'tan büyük fark hizalanır.
 * Kanal (WebSocket, Firebase, WebRTC…) entegratördedir; player yalnızca senkronu yapar.
 */
export class WatchParty {
    /** Uzaktan uygulanan değişikliklerin doğuracağı yerel olaylar — gelince yankı olarak yutulur, başkası gönderilir. */
    private expected = new Map<Expect, number>();
    private seekTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private pending: WatchPartyMessage | null = null;

    constructor(
        private readonly ctx: WatchPartyPlayerContext,
        private options: WatchPartyOptions
    ) {
        const v = ctx.videoEl;
        v.addEventListener('play', this.onPlay);
        v.addEventListener('pause', this.onPause);
        v.addEventListener('seeked', this.onSeeked);
        v.addEventListener('ratechange', this.onRate);
        this.startHeartbeat();
    }

    /** Aynı ayarların yeni `send` fonksiyonu (fonksiyonlar karşılaştırma anahtarına girmez). */
    setOptions(options: WatchPartyOptions): void {
        this.options = options;
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        v.removeEventListener('play', this.onPlay);
        v.removeEventListener('pause', this.onPause);
        v.removeEventListener('seeked', this.onSeeked);
        v.removeEventListener('ratechange', this.onRate);
        if (this.heartbeat) clearInterval(this.heartbeat);
        if (this.seekTimer) clearTimeout(this.seekTimer);
    }

    /** Reklam bitince bekleyen uzak durum uygulanır. */
    flush(): void {
        const m = this.pending;
        this.pending = null;
        if (m) this.receive(m);
    }

    /** O anki durumu `sync` olarak gönder (ör. yeni katılan biri için). */
    sendSync(): void {
        this.send('sync');
    }

    private startHeartbeat(): void {
        const every = this.options.heartbeat ?? 5;
        if (every <= 0) return;
        this.heartbeat = setInterval(() => {
            if (!this.ctx.videoEl.paused && !this.ctx.isAdActive()) this.send('sync');
        }, every * 1000);
    }

    /** Bu olay uzaktan uygulanan değişikliğin yankısı mı (öyleyse bir kez yutulur). */
    private echo(kind: Expect): boolean {
        if (this.ctx.isAdActive()) return true;
        const until = this.expected.get(kind);
        if (until === undefined) return false;
        this.expected.delete(kind);
        return Date.now() <= until;
    }

    private expect(kind: Expect): void {
        this.expected.set(kind, Date.now() + EXPECT_MS);
    }

    private message(type: WatchPartyMessage['type']): WatchPartyMessage {
        const v = this.ctx.videoEl;
        return { type, time: v.currentTime, paused: v.paused, rate: v.playbackRate, at: Date.now(), from: this.options.name };
    }

    private send(type: WatchPartyMessage['type']): void {
        const message = this.message(type);
        try {
            this.options.send?.(message);
        } catch {
            /* entegratörün kanalı hata verdi — senkron sürer */
        }
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:watchparty', { detail: { state: 'send', message } }));
    }

    private readonly onPlay = (): void => {
        if (!this.echo('play')) this.send('play');
    };
    private readonly onPause = (): void => {
        // Video sonu da 'pause' verir — onu da bildir, herkes dursun.
        if (!this.echo('pause')) this.send('pause');
    };
    private readonly onRate = (): void => {
        if (!this.echo('rate')) this.send('rate');
    };
    /** Sürüklerken art arda gelen seeked'ler tek mesaj olur. */
    private readonly onSeeked = (): void => {
        if (this.echo('seek')) return;
        if (this.seekTimer) clearTimeout(this.seekTimer);
        this.seekTimer = setTimeout(() => {
            this.seekTimer = null;
            if (!this.ctx.isAdActive()) this.send('seek');
        }, 200);
    };

    /** Kanalınızdan gelen mesajı uygula. */
    receive(message: WatchPartyMessage): void {
        if (!message || typeof message.time !== 'number') return;
        if (this.ctx.isAdActive()) {
            this.pending = message;
            return;
        }
        const v = this.ctx.videoEl;
        const rate = message.rate > 0 ? message.rate : 1;
        const elapsed = message.paused ? 0 : Math.max(0, (Date.now() - (message.at || Date.now())) / 1000) * rate;
        let expected = message.time + elapsed;
        if (Number.isFinite(v.duration)) expected = Math.min(expected, Math.max(0, v.duration - 0.1));
        const diff = Math.abs(v.currentTime - expected);
        const tolerance = this.options.tolerance ?? 1;

        if (v.playbackRate !== rate) {
            this.expect('rate');
            v.playbackRate = rate;
        }
        if (diff > tolerance || (message.type === 'seek' && diff > 0.05)) {
            this.expect('seek');
            v.currentTime = expected;
        }
        if (message.paused && !v.paused) {
            this.expect('pause');
            v.pause();
        } else if (!message.paused && v.paused) {
            this.expect('play');
            void v.play().catch(() => this.expected.delete('play'));
        }

        if (message.type === 'sync' && diff > tolerance) {
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:watchparty', { detail: { state: 'drift', message, diff } }));
        }
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:watchparty', { detail: { state: 'receive', message } }));
        this.notify(message, expected);
    }

    private notify(m: WatchPartyMessage, time: number): void {
        if (this.options.notify === false) return;
        const t = this.ctx.i18n;
        const who = m.from || t.partySomeone;
        const text = m.type === 'play' ? t.partyPlayed(who) : m.type === 'pause' ? t.partyPaused(who) : m.type === 'seek' ? t.partySeeked(who, formatTime(time)) : '';
        if (text) showToast(this.ctx.overlayEl, text);
    }
}
