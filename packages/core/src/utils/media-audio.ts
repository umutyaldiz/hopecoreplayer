/**
 * Video elementinin tek Web Audio grafiği: kaynak → `out` (gain) → hoparlör. createMediaElementSource bir elemente bir
 * kez bağlanabildiği için erişilebilirlik (ses yükseltme / mono) ve sessizlik algılama aynı grafiği paylaşır.
 */
export interface MediaAudioGraph {
    ctx: AudioContext;
    source: MediaElementAudioSourceNode;
    out: GainNode;
}

const graphs = new WeakMap<HTMLMediaElement, MediaAudioGraph>();

/** Başka alan adından CORS'suz gelen kaynakta tarayıcı sesi sıfırlar — o zaman grafik kurulmaz. */
export function canTapAudio(el: HTMLMediaElement): boolean {
    if (typeof AudioContext === 'undefined') return false;
    const src = el.currentSrc;
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return true;
    try {
        if (new URL(src, location.href).origin === location.origin) return true;
    } catch {
        return false;
    }
    return el.crossOrigin !== null;
}

/** Grafiği döndürür (yoksa kurar); kurulamıyorsa null. */
export function mediaAudio(el: HTMLMediaElement): MediaAudioGraph | null {
    const existing = graphs.get(el);
    if (existing) return existing;
    if (!canTapAudio(el)) return null;
    try {
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(el);
        const out = ctx.createGain();
        source.connect(out).connect(ctx.destination);
        const graph = { ctx, source, out };
        graphs.set(el, graph);
        // Kullanıcı etkileşimi olmadan başlayan bağlam askıda kalır — oynatınca devam ettir.
        el.addEventListener('play', () => void ctx.resume().catch(() => {}));
        if (!el.paused) void ctx.resume().catch(() => {});
        return graph;
    } catch {
        return null;
    }
}
