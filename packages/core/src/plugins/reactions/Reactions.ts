import type { ReactionsOptions, TimedComment } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { adoptStyle } from '../../utils/plugin-style';
import css from './reactions.css?inline';
import { storageGet, storageSet } from '../../utils/storage';

/** Kontrol çubuğu ikonu — yalnızca bu parçada (ana ikon fontuna girmez). */
const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.2L10.6 19.9C5.4 15.2 2 12.1 2 8.4C2 5.4 4.4 3 7.4 3C9.1 3 10.8 3.8 12 5.1C13.2 3.8 14.9 3 16.6 3C19.6 3 22 5.4 22 8.4C22 12.1 18.6 15.2 13.4 19.9Z"/></svg>';

export interface ReactionsPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    addButton(label: string, iconName: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
    registerToggle(row: { key: string; label: string; getValueLabel(): string; onToggle(): void }): void;
    unregisterToggle(key: string): void;
    isAdActive(): boolean;
    holdChrome(hold: boolean): void;
}

const DEFAULT_EMOJIS = ['👍', '❤️', '😂', '😮', '👏', '🔥'];
const STORE = 'hp-reactions-comments';
const LANES = 4;
/** Doğal ilerleme sayılan en büyük adım (sn) — daha büyüğü sarmadır, aradaki yorumlar atlanır. */
const MAX_STEP = 1.5;

/**
 * Tepkiler: tepsideki emojiye basınca ekranda yükselir (`hp:reaction`, `local: true` — sunucunuza iletin); uzaktan
 * gelenler `addReaction()` ile. Zamanlı yorumlar o saniyede ekranın üst kısmından sağdan sola akar; canlıda
 * `addComment()`. Ayarlar menüsünden kapatılabilir.
 */
export class Reactions {
    private button: HTMLButtonElement | null = null;
    private tray: HTMLElement | null = null;
    private layer: HTMLElement;
    private comments: TimedComment[];
    private showComments: boolean;
    private lastTime = 0;
    private laneFreeAt: number[] = new Array<number>(LANES).fill(0);
    private onScreen = 0;

    constructor(
        private readonly ctx: ReactionsPlayerContext,
        private readonly options: ReactionsOptions
    ) {
        adoptStyle(ctx.overlayEl, 'reactions', css);
        this.layer = document.createElement('div');
        this.layer.className = 'hp-react-layer';
        this.layer.setAttribute('part', 'reactions');
        this.layer.setAttribute('aria-hidden', 'true');
        ctx.overlayEl.appendChild(this.layer);
        this.comments = [...(options.comments ?? [])].filter((c) => c && typeof c.time === 'number' && c.text).sort((a, b) => a.time - b.time);
        this.showComments = this.restore();
        if (options.button !== false) {
            const { btn } = ctx.addButton(ctx.i18n.reactions, HEART_ICON, () => (this.tray ? this.closeTray() : this.openTray()));
            btn.setAttribute('aria-expanded', 'false');
            this.button = btn;
        }
        this.registerToggle();
        ctx.videoEl.addEventListener('timeupdate', this.onTime);
        ctx.videoEl.addEventListener('seeking', this.onSeek);
        this.lastTime = ctx.videoEl.currentTime;
    }

    refreshLabels(): void {
        this.button?.setAttribute('aria-label', this.ctx.i18n.reactions);
        this.registerToggle();
        if (this.tray) {
            this.closeTray();
            this.openTray();
        }
    }

    destroy(): void {
        this.closeTray();
        this.button?.remove();
        this.layer.remove();
        this.ctx.unregisterToggle('reactions-comments');
        this.ctx.videoEl.removeEventListener('timeupdate', this.onTime);
        this.ctx.videoEl.removeEventListener('seeking', this.onSeek);
    }

    private restore(): boolean {
        try {
            const v = storageGet(STORE);
            if (v === '0' || v === '1') return v === '1';
        } catch {
            /* depolama kapalı */
        }
        return this.options.showComments !== false;
    }

    private registerToggle(): void {
        const t = this.ctx.i18n;
        this.ctx.registerToggle({
            key: 'reactions-comments',
            label: t.reactionsShowComments,
            getValueLabel: () => (this.showComments ? t.reactionsOn : t.reactionsOff),
            onToggle: () => {
                this.showComments = !this.showComments;
                if (!this.showComments) this.layer.querySelectorAll('.hp-comment').forEach((c) => c.remove());
                try {
                    storageSet(STORE, this.showComments ? '1' : '0');
                } catch {
                    /* depolama kapalı */
                }
            },
        });
    }

    // ── Tepsi ──

    private openTray(): void {
        if (this.tray) return;
        const t = this.ctx.i18n;
        const tray = document.createElement('div');
        tray.className = 'hp-react-tray';
        tray.setAttribute('part', 'reactions-tray');
        tray.setAttribute('role', 'dialog');
        tray.setAttribute('aria-label', t.reactions);
        const row = document.createElement('div');
        row.className = 'hp-react-emojis';
        for (const emoji of this.options.emojis?.length ? this.options.emojis : DEFAULT_EMOJIS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'hp-react-emoji';
            b.textContent = emoji;
            b.setAttribute('aria-label', emoji);
            b.addEventListener('click', () => this.react(emoji));
            row.appendChild(b);
        }
        tray.appendChild(row);
        if (this.options.input) {
            const form = document.createElement('form');
            form.className = 'hp-react-form';
            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 140;
            input.placeholder = t.reactionsComment;
            input.setAttribute('aria-label', t.reactionsComment);
            const send = document.createElement('button');
            send.type = 'submit';
            send.textContent = t.reactionsSend;
            form.append(input, send);
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const text = input.value.trim();
                if (!text) return;
                input.value = '';
                const time = this.ctx.videoEl.currentTime;
                const ok = this.ctx.hostEl.dispatchEvent(
                    new CustomEvent('hp:reaction', { detail: { type: 'comment', text, time, local: true }, cancelable: true })
                );
                if (ok) this.spawnComment({ time, text });
            });
            tray.appendChild(form);
        }
        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) tray.addEventListener(ev, (e) => e.stopPropagation());
        // Yazarken kısayollar (Space, F…) player'a gitmesin.
        tray.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeTray();
                this.button?.focus();
            }
            e.stopPropagation();
        });
        this.ctx.overlayEl.appendChild(tray);
        this.tray = tray;
        this.ctx.holdChrome(true);
        this.button?.setAttribute('aria-expanded', 'true');
    }

    private closeTray(): void {
        if (!this.tray) return;
        this.tray.remove();
        this.tray = null;
        this.ctx.holdChrome(false);
        this.button?.setAttribute('aria-expanded', 'false');
    }

    /** Bu izleyicinin tepkisi: ekranda göster + `hp:reaction` (`local: true`). */
    private react(emoji: string): void {
        this.spawnReaction(emoji);
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:reaction', { detail: { type: 'reaction', emoji, time: this.ctx.videoEl.currentTime, local: true } }));
    }

    /** Uzaktan gelen tepki (ör. canlı yayında diğer izleyiciler). */
    addReaction(emoji: string): void {
        if (typeof emoji !== 'string' || !emoji) return;
        this.spawnReaction(emoji.slice(0, 8));
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:reaction', { detail: { type: 'reaction', emoji, time: this.ctx.videoEl.currentTime, local: false } }));
    }

    /** Uzaktan gelen yorum — hemen akar. */
    addComment(comment: { text: string; author?: string }): void {
        if (!comment || typeof comment.text !== 'string' || !comment.text.trim()) return;
        const time = this.ctx.videoEl.currentTime;
        this.spawnComment({ time, text: comment.text, author: comment.author });
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:reaction', { detail: { type: 'comment', text: comment.text, author: comment.author, time, local: false } }));
    }

    // ── Ekrana çizim ──

    private spawnReaction(emoji: string): void {
        if (this.ctx.isAdActive()) return;
        const el = document.createElement('span');
        el.className = 'hp-react-float';
        el.textContent = emoji;
        el.style.setProperty('--hp-react-x', `${Math.round((Math.random() - 0.5) * 60)}px`);
        el.style.setProperty('--hp-react-r', `${Math.round((Math.random() - 0.5) * 30)}deg`);
        this.layer.appendChild(el);
        const done = (): void => el.remove();
        el.addEventListener('animationend', done);
        setTimeout(done, 3200);
    }

    private spawnComment(c: TimedComment): void {
        if (!this.showComments || this.ctx.isAdActive()) return;
        const max = this.options.maxComments ?? 6;
        if (this.onScreen >= max) return;
        const now = performance.now();
        let lane = this.laneFreeAt.findIndex((free) => free <= now);
        if (lane < 0) lane = this.laneFreeAt.indexOf(Math.min(...this.laneFreeAt));
        const el = document.createElement('div');
        el.className = 'hp-comment';
        el.style.setProperty('--hp-comment-lane', String(lane));
        if (c.author) {
            const a = document.createElement('b');
            a.textContent = `${c.author}: `;
            el.appendChild(a);
        }
        el.appendChild(document.createTextNode(c.text.slice(0, 200)));
        this.layer.appendChild(el);
        this.onScreen++;
        // Uzun yorum daha uzun sürede geçer; şerit, yorum tamamen girince boşalır.
        const width = el.offsetWidth || 200;
        const area = this.ctx.overlayEl.clientWidth || 640;
        const seconds = Math.min(14, Math.max(6, (area + width) / 110));
        el.style.animationDuration = `${seconds}s`;
        this.laneFreeAt[lane] = now + (width / (area + width)) * seconds * 1000 + 400;
        const done = (): void => {
            if (!el.isConnected) return;
            el.remove();
            this.onScreen--;
        };
        el.addEventListener('animationend', done);
        setTimeout(done, seconds * 1000 + 500);
    }

    private readonly onTime = (): void => {
        const t = this.ctx.videoEl.currentTime;
        const from = this.lastTime;
        this.lastTime = t;
        if (t <= from || t - from > MAX_STEP || !this.comments.length) return;
        for (const c of this.comments) {
            if (c.time > t) break;
            if (c.time > from) this.spawnComment(c);
        }
    };

    private readonly onSeek = (): void => {
        this.lastTime = this.ctx.videoEl.currentTime;
    };
}
