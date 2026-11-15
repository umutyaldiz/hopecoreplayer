import type { SignLanguageOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { adoptStyle } from '../../utils/plugin-style';
import { isSafeUrl } from '../../utils/safe-url';
import css from './sign-language.css?inline';
import { storageGet, storageSet } from '../../utils/storage';

/** Kontrol çubuğu ikonu — yalnızca bu parçada (ana ikon fontuna girmez). */
const HAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 7.2a1.25 1.25 0 0 1 2.5 0V12H5.5Z M8.8 4.2a1.25 1.25 0 0 1 2.5 0V11.5H8.8Z M12.1 4.7a1.25 1.25 0 0 1 2.5 0V11.5H12.1Z M15.4 6.7a1.25 1.25 0 0 1 2.5 0V13H15.4Z M5.5 11.3H17.9V15A7 7 0 0 1 10.9 22H10.5A5 5 0 0 1 5.5 17Z M17.9 13.4L19.6 10.9a1.3 1.3 0 0 1 2.2 1.4L17.9 17.6Z"/></svg>';

export interface SignLanguagePlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    addButton(label: string, iconName: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
    registerToggle(row: { key: string; label: string; getValueLabel(): string; onToggle(): void }): void;
    unregisterToggle(key: string): void;
    isAdActive(): boolean;
}

type Corner = NonNullable<SignLanguageOptions['position']>;
const STORE = 'hp-sign-language';
const TOGGLE_KEY = 'sign-language';
/** Bu kadar saniyeden büyük fark sarılarak, küçüğü hızla yavaşça kapatılır. */
const HARD_DRIFT = 0.35;
const SOFT_DRIFT = 0.08;

/**
 * İşaret dili videosu: ana videonun köşesinde, sessiz ve eş zamanlı oynayan ikinci video. Oynat / durdur / sarma / hız
 * aynen uygulanır, kayma saniyede bir düzeltilir. İzleyici sürükleyip başka köşeye bırakabilir; tercih hatırlanır.
 */
export class SignLanguage {
    private wrap: HTMLElement;
    private sign: HTMLVideoElement;
    private on = false;
    private corner: Corner;
    private button: HTMLButtonElement | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private loaded = false;

    constructor(
        private readonly ctx: SignLanguagePlayerContext,
        private readonly options: SignLanguageOptions
    ) {
        adoptStyle(ctx.overlayEl, 'sign-language', css);
        this.corner = options.position ?? 'bottom-right';
        this.wrap = document.createElement('div');
        this.wrap.className = 'hp-sign';
        this.wrap.setAttribute('part', 'sign-language');
        this.wrap.hidden = true;
        const size = Math.min(0.5, Math.max(0.15, options.size ?? 0.28));
        this.wrap.style.setProperty('--hp-sign-w', `${size * 100}%`);
        this.sign = document.createElement('video');
        this.sign.muted = true;
        this.sign.playsInline = true;
        this.sign.preload = 'none';
        this.sign.setAttribute('aria-hidden', 'true');
        this.sign.disablePictureInPicture = true;
        this.wrap.appendChild(this.sign);
        this.wrap.addEventListener('pointerdown', this.onDrag);
        for (const ev of ['click', 'dblclick'] as const) this.wrap.addEventListener(ev, (e) => e.stopPropagation());
        ctx.overlayEl.appendChild(this.wrap);
        this.placeCorner();

        if (options.button !== false) {
            const { btn } = ctx.addButton(this.label, HAND_ICON, () => this.toggle());
            this.button = btn;
        }
        this.registerToggle();

        const v = ctx.videoEl;
        v.addEventListener('play', this.onMainPlay);
        v.addEventListener('pause', this.onMainPause);
        v.addEventListener('seeked', this.resync);
        v.addEventListener('ratechange', this.resync);
        v.addEventListener('emptied', this.onMainPause);
        if (this.restore()) this.toggle(true, false);
    }

    private get label(): string {
        return this.options.label || this.ctx.i18n.signLanguage;
    }

    get enabled(): boolean {
        return this.on;
    }

    refreshLabels(): void {
        this.button?.setAttribute('aria-label', this.label);
        this.registerToggle();
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        v.removeEventListener('play', this.onMainPlay);
        v.removeEventListener('pause', this.onMainPause);
        v.removeEventListener('seeked', this.resync);
        v.removeEventListener('ratechange', this.resync);
        v.removeEventListener('emptied', this.onMainPause);
        if (this.timer) clearInterval(this.timer);
        this.sign.pause();
        this.sign.removeAttribute('src');
        this.sign.load();
        this.wrap.remove();
        this.button?.remove();
        this.ctx.unregisterToggle(TOGGLE_KEY);
    }

    private restore(): boolean {
        try {
            const v = storageGet(STORE);
            if (v === '0' || v === '1') return v === '1';
        } catch {
            /* depolama kapalı */
        }
        return !!this.options.default;
    }

    private registerToggle(): void {
        const t = this.ctx.i18n;
        this.ctx.registerToggle({
            key: TOGGLE_KEY,
            label: this.label,
            getValueLabel: () => (this.on ? t.signLanguageOn : t.signLanguageOff),
            onToggle: () => this.toggle(),
        });
    }

    /** Aç / kapat; `remember` false ise tercih yazılmaz (başlangıçta geri yükleme). */
    toggle(force?: boolean, remember = true): void {
        const on = force ?? !this.on;
        if (on === this.on) return;
        if (on && !isSafeUrl(this.options.src)) return;
        this.on = on;
        if (on && !this.loaded) {
            this.sign.preload = 'auto';
            this.sign.src = this.options.src;
            this.loaded = true;
        }
        this.render();
        this.button?.setAttribute('aria-pressed', String(on));
        if (on) {
            this.timer ??= setInterval(this.tick, 1000);
            this.resync();
            if (!this.ctx.videoEl.paused) this.onMainPlay();
        } else {
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
            this.sign.pause();
        }
        if (remember) {
            try {
                storageSet(STORE, on ? '1' : '0');
            } catch {
                /* depolama kapalı */
            }
        }
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:signlanguage', { detail: { state: on ? 'on' : 'off', position: this.corner } }));
    }

    private render(): void {
        this.wrap.hidden = !this.on || this.ctx.isAdActive();
    }

    private target(): number {
        return Math.max(0, this.ctx.videoEl.currentTime + (this.options.offset ?? 0));
    }

    private readonly onMainPlay = (): void => {
        if (!this.on) return;
        this.resync();
        void this.sign.play().catch(() => {});
    };

    private readonly onMainPause = (): void => {
        this.sign.pause();
    };

    private readonly resync = (): void => {
        if (!this.on) return;
        const v = this.ctx.videoEl;
        this.sign.playbackRate = v.playbackRate;
        if (Math.abs(this.sign.currentTime - this.target()) > HARD_DRIFT) this.sign.currentTime = this.target();
    };

    /** Saniyede bir: reklamda gizle, büyük kaymayı sar, küçüğü hızla kapat. */
    private readonly tick = (): void => {
        this.render();
        const v = this.ctx.videoEl;
        if (v.paused || this.sign.seeking) return;
        if (this.sign.paused && !this.ctx.isAdActive()) void this.sign.play().catch(() => {});
        const diff = this.target() - this.sign.currentTime;
        if (Math.abs(diff) > HARD_DRIFT) {
            this.sign.currentTime = this.target();
            this.sign.playbackRate = v.playbackRate;
        } else if (Math.abs(diff) > SOFT_DRIFT) {
            this.sign.playbackRate = v.playbackRate * (diff > 0 ? 1.06 : 0.94);
        } else {
            this.sign.playbackRate = v.playbackRate;
        }
    };

    private placeCorner(): void {
        this.wrap.setAttribute('data-corner', this.corner);
        this.wrap.style.removeProperty('left');
        this.wrap.style.removeProperty('top');
    }

    /** Sürükle-bırak: bırakılan yere en yakın köşeye oturur. */
    private readonly onDrag = (e: PointerEvent): void => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const area = this.ctx.overlayEl.getBoundingClientRect();
        const box = this.wrap.getBoundingClientRect();
        const dx = e.clientX - box.left;
        const dy = e.clientY - box.top;
        let moved = false;
        this.wrap.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent): void => {
            if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
            moved = true;
            this.wrap.setAttribute('data-dragging', '');
            const x = Math.min(area.width - box.width, Math.max(0, ev.clientX - area.left - dx));
            const y = Math.min(area.height - box.height, Math.max(0, ev.clientY - area.top - dy));
            this.wrap.style.left = `${x}px`;
            this.wrap.style.top = `${y}px`;
        };
        const up = (ev: PointerEvent): void => {
            this.wrap.removeEventListener('pointermove', move);
            this.wrap.removeEventListener('pointerup', up);
            this.wrap.removeEventListener('pointercancel', up);
            this.wrap.removeAttribute('data-dragging');
            if (!moved) return;
            const cx = ev.clientX - area.left;
            const cy = ev.clientY - area.top;
            this.corner = `${cy < area.height / 2 ? 'top' : 'bottom'}-${cx < area.width / 2 ? 'left' : 'right'}` as Corner;
            this.placeCorner();
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:signlanguage', { detail: { state: 'move', position: this.corner } }));
        };
        this.wrap.addEventListener('pointermove', move);
        this.wrap.addEventListener('pointerup', up);
        this.wrap.addEventListener('pointercancel', up);
    };
}
