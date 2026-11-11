import { vodSeekTarget } from '../utils/seek-by';

/** Kare hızı bilinmezse. */
const FALLBACK_FPS = 30;
/** Ölçüm için yeterli kare aralığı. */
const FRAME_SAMPLES = 12;

type FrameVideo = HTMLVideoElement & {
    requestVideoFrameCallback?(cb: (now: number, meta: { mediaTime: number }) => void): number;
    cancelVideoFrameCallback?(id: number): void;
};

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
    /** `options.frameRate`; verilmezse oynarken ölçülür. */
    frameRate: number | null = null;
    /** Oynarken ölçülen kare süresi (sn). */
    private measuredFrame: number | null = null;
    private frameSamples: number[] = [];
    private lastMediaTime = -1;
    private frameCb: number | null = null;

    constructor(host: HTMLElement, video: HTMLVideoElement, toggleFullscreen: () => void) {
        this.host = host;
        this.video = video;
        this.toggleFullscreen = toggleFullscreen;
        this.host.addEventListener('keydown', this.onKeyDown);
        video.addEventListener('playing', this.measure);
        video.addEventListener('loadstart', this.resetFrame);
    }

    /** Bir karenin süresi (sn). */
    get frameDuration(): number {
        if (this.frameRate && this.frameRate > 0) return 1 / this.frameRate;
        return this.measuredFrame ?? 1 / FALLBACK_FPS;
    }

    private readonly resetFrame = (): void => {
        this.measuredFrame = null;
        this.frameSamples = [];
        this.lastMediaTime = -1;
    };

    /** requestVideoFrameCallback ile ardışık karelerin mediaTime farkından kare süresi. */
    private readonly measure = (): void => {
        const v = this.video as FrameVideo;
        if (this.frameRate || this.measuredFrame || !v.requestVideoFrameCallback || this.frameCb !== null) return;
        const step = (_now: number, meta: { mediaTime: number }): void => {
            this.frameCb = null;
            const d = meta.mediaTime - this.lastMediaTime;
            this.lastMediaTime = meta.mediaTime;
            // Atlanan kare / sarma değil, makul aralık (8–120 fps).
            if (d > 1 / 121 && d < 1 / 7) this.frameSamples.push(d);
            if (this.frameSamples.length >= FRAME_SAMPLES) {
                const sorted = [...this.frameSamples].sort((a, b) => a - b);
                this.measuredFrame = sorted[0]!;
                return;
            }
            if (!v.paused && !v.ended) this.frameCb = v.requestVideoFrameCallback!(step);
        };
        this.frameCb = v.requestVideoFrameCallback(step);
    };

    /** Bir kare ileri / geri; oynuyorsa önce durdurur. */
    private stepFrame(direction: 1 | -1): void {
        const v = this.video;
        if (!v.paused) v.pause();
        const end = Number.isFinite(v.duration) ? v.duration : Infinity;
        v.currentTime = Math.min(end, Math.max(0, v.currentTime + direction * this.frameDuration));
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
                    this.video.currentTime = vodSeekTarget(this.video, Math.min(duration, this.video.currentTime + this.seekStep));
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
            case ',':
            case '.':
                if (e.ctrlKey || e.metaKey || e.altKey || this.video.readyState < 1) break;
                this.stepFrame(e.key === '.' ? 1 : -1);
                e.preventDefault();
                break;
        }
    };

    destroy(): void {
        this.host.removeEventListener('keydown', this.onKeyDown);
        this.video.removeEventListener('playing', this.measure);
        this.video.removeEventListener('loadstart', this.resetFrame);
        if (this.frameCb !== null) (this.video as FrameVideo).cancelVideoFrameCallback?.(this.frameCb);
    }
}
