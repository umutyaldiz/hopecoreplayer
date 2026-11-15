import type { ClipOptions, ShareNetwork } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { createIcon } from '../../icons/Icon';
import { formatTime } from '../../utils/format-time';
import { adoptStyle } from '../../utils/plugin-style';
import { NETWORK_NAMES, copyText, networkUrl, shareBaseUrl } from '../shared/shareNetworks';
import { seekWhenReady } from '../shared/seekWhenReady';
import css from './clips.css?inline';

/** Kontrol çubuğu ikonu — yalnızca bu parçada (ana ikon fontuna girmez). */
const SCISSORS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 6.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z M4.3 6.5a1.7 1.7 0 1 1 3.4 0a1.7 1.7 0 1 1 -3.4 0Z M2.5 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z M4.3 17.5a1.7 1.7 0 1 1 3.4 0a1.7 1.7 0 1 1 -3.4 0Z M9.1 7.9L21 17.6L19.8 19L7.9 9.3Z M7.9 14.7L19.8 5L21 6.4L9.1 16.1Z"/></svg>';

export interface ClipPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    seekBarEl: HTMLElement;
    ratioAtClientX(clientX: number): number;
    i18n: HopeLocaleStrings;
    addButton(label: string, iconName: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
    isLive(): boolean;
    holdChrome(hold: boolean): void;
}

const DEFAULT_NETWORKS: ShareNetwork[] = ['x', 'whatsapp', 'telegram', 'email'];

/** "80-105", "1:20-1:45" → [başlangıç, bitiş] sn; geçersizse null. */
export function parseClipParam(raw: string | null): [number, number] | null {
    if (!raw) return null;
    const m = /^\s*([\d.:]+)\s*[-~]\s*([\d.:]+)\s*$/.exec(raw);
    if (!m) return null;
    const sec = (v: string): number => (v.includes(':') ? v.split(':').reduce((a, p) => a * 60 + Number(p), 0) : Number(v));
    const a = sec(m[1]!);
    const b = sec(m[2]!);
    return Number.isFinite(a) && Number.isFinite(b) && b > a && a >= 0 ? [a, b] : null;
}

const fmt = (n: number): string => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

interface Editor {
    panel: HTMLElement;
    range: HTMLElement;
    startEl: HTMLElement;
    endEl: HTMLElement;
    lengthEl: HTMLElement;
    input: HTMLInputElement;
}

/**
 * Klip: izleyici seek bar üzerinde bir aralık seçer (tutamaçlar ya da ±1 sn butonları), bağlantı yalnızca o kısmı
 * oynatır (`?clip=80-105`). Sayfa o bağlantıyla açılınca aralık işaretlenir, sonunda başa döner; "Tüm videoyu izle"
 * ya da aralık dışına sarmak klip modundan çıkar.
 */
export class Clips {
    private button: HTMLButtonElement | null = null;
    private editor: Editor | null = null;
    private start = 0;
    private end = 0;
    /** Önizleme ya da ?clip= oynatması: bu aralıkta kal. */
    private bound: { start: number; end: number; loop: boolean } | null = null;
    private mark: HTMLElement | null = null;
    private badge: HTMLElement | null = null;
    private copyTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly param: string;

    constructor(
        private readonly ctx: ClipPlayerContext,
        private readonly options: ClipOptions
    ) {
        adoptStyle(ctx.overlayEl, 'clips', css);
        adoptStyle(ctx.seekBarEl, 'clips', css);
        this.param = options.param || 'clip';
        if (options.button !== false) {
            const { btn } = ctx.addButton(ctx.i18n.clip, SCISSORS_ICON, () => (this.editor ? this.close() : this.open()));
            this.button = btn;
        }
        ctx.videoEl.addEventListener('timeupdate', this.onTime);
        ctx.videoEl.addEventListener('seeking', this.onSeeking);
        if (options.readParam !== false) this.applyParam();
    }

    private get min(): number {
        return Math.max(1, this.options.minDuration ?? 3);
    }
    private get max(): number {
        return Math.max(this.min, this.options.maxDuration ?? 60);
    }
    private get duration(): number {
        const d = this.ctx.videoEl.duration;
        return Number.isFinite(d) ? d : 0;
    }

    refreshLabels(): void {
        this.button?.setAttribute('aria-label', this.ctx.i18n.clip);
        if (this.editor) {
            this.close();
            this.open();
        }
        if (this.badge && this.bound) this.showBadge(this.bound.end - this.bound.start);
    }

    destroy(): void {
        this.close();
        this.exitClip(false);
        this.button?.remove();
        this.ctx.videoEl.removeEventListener('timeupdate', this.onTime);
        this.ctx.videoEl.removeEventListener('seeking', this.onSeeking);
    }

    private url(): string {
        const u = new URL(shareBaseUrl(this.options.url, [this.param, 't']));
        u.searchParams.set(this.param, `${fmt(this.start)}-${fmt(this.end)}`);
        return u.toString();
    }

    private emit(state: 'open' | 'copy' | 'share' | 'play' | 'exit', network?: ShareNetwork | 'native'): boolean {
        const b = this.bound && (state === 'play' || state === 'exit') ? this.bound : null;
        const start = b ? b.start : this.start;
        const end = b ? b.end : this.end;
        return this.ctx.hostEl.dispatchEvent(
            new CustomEvent('hp:clip', { detail: { state, start, end, url: this.url(), network }, cancelable: state === 'copy' || state === 'share' })
        );
    }

    // ── Seçici ──

    /** Klip seçiciyi aç: aralık o anki saniyeden başlar. */
    open(): void {
        if (this.editor || this.ctx.isLive() || !this.duration) return;
        this.exitClip(false);
        const v = this.ctx.videoEl;
        v.pause();
        const len = Math.min(this.max, Math.max(this.min, this.options.defaultDuration ?? 15));
        this.start = Math.max(0, Math.min(Math.floor(v.currentTime), this.duration - this.min));
        this.end = Math.min(this.duration, this.start + len);
        const t = this.ctx.i18n;

        const panel = document.createElement('div');
        panel.className = 'hp-clip';
        panel.setAttribute('part', 'clip');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', t.clipTitle);

        const head = document.createElement('div');
        head.className = 'hp-clip-head';
        const h = document.createElement('span');
        h.className = 'hp-clip-title';
        h.textContent = t.clipTitle;
        const close = this.iconBtn('close', t.clipClose, () => this.close());
        head.append(h, close);

        const times = document.createElement('div');
        times.className = 'hp-clip-times';
        const startEl = document.createElement('span');
        const endEl = document.createElement('span');
        times.append(this.timeBox(t.clipStart, startEl, 'start'), this.timeBox(t.clipEnd, endEl, 'end'));

        const meta = document.createElement('div');
        meta.className = 'hp-clip-meta';
        const lengthEl = document.createElement('span');
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'hp-clip-preview';
        preview.textContent = t.clipPreview;
        preview.addEventListener('click', () => this.preview());
        meta.append(lengthEl, preview);

        const row = document.createElement('div');
        row.className = 'hp-clip-link';
        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        input.setAttribute('aria-label', t.clipTitle);
        input.addEventListener('focus', () => input.select());
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'hp-clip-copy';
        copy.textContent = t.clipCopy;
        copy.addEventListener('click', () => {
            if (!this.emit('copy')) return;
            const done = (): void => {
                copy.textContent = t.clipCopied;
                if (this.copyTimer) clearTimeout(this.copyTimer);
                this.copyTimer = setTimeout(() => (copy.textContent = t.clipCopy), 2000);
            };
            void copyText(input.value, input).then(done, done);
        });
        row.append(input, copy);
        panel.append(head, times, meta, row);

        const networks = this.options.networks ?? DEFAULT_NETWORKS;
        const native = typeof navigator.share === 'function';
        if (networks.length || native) {
            const list = document.createElement('div');
            list.className = 'hp-clip-networks';
            const title = this.options.title ?? document.title;
            for (const n of networks) {
                if (!NETWORK_NAMES[n]) continue;
                list.appendChild(
                    this.textBtn(NETWORK_NAMES[n], () => {
                        if (!this.emit('share', n)) return;
                        const target = networkUrl(n, this.url(), title);
                        if (n === 'email') location.href = target;
                        else window.open(target, '_blank', 'noopener,width=640,height=560');
                    })
                );
            }
            if (native)
                list.appendChild(
                    this.textBtn(t.clipMore, () => {
                        if (this.emit('share', 'native')) void navigator.share({ url: this.url(), title }).catch(() => {});
                    })
                );
            panel.appendChild(list);
        }

        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) panel.addEventListener(ev, (e) => e.stopPropagation());
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
                this.button?.focus();
            }
            e.stopPropagation();
        });

        const range = this.rangeEl(true);
        this.ctx.seekBarEl.appendChild(range);
        this.ctx.overlayEl.appendChild(panel);
        this.editor = { panel, range, startEl, endEl, lengthEl, input };
        this.ctx.holdChrome(true);
        this.button?.setAttribute('aria-expanded', 'true');
        this.render();
        copy.focus({ preventScroll: true });
        this.emit('open');
    }

    close(): void {
        if (!this.editor) return;
        if (this.copyTimer) clearTimeout(this.copyTimer);
        this.editor.panel.remove();
        this.editor.range.remove();
        this.editor = null;
        if (this.bound && !this.badge) this.bound = null;
        this.ctx.holdChrome(false);
        this.button?.setAttribute('aria-expanded', 'false');
    }

    private iconBtn(icon: string, label: string, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hp-clip-icon';
        b.setAttribute('aria-label', label);
        b.appendChild(createIcon(icon));
        b.addEventListener('click', onClick);
        return b;
    }

    private textBtn(text: string, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hp-clip-net';
        b.textContent = text;
        b.addEventListener('click', onClick);
        return b;
    }

    /** "Başlangıç 1:20 [−][+]" — klavye / dokunmatikle 1 sn ayar. */
    private timeBox(label: string, valueEl: HTMLElement, edge: 'start' | 'end'): HTMLElement {
        const box = document.createElement('div');
        box.className = 'hp-clip-time';
        const l = document.createElement('small');
        l.textContent = label;
        valueEl.className = 'hp-clip-value';
        const minus = this.textBtn('−', () => this.nudge(edge, -1));
        const plus = this.textBtn('+', () => this.nudge(edge, 1));
        minus.setAttribute('aria-label', `${label} −1`);
        plus.setAttribute('aria-label', `${label} +1`);
        box.append(l, minus, valueEl, plus);
        return box;
    }

    private nudge(edge: 'start' | 'end', delta: number): void {
        this.setEdge(edge, (edge === 'start' ? this.start : this.end) + delta);
    }

    /** Uç taşınır; uzunluk min–max arasında kalır (gerekirse diğer uç da kayar). */
    private setEdge(edge: 'start' | 'end', value: number): void {
        const d = this.duration;
        if (edge === 'start') {
            this.start = Math.max(0, Math.min(value, d - this.min));
            if (this.end - this.start < this.min) this.end = Math.min(d, this.start + this.min);
            if (this.end - this.start > this.max) this.end = this.start + this.max;
        } else {
            this.end = Math.min(d, Math.max(value, this.min));
            if (this.end - this.start < this.min) this.start = Math.max(0, this.end - this.min);
            if (this.end - this.start > this.max) this.start = this.end - this.max;
        }
        this.render();
    }

    private render(): void {
        const e = this.editor;
        if (!e) return;
        const t = this.ctx.i18n;
        e.startEl.textContent = formatTime(this.start);
        e.endEl.textContent = formatTime(this.end);
        e.lengthEl.textContent = t.clipLength(formatTime(this.end - this.start));
        e.input.value = this.url();
        this.placeRange(e.range, this.start, this.end);
    }

    private placeRange(el: HTMLElement, start: number, end: number): void {
        const d = this.duration || 1;
        el.style.left = `${(start / d) * 100}%`;
        el.style.width = `${((end - start) / d) * 100}%`;
    }

    /** Seek bar üzerindeki aralık; `editable` ise iki tutamaç sürüklenebilir. */
    private rangeEl(editable: boolean): HTMLElement {
        const range = document.createElement('div');
        range.className = 'hp-clip-range';
        range.setAttribute('part', 'clip-range');
        if (!editable) return range;
        for (const edge of ['start', 'end'] as const) {
            const handle = document.createElement('div');
            handle.className = 'hp-clip-handle';
            handle.setAttribute('data-edge', edge);
            handle.addEventListener('pointerdown', (e) => {
                // Seek bar'ın kendi sarmasına geçmesin.
                e.stopPropagation();
                e.preventDefault();
                handle.setPointerCapture(e.pointerId);
                const move = (ev: PointerEvent): void => this.setEdge(edge, this.ctx.ratioAtClientX(ev.clientX) * this.duration);
                const up = (): void => {
                    handle.removeEventListener('pointermove', move);
                    handle.removeEventListener('pointerup', up);
                    handle.removeEventListener('pointercancel', up);
                };
                handle.addEventListener('pointermove', move);
                handle.addEventListener('pointerup', up);
                handle.addEventListener('pointercancel', up);
            });
            range.appendChild(handle);
        }
        return range;
    }

    /** Seçili aralığı bir kez oynat. */
    private preview(): void {
        this.bound = { start: this.start, end: this.end, loop: false };
        const v = this.ctx.videoEl;
        seekWhenReady(v, this.start, { done: () => void v.play().catch(() => {}) });
    }

    // ── Oynatma sınırı ──

    private readonly onTime = (): void => {
        const b = this.bound;
        if (!b) return;
        const v = this.ctx.videoEl;
        if (v.currentTime >= b.end - 0.05) {
            if (b.loop) v.currentTime = b.start;
            else {
                v.pause();
                if (!this.badge) this.bound = null;
            }
        }
    };

    /** Aralığın dışına sarılırsa klip modundan çıkılır. */
    private readonly onSeeking = (): void => {
        const b = this.bound;
        if (!b || !this.badge) return;
        const t = this.ctx.videoEl.currentTime;
        if (t < b.start - 0.5 || t > b.end + 0.5) this.exitClip(true);
    };

    private applyParam(): void {
        const r = parseClipParam(new URLSearchParams(location.search).get(this.param));
        if (!r) return;
        const v = this.ctx.videoEl;
        const startClip = (): void => {
            if (this.ctx.isLive()) return;
            const d = this.duration;
            const start = Math.min(r[0], Math.max(0, d - 1));
            const end = Math.min(r[1], d, start + this.max);
            if (end - start < 0.5) return;
            this.start = start;
            this.end = end;
            this.bound = { start, end, loop: this.options.loop !== false };
            this.mark = this.rangeEl(false);
            this.mark.setAttribute('data-static', '');
            this.placeRange(this.mark, start, end);
            this.ctx.seekBarEl.appendChild(this.mark);
            this.showBadge(end - start);
            seekWhenReady(v, start);
            this.emit('play');
        };
        if (v.readyState >= 1 && this.duration) startClip();
        else v.addEventListener('loadedmetadata', startClip, { once: true });
    }

    private showBadge(length: number): void {
        this.badge?.remove();
        const t = this.ctx.i18n;
        const badge = document.createElement('div');
        badge.className = 'hp-clip-badge';
        badge.setAttribute('part', 'clip-badge');
        const label = document.createElement('span');
        label.textContent = t.clipBadge(formatTime(length));
        const all = document.createElement('button');
        all.type = 'button';
        all.textContent = t.clipWatchAll;
        all.addEventListener('click', (e) => {
            e.stopPropagation();
            this.exitClip(true);
        });
        badge.append(label, all);
        this.ctx.overlayEl.appendChild(badge);
        this.badge = badge;
    }

    private exitClip(emit: boolean): void {
        if (!this.badge && !this.mark) return;
        if (emit) this.emit('exit');
        this.bound = null;
        this.badge?.remove();
        this.mark?.remove();
        this.badge = null;
        this.mark = null;
    }
}
