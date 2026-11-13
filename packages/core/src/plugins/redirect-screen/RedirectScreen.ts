import type { RedirectScreenOptions, RedirectScreenSuggestion } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { createIcon } from '../../icons/Icon';
import { adoptStyle } from '../../utils/plugin-style';
import css from './redirect-screen.css?inline';
import { isSafeUrl } from '../../utils/safe-url';

export interface RedirectScreenPlayerContext {
    /** hp:redirect olayları ve postroll'un bitişini (hp:adend) dinlemek için. */
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayContainerEl: HTMLElement;
    isAdActive(): boolean;
    i18n: HopeLocaleStrings;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;
const DEFAULT_SHOW_BEFORE = 10;

/** Dairesel geri sayım halkası (SVG) — `set(oran)` ile 1 → 0 boşalır. */
function ring(className: string): { el: SVGSVGElement; set(fraction: number): void } {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);
    const track = document.createElementNS(SVG_NS, 'circle');
    const bar = document.createElementNS(SVG_NS, 'circle');
    for (const c of [track, bar]) {
        c.setAttribute('cx', '20');
        c.setAttribute('cy', '20');
        c.setAttribute('r', String(RING_R));
    }
    track.setAttribute('class', 'hp-redirect-ring-track');
    bar.setAttribute('class', 'hp-redirect-ring-bar');
    bar.setAttribute('stroke-dasharray', String(RING_C));
    svg.append(track, bar);
    return {
        el: svg,
        set: (fraction) => bar.setAttribute('stroke-dashoffset', String(RING_C * (1 - Math.min(1, Math.max(0, fraction))))),
    };
}

/** Görsel + süre rozeti + oynat ikonu + halka — kart ve tam ekran aynı parçayı kullanır. */
function thumb(image: string | undefined, duration: string | undefined, className: string): { el: HTMLSpanElement; ring: ReturnType<typeof ring> } {
    const el = document.createElement('span');
    el.className = className;
    if (image) {
        const img = document.createElement('img');
        img.src = image;
        img.alt = '';
        img.decoding = 'async';
        img.addEventListener('error', () => img.remove());
        el.appendChild(img);
    }
    const r = ring('hp-redirect-ring');
    const play = document.createElement('span');
    play.className = 'hp-redirect-play';
    play.appendChild(createIcon('play'));
    el.append(r.el, play);
    if (duration) {
        const d = document.createElement('span');
        d.className = 'hp-redirect-duration';
        d.textContent = duration;
        el.appendChild(d);
    }
    return { el, ring: r };
}

/**
 * Sıradaki videoya yönlendirme. Üç mod:
 * - 'screen' (varsayılan): video bitince tam alan ekran + `time` sn geri sayım; iptal → öneriler.
 * - 'card': bitime `showBefore` sn kala köşede küçük "Sıradaki" kartı; geri sayım videoyla birlikte işler (duraklatınca
 *   durur), video bitince yönlendirilir. Karta tıklamak hemen yönlendirir, X iptal eder.
 * - 'endScreen': yönlendirme yok; video bitince doğrudan öneri ızgarası (bitiş ekranı).
 * Bitişte postroll oynuyorsa yönlendirme reklam bitene kadar bekler. `hp:redirect` (state: redirect) iptal edilirse
 * (`preventDefault`) sayfa değişmez.
 */
export class RedirectScreen {
    private counterTimer: ReturnType<typeof setInterval> | null = null;
    private wrapper: HTMLElement | null = null;
    private card: HTMLDivElement | null = null;
    private cardRing: ReturnType<typeof ring> | null = null;
    private cardLabel: HTMLSpanElement | null = null;
    private cancelled = false;
    private waitingForAd = false;
    private readonly mode: 'screen' | 'card' | 'endScreen';

    constructor(
        private readonly ctx: RedirectScreenPlayerContext,
        private readonly options: RedirectScreenOptions
    ) {
        this.mode = options.mode === 'card' || options.mode === 'endScreen' ? options.mode : 'screen';
        adoptStyle(ctx.overlayContainerEl, 'redirect-screen', css);
        if (options.enabled === false) return;
        ctx.videoEl.addEventListener('ended', this.onEnded);
        ctx.videoEl.addEventListener('play', this.onPlay);
        if (this.mode === 'card') ctx.videoEl.addEventListener('timeupdate', this.onTimeUpdate);
    }

    /** Ekranlar her gösterimde güncel `ctx.i18n` ile kurulur; açık kartın etiketi burada tazelenir. */
    refreshLabels(): void {
        this.card?.querySelector('.hp-redirect-close')?.setAttribute('aria-label', this.ctx.i18n.redirectCancelCard);
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        v.removeEventListener('ended', this.onEnded);
        v.removeEventListener('play', this.onPlay);
        v.removeEventListener('timeupdate', this.onTimeUpdate);
        this.ctx.hostEl.removeEventListener('hp:adend', this.onAdEnd);
        this.remove();
        this.hideCard();
    }

    private emit(
        state: 'shown' | 'cancel' | 'redirect' | 'replay',
        reason?: 'auto' | 'click' | 'suggestion',
        url = this.options.url ?? '',
        index?: number
    ): boolean {
        return this.ctx.hostEl.dispatchEvent(
            new CustomEvent('hp:redirect', { detail: { state, url, mode: this.mode, reason, index }, cancelable: state === 'redirect' })
        );
    }

    private go(reason: 'auto' | 'click'): void {
        this.remove();
        this.hideCard();
        const url = this.options.url;
        if (!this.emit('redirect', reason) || !isSafeUrl(url)) return; // entegratör kendisi yönlendirecek
        if (this.options.newTab) window.open(url, '_blank', 'noopener');
        else window.location.href = url;
    }

    private readonly onPlay = (): void => {
        this.remove();
    };

    private readonly onEnded = (): void => {
        // Postroll oynuyorsa (ya da birazdan başlayacaksa) reklam bitince devam.
        if (this.ctx.isAdActive()) {
            this.waitForAd();
            return;
        }
        this.finish();
    };

    private waitForAd(): void {
        if (this.waitingForAd) return;
        this.waitingForAd = true;
        this.ctx.hostEl.addEventListener('hp:adend', this.onAdEnd);
    }

    private readonly onAdEnd = (): void => {
        this.ctx.hostEl.removeEventListener('hp:adend', this.onAdEnd);
        this.waitingForAd = false;
        if (this.ctx.videoEl.ended) this.finish();
    };

    private finish(): void {
        if (this.mode === 'endScreen') {
            if (this.options.suggestions?.length) {
                this.showSuggestions(this.options.suggestions);
                this.emit('shown');
            }
            return;
        }
        if (this.mode === 'card') {
            this.hideCard();
            if (!this.cancelled) this.go('auto');
            else if (this.options.suggestions?.length) this.showSuggestions(this.options.suggestions);
            return;
        }
        this.createScreen();
    }

    // ── 'card' modu ─────────────────────────────────────────────────────────

    private readonly onTimeUpdate = (): void => {
        const v = this.ctx.videoEl;
        const showBefore = Math.max(1, this.options.showBefore ?? DEFAULT_SHOW_BEFORE);
        const d = v.duration;
        if (!Number.isFinite(d) || d <= 0) return; // canlı yayında kart yok
        const remaining = d - v.currentTime;
        if (remaining > showBefore) {
            // Geri sarıldı (eşiğin belirgin üstüne): iptal unutulur — tekrar yaklaşınca kart yine gelir.
            if (remaining > showBefore + 1) this.cancelled = false;
            this.hideCard();
            return;
        }
        if (this.cancelled || this.ctx.isAdActive() || v.ended || remaining <= 0) {
            if (this.ctx.isAdActive()) this.hideCard();
            return;
        }
        if (!this.card) this.showCard();
        const secs = Math.ceil(remaining);
        this.cardRing?.set(remaining / showBefore);
        if (this.cardLabel) this.cardLabel.textContent = `${this.options.label ?? this.ctx.i18n.redirectUpNext} · ${secs}`;
    };

    private showCard(): void {
        const o = this.options;
        const card = document.createElement('div');
        card.className = 'hp-redirect-card';
        card.setAttribute('part', 'redirect-card');
        card.setAttribute('data-position', o.position ?? 'bottom-right');

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'hp-redirect-card-main';
        main.addEventListener('click', () => this.go('click'));
        const t = thumb(o.image, o.duration, 'hp-redirect-thumb');
        const text = document.createElement('span');
        text.className = 'hp-redirect-text';
        const label = document.createElement('span');
        label.className = 'hp-redirect-label';
        text.appendChild(label);
        if (o.title) {
            const title = document.createElement('span');
            title.className = 'hp-redirect-title';
            title.textContent = o.title;
            text.appendChild(title);
        }
        if (o.subtitle) {
            const sub = document.createElement('span');
            sub.className = 'hp-redirect-sub';
            sub.textContent = o.subtitle;
            text.appendChild(sub);
        }
        // Erişilebilir ad görünen metinden oluşur ("Sıradaki · 4 Başlık Alt başlık"); sonuna yalnızca ekran okuyucunun
        // duyduğu "Şimdi oynat" eklenir — görsel / süre rozeti okunmaz.
        t.el.setAttribute('aria-hidden', 'true');
        const action = document.createElement('span');
        action.className = 'hp-sr-only';
        action.textContent = ` — ${this.ctx.i18n.redirectPlayNow}`;
        text.appendChild(action);
        main.append(t.el, text);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'hp-redirect-close';
        close.setAttribute('aria-label', this.ctx.i18n.redirectCancelCard);
        close.appendChild(createIcon('close'));
        close.addEventListener('click', () => {
            this.cancelled = true;
            this.hideCard();
            this.emit('cancel');
        });

        card.append(main, close);
        // Karta dokunmak videoyu oynat / duraklat yapmasın.
        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) card.addEventListener(ev, (e) => e.stopPropagation());
        this.ctx.overlayContainerEl.appendChild(card);
        this.card = card;
        this.cardRing = t.ring;
        this.cardLabel = label;
        this.emit('shown');
    }

    private hideCard(): void {
        this.card?.remove();
        this.card = null;
        this.cardRing = null;
        this.cardLabel = null;
    }

    // ── 'screen' modu ───────────────────────────────────────────────────────

    private remove(): void {
        if (this.counterTimer) {
            clearInterval(this.counterTimer);
            this.counterTimer = null;
        }
        this.wrapper?.remove();
        this.wrapper = null;
    }

    private createScreen(): void {
        this.remove();
        const o = this.options;
        const wrapper = document.createElement('div');
        wrapper.setAttribute('part', 'redirect-screen');
        wrapper.className = 'hp-redirect-screen';

        if (o.image) {
            const bg = document.createElement('img');
            bg.className = 'hp-redirect-bg';
            bg.src = o.image;
            bg.alt = '';
            bg.addEventListener('error', () => bg.remove());
            wrapper.appendChild(bg);
        }

        const panel = document.createElement('div');
        panel.className = 'hp-redirect-panel';
        const label = document.createElement('span');
        label.className = 'hp-redirect-label';
        label.textContent = o.label ?? this.ctx.i18n.redirectUpNext;
        panel.appendChild(label);

        const poster = document.createElement('button');
        poster.type = 'button';
        poster.className = 'hp-redirect-poster';
        poster.setAttribute('aria-label', this.ctx.i18n.redirectPlayNow);
        const t = thumb(o.image, o.duration, 'hp-redirect-thumb');
        poster.appendChild(t.el);
        poster.addEventListener('click', () => this.go('click'));
        panel.appendChild(poster);

        if (o.title) {
            const title = document.createElement('div');
            title.className = 'hp-redirect-title';
            title.textContent = o.title;
            panel.appendChild(title);
        }
        if (o.subtitle) {
            const sub = document.createElement('div');
            sub.className = 'hp-redirect-sub';
            sub.textContent = o.subtitle;
            panel.appendChild(sub);
        }

        const counter = document.createElement('div');
        counter.className = 'hp-redirect-counter';
        counter.setAttribute('aria-live', 'polite');
        panel.appendChild(counter);

        const actions = document.createElement('div');
        actions.className = 'hp-redirect-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'hp-redirect-btn';
        cancelBtn.textContent = this.ctx.i18n.redirectCancel;
        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'hp-redirect-btn hp-redirect-btn-primary';
        acceptBtn.textContent = this.ctx.i18n.redirectPlayNow;
        acceptBtn.addEventListener('click', () => this.go('click'));
        cancelBtn.addEventListener('click', () => {
            this.remove();
            this.emit('cancel');
            if (o.suggestions?.length) this.showSuggestions(o.suggestions);
        });
        actions.append(cancelBtn, acceptBtn);
        panel.appendChild(actions);
        wrapper.appendChild(panel);

        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) wrapper.addEventListener(ev, (e) => e.stopPropagation());
        this.ctx.overlayContainerEl.appendChild(wrapper);
        this.wrapper = wrapper;
        this.emit('shown');

        const total = Math.max(0, o.time ?? 10);
        let remaining = total;
        const render = (): void => {
            counter.textContent = this.ctx.i18n.redirectCountdown(remaining);
            t.ring.set(total > 0 ? remaining / total : 0);
        };
        render();
        this.counterTimer = setInterval(() => {
            remaining--;
            if (remaining > 0) {
                render();
                return;
            }
            if (this.counterTimer) clearInterval(this.counterTimer);
            this.counterTimer = null;
            counter.textContent = this.ctx.i18n.redirectNowPlaying;
            t.ring.set(0);
            this.go('auto');
        }, 1000);
    }

    /** Öneri ızgarası (bitiş ekranı): başlık + kapat, kartlar, "Tekrar izle". */
    private showSuggestions(items: RedirectScreenSuggestion[]): void {
        this.remove();
        const o = this.options;
        const i18n = this.ctx.i18n;
        const wrapper = document.createElement('div');
        wrapper.setAttribute('part', 'redirect-suggestions');
        wrapper.className = 'hp-redirect-suggestions';
        wrapper.setAttribute('role', 'region');
        const heading = o.suggestionsTitle ?? i18n.redirectSuggestions;
        wrapper.setAttribute('aria-label', heading);

        const head = document.createElement('div');
        head.className = 'hp-redirect-grid-head';
        const h = document.createElement('span');
        h.className = 'hp-redirect-grid-title';
        h.textContent = heading;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'hp-redirect-close';
        close.setAttribute('aria-label', i18n.redirectCloseSuggestions);
        close.appendChild(createIcon('close'));
        close.addEventListener('click', () => this.remove());
        head.append(h, close);

        const grid = document.createElement('div');
        grid.className = 'hp-redirect-grid';
        grid.setAttribute('data-count', String(Math.min(items.length, 6)));
        items.forEach((item, index) => {
            const box = document.createElement('a');
            if (isSafeUrl(item.url)) box.href = item.url;
            if (o.newTab) {
                box.target = '_blank';
                box.rel = 'noopener';
            }
            box.className = 'hp-redirect-suggestion';
            const t = thumb(item.image, item.duration, 'hp-redirect-thumb');
            t.el.querySelector('.hp-redirect-ring')?.remove();
            const title = document.createElement('span');
            title.className = 'hp-redirect-title';
            title.textContent = item.title;
            box.append(t.el, title);
            if (item.subtitle) {
                const sub = document.createElement('span');
                sub.className = 'hp-redirect-sub';
                sub.textContent = item.subtitle;
                box.appendChild(sub);
            }
            // SPA: preventDefault ile sayfa değişmez.
            box.addEventListener('click', (e) => {
                if (!this.emit('redirect', 'suggestion', item.url, index)) e.preventDefault();
            });
            grid.appendChild(box);
        });
        wrapper.append(head, grid);

        if (o.replay !== false) {
            const replay = document.createElement('button');
            replay.type = 'button';
            replay.className = 'hp-redirect-btn hp-redirect-replay';
            replay.append(createIcon('loop'), document.createTextNode(i18n.redirectReplay));
            replay.addEventListener('click', () => {
                this.remove();
                this.emit('replay');
                const v = this.ctx.videoEl;
                v.currentTime = 0;
                void v.play().catch(() => {});
            });
            wrapper.appendChild(replay);
        }

        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) wrapper.addEventListener(ev, (e) => e.stopPropagation());
        this.ctx.overlayContainerEl.appendChild(wrapper);
        this.wrapper = wrapper;
    }
}
