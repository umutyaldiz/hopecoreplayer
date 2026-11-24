import type { SegmentItem } from '../types';

/** Sarma sayılmayan küçük konum değişimi (kaynak / kalite değişiminde konumun geri yüklenmesi). */
const SEEK_MIN_SEC = 0.5;
/** hp:timeupdate en sık bu aralıkla (ms) gelir. */
const TIME_INTERVAL_MS = 250;

export interface MediaEventsDeps {
    /** Reklam oynarken içerik olayları gönderilmez. */
    isAdActive(): boolean;
    /** Bölümler (`options.segments`). */
    segments(): SegmentItem[] | undefined;
}

/** İçerik <video>'sunun olaylarını sayfaya `hp:*` olarak iletir (timeupdate, ses, sarma, takılma, meta veri, bölüm). */
export class MediaEvents {
    private lastTime = 0;
    private lastTimeAt = 0;
    private seekFrom: number | null = null;
    private buffering = false;
    private chapter = -1;

    constructor(
        private readonly host: HTMLElement,
        private readonly video: HTMLVideoElement,
        private readonly deps: MediaEventsDeps
    ) {}

    private emit(event: CustomEvent): void {
        this.host.dispatchEvent(event);
    }

    /** Oynatma konumunu kapsayan buffer aralığının sonu. */
    private bufferedEnd(): number {
        const { buffered, currentTime } = this.video;
        for (let i = 0; i < buffered.length; i++) {
            if (buffered.start(i) <= currentTime + 0.1 && buffered.end(i) >= currentTime) return buffered.end(i);
        }
        return currentTime;
    }

    private readonly onTime = (): void => {
        const v = this.video;
        if (this.seekFrom === null) this.lastTime = v.currentTime;
        if (this.buffering && !v.paused && v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) this.setBuffering(false);
        this.updateChapter();
        if (this.deps.isAdActive()) return;
        const now = performance.now();
        if (now - this.lastTimeAt < TIME_INTERVAL_MS) return;
        this.lastTimeAt = now;
        this.emit(new CustomEvent('hp:timeupdate', { detail: { currentTime: v.currentTime, duration: v.duration, buffered: this.bufferedEnd() } }));
    };

    private readonly onVolume = (): void => {
        this.emit(new CustomEvent('hp:volumechange', { detail: { volume: this.video.volume, muted: this.video.muted } }));
    };

    private readonly onSeeking = (): void => {
        const to = this.video.currentTime;
        // Kaynak değişiminde konumun geri yüklenmesi (aynı yere) sarma sayılmaz.
        if (Math.abs(to - this.lastTime) < SEEK_MIN_SEC) return;
        this.seekFrom ??= this.lastTime;
        this.emit(new CustomEvent('hp:seeking', { detail: { from: this.seekFrom, to } }));
    };

    private readonly onSeeked = (): void => {
        if (this.seekFrom === null) return;
        const from = this.seekFrom;
        this.seekFrom = null;
        this.lastTime = this.video.currentTime;
        this.emit(new CustomEvent('hp:seeked', { detail: { from, to: this.video.currentTime } }));
        this.updateChapter();
    };

    private setBuffering(on: boolean): void {
        if (on === this.buffering) return;
        this.buffering = on;
        this.emit(new CustomEvent('hp:buffering', { detail: { buffering: on } }));
    }

    private readonly onWaiting = (): void => {
        if (!this.deps.isAdActive()) this.setBuffering(true);
    };

    private readonly onPlaying = (): void => this.setBuffering(false);

    private readonly onMeta = (): void => {
        const v = this.video;
        this.lastTime = v.currentTime;
        this.seekFrom = null;
        this.chapter = -1;
        this.emit(new CustomEvent('hp:loadedmetadata', { detail: { duration: v.duration, width: v.videoWidth, height: v.videoHeight, live: v.duration === Infinity } }));
        this.updateChapter();
    };

    private readonly onEmptied = (): void => {
        this.setBuffering(false);
        this.seekFrom = null;
    };

    private updateChapter(): void {
        const list = this.deps.segments();
        if (!list?.length) return;
        const t = this.video.currentTime;
        const index = list.findIndex((s) => t >= s.start && t < s.end);
        if (index === this.chapter) return;
        this.chapter = index;
        const s = list[index];
        this.emit(new CustomEvent('hp:chapterchange', { detail: s ? { index, title: s.text, start: s.start, end: s.end } : { index: -1 } }));
    }

    attach(): void {
        const v = this.video;
        v.addEventListener('timeupdate', this.onTime);
        v.addEventListener('volumechange', this.onVolume);
        v.addEventListener('seeking', this.onSeeking);
        v.addEventListener('seeked', this.onSeeked);
        v.addEventListener('waiting', this.onWaiting);
        v.addEventListener('playing', this.onPlaying);
        v.addEventListener('pause', this.onPlaying);
        v.addEventListener('loadedmetadata', this.onMeta);
        v.addEventListener('emptied', this.onEmptied);
    }

    detach(): void {
        const v = this.video;
        v.removeEventListener('timeupdate', this.onTime);
        v.removeEventListener('volumechange', this.onVolume);
        v.removeEventListener('seeking', this.onSeeking);
        v.removeEventListener('seeked', this.onSeeked);
        v.removeEventListener('waiting', this.onWaiting);
        v.removeEventListener('playing', this.onPlaying);
        v.removeEventListener('pause', this.onPlaying);
        v.removeEventListener('loadedmetadata', this.onMeta);
        v.removeEventListener('emptied', this.onEmptied);
    }
}
