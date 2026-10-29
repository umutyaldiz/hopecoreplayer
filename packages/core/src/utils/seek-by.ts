/** `delta` saniye sar; videonun başını/sonunu aşmaz, canlı yayında (duration Infinity) seekable aralıkta kalır. */
export function seekBy(video: HTMLVideoElement, delta: number): void {
    const start = video.seekable.length ? video.seekable.start(0) : 0;
    const end = Number.isFinite(video.duration)
        ? video.duration
        : video.seekable.length
          ? video.seekable.end(video.seekable.length - 1)
          : video.currentTime;
    video.currentTime = Math.max(start, Math.min(end, video.currentTime + delta));
}
