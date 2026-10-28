import type { LoopSectionOptions } from '../../types';

export interface LoopSeekBarMarkers {
    addMarker(ratio: number, extraClass?: string): HTMLDivElement;
    clearMarkers(): void;
}

export interface LoopSectionState {
    active: boolean;
    loopStart: number | null;
    loopEnd: number | null;
}

/** A/B döngü motoru. */
export class LoopSection {
    private readonly seconds: number;
    loopStart: number | null = null;
    loopEnd: number | null = null;
    active = false;

    constructor(
        private readonly video: HTMLVideoElement,
        private readonly markers: LoopSeekBarMarkers,
        options: LoopSectionOptions = {}
    ) {
        this.seconds = options.seconds || 10;
    }

    /** currentTime'dan geriye doğru tam N saniyelik bir aralığı döngüye alır (video başına yakınsa ileri doğru taşar). */
    enableLastN(secs?: number): void {
        const now = this.video.currentTime;
        const duration = this.video.duration;
        const s = secs || this.seconds;
        this.loopStart = Math.max(0, now - s);
        this.loopEnd = Math.min(Number.isFinite(duration) ? duration : Infinity, this.loopStart + s);
        this.activate();
        this.updateMarkers();
    }

    setStart(time?: number): void {
        this.loopStart = time ?? this.video.currentTime;
        this.updateMarkers();
    }

    setEnd(time?: number): void {
        this.loopEnd = time ?? this.video.currentTime;
        if (this.loopStart !== null && this.loopEnd > this.loopStart) {
            this.activate();
            this.updateMarkers();
        }
    }

    toggle(): void {
        if (this.active) this.disable();
        else this.enableLastN();
    }

    disable(): void {
        this.active = false;
        this.loopStart = null;
        this.loopEnd = null;
        this.video.removeEventListener('timeupdate', this.onTimeUpdate);
        this.markers.clearMarkers();
    }

    getState(): LoopSectionState {
        return { active: this.active, loopStart: this.loopStart, loopEnd: this.loopEnd };
    }

    /** `installLoopSection` bunu gerçek buton etiketini tazeleyen bir implementasyonla override eder (bkz. index.ts) — `destroy`'un üzerine yazılma deseniyle aynı. */
    refreshLabels(): void {
        /* no-op varsayılan */
    }

    destroy(): void {
        this.disable();
    }

    private activate(): void {
        this.active = true;
        this.video.removeEventListener('timeupdate', this.onTimeUpdate);
        this.video.addEventListener('timeupdate', this.onTimeUpdate);
    }

    private readonly onTimeUpdate = (): void => {
        if (this.loopEnd !== null && this.video.currentTime >= this.loopEnd) {
            this.video.currentTime = this.loopStart ?? 0;
        }
    };

    private updateMarkers(): void {
        this.markers.clearMarkers();
        const duration = this.video.duration;
        if (!duration || !Number.isFinite(duration)) return;

        if (this.loopStart !== null) {
            this.markers.addMarker(this.loopStart / duration, 'hp:bg-accent');
        }
        if (this.loopEnd !== null) {
            this.markers.addMarker(this.loopEnd / duration, 'hp:bg-accent');
        }
    }
}
