/** Host'a bağlı klavye kısayolları; SeekBar/VolumePanel odaktayken kendi ok tuşlarını işler. */
export class KeyboardController {
    private readonly host: HTMLElement;
    private readonly video: HTMLVideoElement;
    private readonly toggleFullscreen: () => void;
    /** ←/→ ve J/L ile sarma süresi (sn) — options.keyboardSeekStep. */
    seekStep = 5;
    /** Klavyeyle sarıldığında (sn, negatif = geri) — sarma bildirimi için. */
    onSeek: ((delta: number) => void) | null = null;
    /** Space/K'den önce sorulur — true dönerse işlenmiştir (ör. preroll beklemesini iptal). */
    interceptTogglePlay: (() => boolean) | null = null;

    constructor(host: HTMLElement, video: HTMLVideoElement, toggleFullscreen: () => void) {
        this.host = host;
        this.video = video;
        this.toggleFullscreen = toggleFullscreen;
        this.host.addEventListener('keydown', this.onKeyDown);
    }

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        if (e.defaultPrevented) return;
        // Odaktaki bir butonda Space/Enter butonun kendisini çalıştırsın (ör. süre etiketi, ayarlar) — oynat/durdur değil.
        const target = e.composedPath()[0];
        if ((e.key === ' ' || e.key === 'Enter') && target instanceof HTMLButtonElement) return;
        const duration = this.video.duration;

        switch (e.key) {
            case ' ':
            case 'k':
                if (this.interceptTogglePlay?.()) {
                    e.preventDefault();
                    break;
                }
                if (this.video.paused) void this.video.play();
                else this.video.pause();
                e.preventDefault();
                break;
            case 'ArrowRight':
            case 'l':
                if (Number.isFinite(duration)) {
                    this.video.currentTime = Math.min(duration, this.video.currentTime + this.seekStep);
                    this.onSeek?.(this.seekStep);
                }
                e.preventDefault();
                break;
            case 'ArrowLeft':
            case 'j':
                this.video.currentTime = Math.max(0, this.video.currentTime - this.seekStep);
                this.onSeek?.(-this.seekStep);
                e.preventDefault();
                break;
            case 'ArrowUp':
                this.video.volume = Math.min(1, this.video.volume + 0.1);
                this.video.muted = false;
                e.preventDefault();
                break;
            case 'ArrowDown':
                this.video.volume = Math.max(0, this.video.volume - 0.1);
                e.preventDefault();
                break;
            case 'm':
                this.video.muted = !this.video.muted;
                e.preventDefault();
                break;
            case 'f':
                this.toggleFullscreen();
                e.preventDefault();
                break;
        }
    };

    destroy(): void {
        this.host.removeEventListener('keydown', this.onKeyDown);
    }
}
