import type { CountdownScreenOptions } from '../../types';
import type { GatePlayerContext } from '../shared/GatePlayerContext';

/** Hedef tarihe kadar içeriği engelleyen geri sayım ekranı (blockChrome ile). */
export class CountdownScreen {
    private readonly wrapper: HTMLElement;
    private readonly timerLabel: HTMLElement;
    private readonly timerEl: HTMLElement;
    private interval: ReturnType<typeof setInterval> | null = null;
    private bgInterval: ReturnType<typeof setInterval> | null = null;
    private imageIndex = 0;
    private readonly targetTime: number;
    private resolved = false;
    private readonly completeCallbacks: Array<() => void> = [];

    constructor(
        private readonly ctx: GatePlayerContext,
        private readonly options: CountdownScreenOptions
    ) {
        this.targetTime = new Date(options.time).getTime();

        this.wrapper = document.createElement('div');
        this.wrapper.setAttribute('part', 'countdown-screen');
        this.wrapper.className =
            'hp:absolute hp:inset-0 hp:z-40 hp:flex hp:items-end hp:bg-cover hp:bg-center hp:bg-surface hp:text-on-surface';

        const info = document.createElement('div');
        info.className = 'hp:p-4 hp:w-full hp:bg-gradient-to-t hp:from-black/80 hp:to-transparent';

        if (options.title) {
            const title = document.createElement('h3');
            title.className = 'hp:text-lg hp:font-semibold hp:m-0';
            title.textContent = options.title;
            info.appendChild(title);
        }
        if (options.spot) {
            const spot = document.createElement('p');
            spot.className = 'hp:text-sm hp:opacity-80 hp:m-0 hp:mt-1';
            spot.textContent = options.spot;
            info.appendChild(spot);
        }
        if (options.description) {
            const desc = document.createElement('p');
            desc.className = 'hp:text-xs hp:opacity-70 hp:m-0 hp:mt-1';
            desc.textContent = options.description;
            info.appendChild(desc);
        }

        this.timerLabel = document.createElement('span');
        this.timerLabel.className = 'hp:text-xs hp:opacity-70 hp:block hp:mt-2';
        this.timerLabel.textContent = ctx.i18n.countdownRemaining;
        info.appendChild(this.timerLabel);

        this.timerEl = document.createElement('div');
        this.timerEl.className = 'hp:text-2xl hp:font-mono hp:tabular-nums';
        info.appendChild(this.timerEl);

        this.wrapper.appendChild(info);
        this.updateBackground();
        ctx.overlayContainerEl.appendChild(this.wrapper);

        ctx.blockChrome();
        ctx.videoEl.addEventListener('play', this.onPlayWhileBlocked);

        if (Array.isArray(options.coverImage) && options.coverImage.length > 0) {
            this.bgInterval = setInterval(() => {
                this.imageIndex = (this.imageIndex + 1) % (options.coverImage as string[]).length;
                this.updateBackground();
            }, options.imageChangeInterval ?? 5000);
        }

        this.start();
    }

    refreshLabels(): void {
        this.timerLabel.textContent = this.ctx.i18n.countdownRemaining;
    }

    isComplete(): boolean {
        return this.resolved;
    }

    /** Geri sayım bitince çağrılır (zaten bittiyse anında). */
    onComplete(cb: () => void): void {
        if (this.resolved) cb();
        else this.completeCallbacks.push(cb);
    }

    destroy(): void {
        if (this.interval) clearInterval(this.interval);
        if (this.bgInterval) clearInterval(this.bgInterval);
        this.ctx.videoEl.removeEventListener('play', this.onPlayWhileBlocked);
        if (!this.resolved) this.ctx.unblockChrome();
        this.wrapper.remove();
        this.completeCallbacks.length = 0;
    }

    private readonly onPlayWhileBlocked = (): void => {
        if (!this.resolved) this.ctx.videoEl.pause();
    };

    private updateBackground(): void {
        const img = Array.isArray(this.options.coverImage) ? this.options.coverImage[this.imageIndex] : this.options.coverImage;
        this.wrapper.style.backgroundImage = img ? `url("${img}")` : 'none';
    }

    private start(): void {
        const tick = () => {
            const diff = Math.max(this.targetTime - Date.now(), 0);
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff / 60000) % 60);
            const s = Math.floor((diff / 1000) % 60);
            this.timerEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

            if (diff <= 0) this.complete();
        };

        tick();
        if (this.targetTime - Date.now() > 0) {
            this.interval = setInterval(tick, 1000);
        } else {
            this.complete();
        }
    }

    private complete(): void {
        if (this.resolved) return;
        this.resolved = true;
        if (this.interval) clearInterval(this.interval);
        if (this.bgInterval) clearInterval(this.bgInterval);
        this.ctx.videoEl.removeEventListener('play', this.onPlayWhileBlocked);
        this.wrapper.remove();
        this.ctx.unblockChrome();
        const callbacks = this.completeCallbacks.splice(0);
        for (const cb of callbacks) cb();
    }
}
