import type { GestureOptions } from '../../types';

export interface GesturePlayerContext {
    videoEl: HTMLVideoElement;
    /** Basılı tutma göstergesinin (hız/sarma overlay'i) ekleneceği katman. */
    overlayContainerEl: HTMLElement;
    isAdActive(): boolean;
}

function isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Basılı tutma: mobilde adım adım ileri sarma, masaüstünde playbackRate hızlandırma. */
export class GestureControls {
    private readonly options: Required<GestureOptions>;
    private readonly overlayEl: HTMLElement;

    private isHolding = false;
    private holdTimeout: ReturnType<typeof setTimeout> | null = null;
    private holdInterval: ReturnType<typeof setInterval> | null = null;
    private wasPaused = false;

    constructor(
        private readonly ctx: GesturePlayerContext,
        options: GestureOptions = {}
    ) {
        this.options = {
            holdRate: options.holdRate ?? 2,
            holdIntervalMs: options.holdIntervalMs ?? 200,
            holdDelayMs: options.holdDelayMs ?? 300,
        };

        this.overlayEl = document.createElement('div');
        this.overlayEl.setAttribute('part', 'gesture-overlay');
        this.overlayEl.className =
            'hp:hidden hp:absolute hp:inset-0 hp:z-20 hp:items-center hp:justify-center hp:gap-2 ' +
            'hp:bg-black/30 hp:text-white hp:text-xl hp:font-semibold hp:pointer-events-none';
        ctx.overlayContainerEl.appendChild(this.overlayEl);

        ctx.videoEl.addEventListener('touchstart', this.onPressStart, { passive: false });
        ctx.videoEl.addEventListener('touchend', this.onPressEnd);
        ctx.videoEl.addEventListener('touchcancel', this.onPressLeave);
        ctx.videoEl.addEventListener('mousedown', this.onPressStart);
        ctx.videoEl.addEventListener('mouseup', this.onPressEnd);
        ctx.videoEl.addEventListener('mouseleave', this.onPressLeave);
    }

    /** HopePlayerElement'in kendi "ekrana tıkla → oynat/duraklat" tetikleyicisinin bir hold sırasında devre dışı kalması için — tek doğruluk kaynağı burası, ayrı bir zamanlayıcı tekrarlanmıyor. */
    isCurrentlyHolding(): boolean {
        return this.isHolding;
    }

    destroy(): void {
        this.ctx.videoEl.removeEventListener('touchstart', this.onPressStart);
        this.ctx.videoEl.removeEventListener('touchend', this.onPressEnd);
        this.ctx.videoEl.removeEventListener('touchcancel', this.onPressLeave);
        this.ctx.videoEl.removeEventListener('mousedown', this.onPressStart);
        this.ctx.videoEl.removeEventListener('mouseup', this.onPressEnd);
        this.ctx.videoEl.removeEventListener('mouseleave', this.onPressLeave);
        if (this.holdTimeout) clearTimeout(this.holdTimeout);
        if (this.holdInterval) clearInterval(this.holdInterval);
        this.overlayEl.remove();
    }

    private readonly onPressStart = (e: Event): void => {
        if (this.ctx.isAdActive()) return;
        if (this.ctx.videoEl.ended) return;
        this.wasPaused = this.ctx.videoEl.paused;

        this.holdTimeout = setTimeout(() => this.startHold(), this.options.holdDelayMs);
        e.preventDefault();
    };

    private startHold(): void {
        if (this.isHolding) return;
        this.isHolding = true;

        if (isMobileDevice()) {
            const step = (this.options.holdRate * this.options.holdIntervalMs) / 1000;
            this.holdInterval = setInterval(() => {
                const video = this.ctx.videoEl;
                video.currentTime = Math.min(video.duration || video.currentTime + step, video.currentTime + step);
            }, this.options.holdIntervalMs);
        } else {
            this.ctx.videoEl.playbackRate = this.options.holdRate;
        }

        this.showOverlay(`${this.options.holdRate}x »`);
        if (this.ctx.videoEl.paused) void this.ctx.videoEl.play().catch(() => {});
    }

    private readonly onPressEnd = (): void => {
        this.endHold();
    };

    private readonly onPressLeave = (): void => {
        this.endHold();
    };

    private endHold(): void {
        if (this.holdTimeout) {
            clearTimeout(this.holdTimeout);
            this.holdTimeout = null;
        }

        // Kısa dokunuş: oynat/duraklat HopePlayerElement'in kendi dinleyicisinde.
        if (!this.isHolding) return;

        this.isHolding = false;
        this.ctx.videoEl.playbackRate = 1;
        if (this.holdInterval) {
            clearInterval(this.holdInterval);
            this.holdInterval = null;
        }
        this.hideOverlay();

        if (this.wasPaused) this.ctx.videoEl.pause();
    }

    private showOverlay(text: string): void {
        this.overlayEl.textContent = text;
        this.overlayEl.classList.remove('hp:hidden');
        this.overlayEl.classList.add('hp:flex');
    }

    private hideOverlay(): void {
        this.overlayEl.classList.add('hp:hidden');
        this.overlayEl.classList.remove('hp:flex');
    }
}
