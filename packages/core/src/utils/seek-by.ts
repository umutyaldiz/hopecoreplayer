/**
 * Videonun sonuna sarma hedefi bu kadar geride tutulur. WebKitGTK / WPE (Linux tarayıcıları, WPE'li TV / gömülü cihazlar;
 * GStreamer) `preload="metadata"` ile henüz indirilmemiş sona TAM sarınca konumu 0'a sıfırlıyor — 0.05 sn geride sorun yok.
 * Oynarken video kalan 0.05 sn'yi çalıp doğal olarak biter; gözle fark edilmez.
 */
export const END_SEEK_GUARD_SEC = 0.05;

/** Sonlu süreli videoda sarma hedefi: sondan `END_SEEK_GUARD_SEC` öteye geçmez (canlıda / süre bilinmiyorsa dokunulmaz). */
export function vodSeekTarget(video: HTMLMediaElement, time: number): number {
    const d = video.duration;
    if (!Number.isFinite(d) || d <= END_SEEK_GUARD_SEC * 2) return time;
    return Math.min(time, d - END_SEEK_GUARD_SEC);
}

/** `delta` saniye sar; videonun başını/sonunu aşmaz, canlı yayında (duration Infinity) seekable aralıkta kalır. */
export function seekBy(video: HTMLVideoElement, delta: number): void {
    const start = video.seekable.length ? video.seekable.start(0) : 0;
    const end = Number.isFinite(video.duration)
        ? video.duration
        : video.seekable.length
          ? video.seekable.end(video.seekable.length - 1)
          : video.currentTime;
    video.currentTime = vodSeekTarget(video, Math.max(start, Math.min(end, video.currentTime + delta)));
}
