/** İlerleme çubuğu sürükleniyor mu: o sıradaki duraklatma / devam izleyicinin değil (player `data-scrubbing`). */
export function isScrubbing(video: HTMLMediaElement): boolean {
    const root = video.getRootNode();
    const host = root instanceof ShadowRoot ? root.host : null;
    return !!host?.hasAttribute('data-scrubbing');
}
