import type { InViewAutoplayOptions } from '../../types';

export interface InViewAutoplayPlayerContext {
    videoEl: HTMLVideoElement;
    /** IntersectionObserver'ın izlediği kök element — genelde player'ın host custom element'i. */
    observeEl: Element;
    isAdActive(): boolean;
}

/** Viewport dışına çıkınca duraklat; yalnızca bu plugin duraklattıysa geri girince devam et. */
export class InViewAutoplay {
    private readonly threshold: number;
    private readonly onlyIfMuted: boolean;
    private readonly observer: IntersectionObserver;
    private pausedByThis = false;

    constructor(
        private readonly ctx: InViewAutoplayPlayerContext,
        options: InViewAutoplayOptions = {}
    ) {
        this.threshold = options.threshold ?? 0.3;
        this.onlyIfMuted = options.onlyIfMuted ?? true;

        this.observer = new IntersectionObserver(this.onIntersect, { threshold: [this.threshold] });
        this.observer.observe(ctx.observeEl);
    }

    destroy(): void {
        this.observer.disconnect();
    }

    private readonly onIntersect = (entries: IntersectionObserverEntry[]): void => {
        if (this.ctx.isAdActive()) return;

        for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio >= this.threshold) {
                this.resumeIfPausedByThis();
            } else {
                this.pauseIfPlaying();
            }
        }
    };

    private pauseIfPlaying(): void {
        const video = this.ctx.videoEl;
        if (video.paused || video.ended) return;
        this.pausedByThis = true;
        video.pause();
    }

    private resumeIfPausedByThis(): void {
        if (!this.pausedByThis) return;
        this.pausedByThis = false;
        const video = this.ctx.videoEl;
        if (this.onlyIfMuted && !video.muted) return;
        void video.play().catch(() => {});
    }
}
