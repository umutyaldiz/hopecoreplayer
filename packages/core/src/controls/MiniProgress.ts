/**
 * Kontroller gizliyken video alanının en altında, kenardan kenara ince
 * ilerleme çizgisi (`options.miniProgress`). Görünürlüğü HopePlayerElement
 * belirler (chrome gizli + reklam/giriş ekranı yok + canlı değil); çizim
 * yalnızca görünürken ve oynarken rAF ile yapılır.
 */
export class MiniProgress {
    readonly el: HTMLDivElement;
    private readonly bufferedEl: HTMLDivElement;
    private readonly playedEl: HTMLDivElement;
    private visible = false;
    private rafId: number | null = null;

    constructor(private readonly video: HTMLVideoElement) {
        this.el = document.createElement('div');
        this.el.className = 'hp-mini-progress';
        this.el.setAttribute('part', 'mini-progress');
        this.el.setAttribute('aria-hidden', 'true');
        this.bufferedEl = document.createElement('div');
        this.bufferedEl.className = 'hp-mini-progress-fill hp-mini-progress-buffered';
        this.playedEl = document.createElement('div');
        this.playedEl.className = 'hp-mini-progress-fill hp-mini-progress-played';
        this.el.append(this.bufferedEl, this.playedEl);

        video.addEventListener('play', this.sync);
        video.addEventListener('pause', this.sync);
        video.addEventListener('timeupdate', this.render);
        video.addEventListener('progress', this.render);
        video.addEventListener('durationchange', this.render);
    }

    setVisible(visible: boolean): void {
        if (visible === this.visible) return;
        this.visible = visible;
        this.el.toggleAttribute('data-visible', visible);
        this.sync();
    }

    destroy(): void {
        this.stop();
        this.video.removeEventListener('play', this.sync);
        this.video.removeEventListener('pause', this.sync);
        this.video.removeEventListener('timeupdate', this.render);
        this.video.removeEventListener('progress', this.render);
        this.video.removeEventListener('durationchange', this.render);
        this.el.remove();
    }

    private readonly sync = (): void => {
        this.render();
        if (this.visible && !this.video.paused) this.start();
        else this.stop();
    };

    private start(): void {
        if (this.rafId !== null) return;
        const tick = (): void => {
            this.render();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    private stop(): void {
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }

    private readonly render = (): void => {
        const duration = this.video.duration;
        // Canlı yayın (Infinity) ya da süre henüz bilinmiyor — boş bir çizgi gösterme.
        const hasDuration = Number.isFinite(duration) && duration > 0;
        this.el.toggleAttribute('data-disabled', !hasDuration);
        if (!this.visible || !hasDuration) return;
        this.playedEl.style.transform = `scaleX(${Math.min(1, this.video.currentTime / duration)})`;
        const { buffered } = this.video;
        let end = 0;
        for (let i = 0; i < buffered.length; i++) {
            if (buffered.start(i) <= this.video.currentTime) end = Math.max(end, buffered.end(i));
        }
        this.bufferedEl.style.transform = `scaleX(${Math.min(1, end / duration)})`;
    };
}
