/** video 'waiting' olayında görünür, 'playing'/'canplay'de gizlenir. */
export class LoadingSpinner {
    readonly el: HTMLDivElement;
    private readonly video: HTMLVideoElement;

    constructor(video: HTMLVideoElement) {
        this.video = video;

        this.el = document.createElement('div');
        this.el.className = 'hp:absolute hp:inset-0 hp:flex hp:items-center hp:justify-center hp:pointer-events-none hp:hidden';
        this.el.innerHTML =
            '<div class="hp:w-10 hp:h-10 hp:border-[3px] hp:border-on-surface/30 hp:border-t-accent hp:rounded-full hp:animate-spin"></div>';

        video.addEventListener('waiting', this.show);
        video.addEventListener('playing', this.hide);
        video.addEventListener('canplay', this.hide);
        video.addEventListener('pause', this.hide);
    }

    private readonly show = (): void => this.el.classList.remove('hp:hidden');
    private readonly hide = (): void => this.el.classList.add('hp:hidden');

    destroy(): void {
        this.video.removeEventListener('waiting', this.show);
        this.video.removeEventListener('playing', this.hide);
        this.video.removeEventListener('canplay', this.hide);
        this.video.removeEventListener('pause', this.hide);
    }
}
