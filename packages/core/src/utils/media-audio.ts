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

const stable = new WeakMap<MediaAudioGraph, AudioNode>();

/**
 * Sabit ses: `out` → kompresör → telafi kazancı → hoparlör. Kapalıyken `out` doğrudan hoparlöre gider.
 * Yüksek sahneler bastırılır, kısık konuşmalar telafi kazancıyla öne çıkar.
 */
export function setStableVolume(g: MediaAudioGraph, on: boolean): void {
    let input = stable.get(g);
    if (!input && on) {
        const comp = g.ctx.createDynamicsCompressor();
        comp.threshold.value = -30;
        comp.knee.value = 24;
        comp.ratio.value = 6;
        comp.attack.value = 0.005;
        comp.release.value = 0.3;
        const makeup = g.ctx.createGain();
        makeup.gain.value = 1.6;
        comp.connect(makeup).connect(g.ctx.destination);
        stable.set(g, (input = comp));
    }
    g.out.disconnect();
    g.out.connect(on && input ? input : g.ctx.destination);
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
