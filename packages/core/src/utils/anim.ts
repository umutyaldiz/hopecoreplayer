/** Kısa bir CSS animasyonunu yeniden başlatır: `data-anim` a ↔ b (iki ayrı keyframe adı — reflow gerekmez). */
export function replayAnim(el: Element, attr = 'data-anim'): void {
    el.setAttribute(attr, el.getAttribute(attr) === 'a' ? 'b' : 'a');
}

/** Dokunmatikte çok kısa titreşim (Android; iOS web'e izin vermez) — kullanıcı hareketi içinde çağrılmalı. */
export function haptic(ms = 10): void {
    try {
        navigator.vibrate?.(ms);
    } catch {
        // İzin yok / desteklenmiyor.
    }
}
