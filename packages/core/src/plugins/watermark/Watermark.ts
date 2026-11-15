import type { WatermarkOptions } from '../../types';
import { adoptStyle } from '../../utils/plugin-style';
import css from './watermark.css?inline';

export interface WatermarkPlayerContext {
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    isAdActive(): boolean;
}

const FIXED: Record<NonNullable<WatermarkOptions['position']>, [number, number]> = {
    'top-left': [4, 6],
    'top-right': [96, 6],
    'bottom-left': [4, 80],
    'bottom-right': [96, 80],
    center: [50, 45],
};

/**
 * Kişiye özel filigran: video üstünde yarı saydam metin (ör. kullanıcı e-postası), `moveEvery` saniyede bir rastgele
 * yere geçer. Kaldırılır ya da gizlenirse geri konur — ekran kaydını caydırır (koruma değil, DRM'in tamamlayıcısı).
 */
export class Watermark {
    private el: HTMLElement;
    private timer: ReturnType<typeof setInterval> | null = null;
    private observer: MutationObserver | null = null;
    private pos: [number, number] = [50, 45];
    private destroyed = false;

    constructor(
        private readonly ctx: WatermarkPlayerContext,
        private readonly options: WatermarkOptions
    ) {
        adoptStyle(ctx.overlayEl, 'watermark', css);
        this.el = document.createElement('div');
        this.el.setAttribute('aria-hidden', 'true');
        this.render();
        this.place(true);
        ctx.overlayEl.appendChild(this.el);
        const every = options.moveEvery ?? 15;
        if (every > 0) this.timer = setInterval(() => this.place(false), every * 1000);
        ctx.videoEl.addEventListener('play', this.sync);
        ctx.videoEl.addEventListener('playing', this.sync);
        ctx.videoEl.addEventListener('pause', this.sync);
        this.watch();
    }

    /** Reklam başlayınca / bitince görünürlüğü yeniler. */
    refresh(): void {
        this.sync();
    }

    destroy(): void {
        this.destroyed = true;
        this.observer?.disconnect();
        if (this.timer) clearInterval(this.timer);
        this.ctx.videoEl.removeEventListener('play', this.sync);
        this.ctx.videoEl.removeEventListener('playing', this.sync);
        this.ctx.videoEl.removeEventListener('pause', this.sync);
        this.el.remove();
    }

    /** Metin, stil ve konum her seferinde baştan yazılır — elle değiştirilirse geri döner. */
    private render(): void {
        const o = this.options;
        this.el.className = 'hp-watermark';
        this.el.removeAttribute('hidden');
        this.el.textContent = o.text;
        const opacity = Math.min(1, Math.max(0.05, o.opacity ?? 0.3));
        this.el.setAttribute(
            'style',
            `left:${this.pos[0]}%;top:${this.pos[1]}%;opacity:${this.ctx.isAdActive() ? 0 : opacity};` +
                `font-size:${Math.max(8, o.fontSize ?? 14)}px;${o.color && CSS.supports('color', o.color) ? `color:${o.color};` : ''}` +
                `transform:translate(${this.pos[0] > 60 ? '-100%' : this.pos[0] > 40 ? '-50%' : '0'},0)`
        );
    }

    private place(first: boolean): void {
        const fixed = (this.options.moveEvery ?? 15) <= 0;
        if (fixed) this.pos = FIXED[this.options.position ?? 'bottom-right'];
        else if (!first || !this.options.position) this.pos = [4 + Math.random() * 92, 6 + Math.random() * 74];
        else this.pos = FIXED[this.options.position];
        this.mute(() => this.render());
    }

    private readonly sync = (): void => this.mute(() => this.render());

    private muted = false;
    private mute(fn: () => void): void {
        this.muted = true;
        fn();
        this.observer?.takeRecords();
        this.muted = false;
    }

    /** Silinir, gizlenir ya da stili değiştirilirse yerine konur. */
    private watch(): void {
        if (typeof MutationObserver === 'undefined') return;
        this.observer = new MutationObserver(() => {
            if (this.muted || this.destroyed) return;
            this.mute(() => {
                if (!this.el.isConnected || this.el.parentNode !== this.ctx.overlayEl) this.ctx.overlayEl.appendChild(this.el);
                this.render();
            });
        });
        this.observer.observe(this.ctx.overlayEl, { childList: true });
        this.observer.observe(this.el, { attributes: true, childList: true, characterData: true, subtree: true });
    }
}
