/**
 * Ses çıkışı açılamadı (Firefox: ses aygıtı yok ya da o an kullanılamıyor — ör. ses kartı olmayan makine, kopan
 * Bluetooth kulaklık). Firefox bunu `MEDIA_ERR_DECODE` (3, mesaj `OnMediaSinkAudioError`) olarak bildiriyor ama video
 * sessiz oynamaya devam ediyor — ölümcül değil: hata ekranı açılmaz, yedek kaynağa / sonraki öğeye geçilmez, aynı kaynak
 * yeniden yüklenmez.
 */
export function isAudioOutputError(err: MediaError | null | undefined): boolean {
    return !!err && /MediaSinkAudio/i.test(err.message || '');
}

/** `video.error` gerçek (ölümcül) bir hata mı — ses çıkışı hatası sayılmaz. */
export function hasFatalMediaError(video: HTMLMediaElement): boolean {
    return !!video.error && !isAudioOutputError(video.error);
}
