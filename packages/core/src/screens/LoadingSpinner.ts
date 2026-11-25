/** Kısa takılmalarda (ör. buffer'lı yere sarma) hiç görünmez. */
const SHOW_DELAY_MS = 350;
/** Göründüyse en az bu kadar kalır — açılıp hemen kapanarak yanıp sönmesin. */
const MIN_VISIBLE_MS = 400;
/** CSS solma süresiyle aynı. */
const FADE_MS = 180;

/** video 'waiting' olayında (gecikmeyle, yumuşak) görünür, 'playing'/'canplay'/'pause'da kaybolur. */
export class LoadingSpinner {
    readonly el: HTMLDivElement;
    private readonly video: HTMLVideoElement;
    private showTimer: ReturnType<typeof setTimeout> | null = null;
    private hideTimer: ReturnType<typeof setTimeout> | null = null;
    private shownAt = 0;

    constructor(video: HTMLVideoElement) {
        this.video = video;

        this.el = document.createElement('div');
        this.el.className =
            'hp-loading-spinner hp:absolute hp:inset-0 hp:flex hp:items-center hp:justify-center hp:pointer-events-none hp:hidden hp:transition-opacity hp:duration-[180ms]';
        this.el.style.opacity = '0';
        this.el.innerHTML =
            '<div class="hp:w-10 hp:h-10 hp:border-[3px] hp:border-on-surface/30 hp:border-t-accent hp:rounded-full hp:animate-spin"></div>';

        video.addEventListener('waiting', this.show);
        video.addEventListener('playing', this.hide);
        video.addEventListener('canplay', this.hide);
        video.addEventListener('pause', this.hide);
    }

    /** Görünür mü (solarken de sayılır). */
    get visible(): boolean {
        return this.shownAt > 0;
    }

    private readonly show = (): void => {
        if (this.hideTimer) {
            // Kapanmak üzereyken yeniden beklemeye girdi: açık kalsın.
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
            this.el.style.opacity = '1';
            return;
        }
        if (this.showTimer || this.shownAt) return;
        this.showTimer = setTimeout(() => {
            this.showTimer = null;
            this.shownAt = performance.now();
            this.el.classList.remove('hp:hidden');
            // Bir kare sonra: display değişimiyle aynı karede opacity geçişi başlamaz.
            requestAnimationFrame(() => {
                if (this.shownAt) this.el.style.opacity = '1';
            });
        }, SHOW_DELAY_MS);
    };

    private readonly hide = (): void => {
        if (this.showTimer) {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        }
        if (!this.shownAt || this.hideTimer) return;
        const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - this.shownAt));
        this.hideTimer = setTimeout(() => {
            this.el.style.opacity = '0';
            this.hideTimer = setTimeout(() => {
                this.hideTimer = null;
                this.shownAt = 0;
                // Görünmezken dönme animasyonu da durur.
                this.el.classList.add('hp:hidden');
            }, FADE_MS);
        }, wait);
    };

    destroy(): void {
        if (this.showTimer) clearTimeout(this.showTimer);
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.video.removeEventListener('waiting', this.show);
        this.video.removeEventListener('playing', this.hide);
        this.video.removeEventListener('canplay', this.hide);
        this.video.removeEventListener('pause', this.hide);
    }
}
