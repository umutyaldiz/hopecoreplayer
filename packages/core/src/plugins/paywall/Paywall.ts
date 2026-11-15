import type { PaywallAction, PaywallOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { formatTime } from '../../utils/format-time';
import { adoptStyle } from '../../utils/plugin-style';
import { isSafeUrl } from '../../utils/safe-url';
import css from './paywall.css?inline';

export interface PaywallPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    isLive(): boolean;
    isAdActive(): boolean;
    blockChrome(): void;
    unblockChrome(): void;
}

const LOCK_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3Zm3 4a2 2 0 0 1 1 3.7V19h-2v-1.3A2 2 0 0 1 12 14Z"/></svg>';

/** Doğal ilerleme sayılan en büyük adım (sn) — daha büyüğü sarmadır. */
const MAX_STEP = 1.5;

/**
 * Ödeme duvarı: ilk `previewSeconds` ücretsiz oynar; sonrası (VOD'da o saniyeden ileri, canlıda o kadar izledikten
 * sonra) video durur ve "Abone ol / Giriş yap" ekranı çıkar. İleri sarma önizleme sınırında kesilir.
 */
export class Paywall {
    private locked = false;
    private unlocked: boolean;
    private watched = 0;
    private lastTime = 0;
    private wall: HTMLElement | null = null;
    private badge: HTMLElement | null = null;

    constructor(
        private readonly ctx: PaywallPlayerContext,
        private options: PaywallOptions
    ) {
        adoptStyle(ctx.overlayEl, 'paywall', css);
        this.unlocked = !!options.unlocked;
        const v = ctx.videoEl;
        v.addEventListener('timeupdate', this.check);
        v.addEventListener('seeking', this.onSeeking);
        v.addEventListener('play', this.onPlay);
        v.addEventListener('loadedmetadata', this.check);
        if (options.badge !== false && !this.unlocked) {
            const b = document.createElement('div');
            b.className = 'hp-paywall-badge';
            b.setAttribute('part', 'paywall-badge');
            b.hidden = true;
            ctx.overlayEl.appendChild(b);
            this.badge = b;
        }
        this.check();
    }

    get limit(): number {
        return Math.max(0, this.options.previewSeconds || 0);
    }

    /** Aynı ayarların yeni callback'leri (fonksiyonlar karşılaştırma anahtarına girmez). */
    setOptions(options: PaywallOptions): void {
        this.options = options;
        if (options.unlocked) this.unlock();
    }

    /** Kilidi açar (abone oldu / giriş yaptı); duvar açıksa kalkar ve oynatma kaldığı yerden sürer. */
    unlock(): void {
        if (this.unlocked) return;
        const wasLocked = this.locked;
        this.unlocked = true;
        this.locked = false;
        this.hideWall();
        this.badge?.remove();
        this.badge = null;
        this.emit('unlock');
        if (wasLocked) void this.ctx.videoEl.play().catch(() => {});
    }

    refreshLabels(): void {
        if (this.wall) {
            this.hideWall();
            this.showWall();
        }
        this.renderBadge();
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        v.removeEventListener('timeupdate', this.check);
        v.removeEventListener('seeking', this.onSeeking);
        v.removeEventListener('play', this.onPlay);
        v.removeEventListener('loadedmetadata', this.check);
        this.hideWall();
        this.badge?.remove();
        this.badge = null;
    }

    private emit(state: 'shown' | 'click' | 'unlock', action?: 'subscribe' | 'login'): boolean {
        return this.ctx.hostEl.dispatchEvent(
            new CustomEvent('hp:paywall', { detail: { state, action, time: this.ctx.videoEl.currentTime }, cancelable: state === 'click' })
        );
    }

    /** Canlıda izlenen süre, VOD'da videonun saniyesi önizleme sınırına göre ölçülür. */
    private used(): number {
        return this.ctx.isLive() ? this.watched : this.ctx.videoEl.currentTime;
    }

    private readonly check = (): void => {
        if (this.unlocked) return;
        const v = this.ctx.videoEl;
        if (this.ctx.isLive()) {
            const step = v.currentTime - this.lastTime;
            if (!v.paused && step > 0 && step <= MAX_STEP && !this.ctx.isAdActive()) this.watched += step;
        }
        this.lastTime = v.currentTime;
        this.renderBadge();
        if (!this.locked && this.used() >= this.limit - 0.05 && (this.ctx.isLive() || Number.isFinite(v.duration))) this.lock();
    };

    /** VOD'da sınırı geçen sarma sınıra çekilir ve duvar açılır. */
    private readonly onSeeking = (): void => {
        if (this.unlocked || this.ctx.isLive()) return;
        const v = this.ctx.videoEl;
        if (v.currentTime > this.limit) {
            v.currentTime = this.limit;
            this.lock();
        }
    };

    private readonly onPlay = (): void => {
        if (this.locked && !this.unlocked) this.ctx.videoEl.pause();
    };

    private lock(): void {
        if (this.locked) return;
        this.locked = true;
        const v = this.ctx.videoEl;
        v.pause();
        if (!this.ctx.isLive() && v.currentTime > this.limit) v.currentTime = this.limit;
        const check = this.options.checkAccess;
        if (!check) return this.showLocked();
        // Sitenin üyelik sistemine sor; yanıt gelene kadar video durur.
        void Promise.resolve()
            .then(() => check())
            .catch(() => false)
            .then((ok) => {
                if (this.unlocked || !this.locked) return;
                if (ok === true) this.unlock();
                else this.showLocked();
            });
    }

    private showLocked(): void {
        this.showWall();
        this.emit('shown');
    }

    private renderBadge(): void {
        const b = this.badge;
        if (!b) return;
        const left = Math.max(0, this.limit - this.used());
        b.hidden = this.locked || this.unlocked || this.ctx.isAdActive() || this.used() <= 0;
        b.textContent = this.ctx.i18n.paywallPreview(formatTime(left));
    }

    private button(action: PaywallAction | undefined, kind: 'subscribe' | 'login', fallback: string): HTMLElement {
        const url = action?.onClick ? undefined : action?.url;
        const el = document.createElement(isSafeUrl(url) ? 'a' : 'button');
        el.className = `hp-paywall-btn${kind === 'subscribe' ? ' primary' : ''}`;
        el.setAttribute('part', `paywall-${kind}`);
        el.textContent = action?.label || fallback;
        if (el instanceof HTMLAnchorElement) el.href = url!;
        else (el as HTMLButtonElement).type = 'button';
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!this.emit('click', kind)) return e.preventDefault();
            const handler = action?.onClick;
            if (!handler) return;
            // Sitenin kendi akışı: adres açılmaz; true dönerse (abone oldu / giriş yaptı) kilit açılır.
            e.preventDefault();
            void Promise.resolve()
                .then(() => handler())
                .then((ok) => {
                    if (ok === true) this.unlock();
                })
                .catch(() => {});
        });
        return el;
    }

    private showWall(): void {
        if (this.wall) return;
        const o = this.options;
        const t = this.ctx.i18n;
        const wall = document.createElement('div');
        wall.className = 'hp-paywall';
        wall.setAttribute('part', 'paywall');
        wall.setAttribute('role', 'dialog');
        wall.setAttribute('aria-modal', 'true');
        if (o.image && isSafeUrl(o.image)) {
            const img = document.createElement('img');
            img.className = 'hp-paywall-bg';
            img.src = o.image;
            img.alt = '';
            wall.appendChild(img);
        }
        const card = document.createElement('div');
        card.className = 'hp-paywall-card';
        const icon = document.createElement('div');
        icon.className = 'hp-paywall-icon';
        icon.innerHTML = LOCK_SVG;
        const h = document.createElement('h3');
        h.className = 'hp-paywall-title';
        h.textContent = o.title || t.paywallTitle;
        const p = document.createElement('p');
        p.className = 'hp-paywall-text';
        p.textContent = o.text || t.paywallText;
        const actions = document.createElement('div');
        actions.className = 'hp-paywall-actions';
        actions.appendChild(this.button(o.subscribe, 'subscribe', t.paywallSubscribe));
        if (o.login !== false) actions.appendChild(this.button(o.login, 'login', t.paywallLogin));
        card.append(icon, h, p, actions);
        wall.appendChild(card);
        wall.setAttribute('aria-label', h.textContent);
        // Altındaki videoya / kontrollere tıklama geçmesin.
        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) wall.addEventListener(ev, (e) => e.stopPropagation());
        this.ctx.overlayEl.appendChild(wall);
        this.wall = wall;
        this.ctx.blockChrome();
        (actions.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
    }

    private hideWall(): void {
        if (!this.wall) return;
        this.wall.remove();
        this.wall = null;
        this.ctx.unblockChrome();
    }
}
