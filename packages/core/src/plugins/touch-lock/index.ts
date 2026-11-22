import type { TouchLockOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { registerLocaleStrings } from '../../i18n';
import { adoptStyle } from '../../utils/plugin-style';
import css from './touch-lock.css?inline';

registerLocaleStrings({
    tr: { touchLock: 'Ekranı kilitle', touchLocked: 'Ekran kilitli — açmak için basılı tutun', touchUnlock: 'Kilidi aç' },
    en: { touchLock: 'Lock screen', touchLocked: 'Screen locked — press and hold to unlock', touchUnlock: 'Unlock' },
});

const LOCK_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>';

export interface TouchLockContext {
    hostEl: HTMLElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    registerToggle(row: { key: string; label: string; getValueLabel(): string; onToggle(): void }): void;
    unregisterToggle(key: string): void;
    closeMenu(): void;
    blockChrome(): void;
    unblockChrome(): void;
}

const KEY = 'touch-lock';
/** Dokunuştan sonra kilit rozetinin görünür kaldığı süre (ms). */
const HINT_MS = 2500;
/** Yok sayılan dokunma / fare olayları (kilit katmanı içinde kalır). */
const SWALLOW = ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchend', 'wheel'];

/** Dokunma kilidi: video oynamaya devam eder, dokunuşlar yok sayılır; rozete basılı tutunca kilit açılır. */
export class TouchLock {
    private layer: HTMLDivElement | null = null;
    private hintTimer: ReturnType<typeof setTimeout> | null = null;
    private holdTimer: ReturnType<typeof setTimeout> | null = null;
    private holdMs = 800;

    constructor(
        private readonly ctx: TouchLockContext,
        options: TouchLockOptions
    ) {
        adoptStyle(ctx.overlayEl, 'touch-lock', css);
        this.setOptions(options);
        this.register();
    }

    setOptions(o: TouchLockOptions): void {
        this.holdMs = typeof o.holdMs === 'number' && o.holdMs >= 0 ? Math.min(5000, o.holdMs) : 800;
    }

    get locked(): boolean {
        return !!this.layer;
    }

    private register(): void {
        this.ctx.registerToggle({
            key: KEY,
            label: this.ctx.i18n.touchLock,
            getValueLabel: () => '',
            onToggle: () => {
                this.ctx.closeMenu();
                this.lock();
            },
        });
    }

    lock(): void {
        if (this.layer) return;
        const t = this.ctx.i18n;
        const layer = document.createElement('div');
        layer.className = 'hp-touch-lock';
        layer.setAttribute('part', 'touch-lock');
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'hp-touch-lock-badge';
        badge.setAttribute('aria-label', t.touchUnlock);
        badge.style.setProperty('--hp-hold', `${this.holdMs}ms`);
        badge.innerHTML = LOCK_ICON;
        const text = document.createElement('span');
        text.textContent = t.touchLocked;
        badge.appendChild(text);
        layer.appendChild(badge);

        for (const type of SWALLOW) layer.addEventListener(type, this.swallow, { passive: false });
        layer.addEventListener('pointerdown', this.hint);
        badge.addEventListener('pointerdown', this.holdStart);
        for (const type of ['pointerup', 'pointercancel', 'pointerleave']) badge.addEventListener(type, this.holdEnd);
        // Klavyeyle (Enter / boşluk) hemen açılır.
        badge.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                this.unlock();
            }
        });
        this.ctx.overlayEl.appendChild(layer);
        this.layer = layer;
        this.ctx.blockChrome();
        this.hint();
        this.emit();
    }

    unlock(): void {
        if (!this.layer) return;
        this.layer.remove();
        this.layer = null;
        if (this.hintTimer) clearTimeout(this.hintTimer);
        if (this.holdTimer) clearTimeout(this.holdTimer);
        this.ctx.unblockChrome();
        this.emit();
    }

    private emit(): void {
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:touchlock', { detail: { locked: this.locked } }));
    }

    private readonly swallow = (e: Event): void => {
        e.stopPropagation();
        if (e.cancelable && e.type !== 'pointerdown' && e.type !== 'touchstart') e.preventDefault();
    };

    /** Dokununca rozet bir süre görünür. */
    private readonly hint = (): void => {
        const l = this.layer;
        if (!l) return;
        l.setAttribute('data-hint', '');
        if (this.hintTimer) clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => {
            if (!l.querySelector('[data-holding]')) l.removeAttribute('data-hint');
        }, HINT_MS);
    };

    private readonly holdStart = (e: PointerEvent): void => {
        const badge = e.currentTarget as HTMLElement;
        badge.setPointerCapture?.(e.pointerId);
        badge.setAttribute('data-holding', '');
        if (this.holdTimer) clearTimeout(this.holdTimer);
        this.holdTimer = setTimeout(() => this.unlock(), this.holdMs);
    };

    private readonly holdEnd = (e: Event): void => {
        (e.currentTarget as HTMLElement).removeAttribute('data-holding');
        if (this.holdTimer) clearTimeout(this.holdTimer);
        this.holdTimer = null;
        this.hint();
    };

    refreshLabels(): void {
        this.register();
    }

    destroy(): void {
        this.unlock();
        this.ctx.unregisterToggle(KEY);
    }
}

export function installTouchLock(ctx: TouchLockContext, options: TouchLockOptions): TouchLock {
    return new TouchLock(ctx, options);
}
