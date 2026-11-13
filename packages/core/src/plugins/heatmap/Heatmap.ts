import type { HeatmapOptions } from '../../types';
import { adoptStyle } from '../../utils/plugin-style';
import css from './heatmap.css?inline';

export interface HeatmapPlayerContext {
    videoEl: HTMLVideoElement;
    seekBar: { readonly el: HTMLElement; addMarker(ratio: number, extraClass?: string, label?: string): HTMLElement };
    i18n: { heatmapPeak: string };
    log?: (entry: { message: string; details?: Record<string, string> }) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 100;

/** Değerleri 0–1'e indirger (en yüksek = 1); geçersizler 0. */
function normalize(values: number[]): number[] {
    const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
    const max = Math.max(0, ...clean);
    return max > 0 ? clean.map((v) => v / max) : clean;
}

/** Noktalardan yumuşak (Catmull-Rom → Bezier) kapalı alan yolu; tabanı seek bar çizgisi. */
export function heatmapPath(values: number[]): string {
    const n = values.length;
    if (!n) return '';
    const pts: [number, number][] = values.map((v, i) => [((i + 0.5) / n) * W, H - v * H * 0.92]);
    pts.unshift([0, pts[0]![1]]);
    pts.push([W, pts[pts.length - 1]![1]]);
    let d = `M0 ${H}L${pts[0]![0]} ${pts[0]![1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] ?? pts[i]!;
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;
        const p3 = pts[i + 2] ?? p2;
        // Kontrol noktaları tabanın altına / tepenin üstüne taşmasın.
        const c1y = Math.min(H, Math.max(0, p1[1] + (p2[1] - p0[1]) / 6));
        const c2y = Math.min(H, Math.max(0, p2[1] - (p3[1] - p1[1]) / 6));
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return `${d}L${W} ${H}Z`;
}

function layer(className: string): { el: HTMLDivElement; path: SVGPathElement } {
    const el = document.createElement('div');
    el.className = className;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    svg.appendChild(path);
    el.appendChild(svg);
    return { el, path };
}

/**
 * "En çok izlenen" ısı haritası: seek bar'ın hemen üstünde yoğunluk eğrisi. Değerler videoya eşit aralıklarla
 * yayılır; izlenen kısım vurgu rengiyle dolar. Canlı yayında (süre bilinmiyorsa) gizlenir.
 */
export class Heatmap {
    private readonly el: HTMLDivElement;
    private readonly base: SVGPathElement;
    private readonly played: SVGPathElement;
    private destroyed = false;
    /** Tepe noktası: görünmez işaret — üzerine gelince "En çok izlenen an · 1:23". */
    private peak: HTMLElement | null = null;

    constructor(
        private readonly ctx: HeatmapPlayerContext,
        private readonly options: HeatmapOptions
    ) {
        adoptStyle(ctx.seekBar.el, 'heatmap', css);
        const el = document.createElement('div');
        el.className = 'hp-heatmap';
        el.setAttribute('part', 'heatmap');
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('data-show', options.show === 'always' ? 'always' : 'hover');
        if (options.height) el.style.setProperty('--hp-heatmap-h', `${Math.max(8, options.height)}px`);
        const base = layer('hp-heatmap-base');
        const played = layer('hp-heatmap-played');
        el.append(base.el, played.el);
        this.el = el;
        this.base = base.path;
        this.played = played.path;
        el.hidden = true;
        ctx.seekBar.el.prepend(el);

        ctx.videoEl.addEventListener('timeupdate', this.onTime);
        ctx.videoEl.addEventListener('seeking', this.onTime);
        // Oynarken her karede güncellenir — seek bar'daki ilerleme gibi akıcı.
        ctx.videoEl.addEventListener('play', this.startLoop);
        ctx.videoEl.addEventListener('pause', this.stopLoop);
        ctx.videoEl.addEventListener('ended', this.stopLoop);
        if (!ctx.videoEl.paused) this.startLoop();
        ctx.videoEl.addEventListener('durationchange', this.onDuration);
        ctx.videoEl.addEventListener('loadedmetadata', this.onDuration);

        if (options.data?.length) this.setData(options.data);
        else if (options.src) void this.fetchData(options.src);
    }

    /** Yeni değerler (ör. sunucudan güncel istatistik). */
    setData(values: number[]): void {
        const norm = normalize(values);
        this.setPeak(norm);
        const d = heatmapPath(norm);
        this.base.setAttribute('d', d);
        this.played.setAttribute('d', d);
        this.el.toggleAttribute('data-empty', !d);
        this.onDuration();
    }

    destroy(): void {
        this.destroyed = true;
        const v = this.ctx.videoEl;
        v.removeEventListener('timeupdate', this.onTime);
        v.removeEventListener('seeking', this.onTime);
        v.removeEventListener('durationchange', this.onDuration);
        v.removeEventListener('loadedmetadata', this.onDuration);
        this.peak?.remove();
        v.removeEventListener('play', this.startLoop);
        v.removeEventListener('pause', this.stopLoop);
        v.removeEventListener('ended', this.stopLoop);
        this.stopLoop();
        this.el.remove();
    }

    private rafId: number | null = null;

    private readonly startLoop = (): void => {
        if (this.rafId !== null) return;
        const tick = (): void => {
            this.onTime();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    };

    private readonly stopLoop = (): void => {
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.onTime();
    };

    /** En yüksek dilim (birden fazlaysa ilki) — üzerine gelince etiket. */
    private setPeak(norm: number[]): void {
        this.peak?.remove();
        this.peak = null;
        const label = this.options.peakLabel;
        if (label === false || !norm.length) return;
        const i = norm.indexOf(1);
        if (i < 0) return;
        const el = this.ctx.seekBar.addMarker((i + 0.5) / norm.length, 'hp-heatmap-peak', typeof label === 'string' ? label : this.ctx.i18n.heatmapPeak);
        el.dataset.hitRatio = String(0.5 / norm.length);
        this.peak = el;
    }

    private async fetchData(src: string): Promise<void> {
        try {
            const res = await fetch(src);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json: unknown = await res.json();
            const values = Array.isArray(json) ? json : (json as { data?: unknown })?.data;
            if (!Array.isArray(values)) throw new Error('number[] bekleniyordu');
            if (!this.destroyed) this.setData(values.map(Number));
        } catch (err) {
            this.ctx.log?.({ message: `Heatmap data could not be loaded: ${String(err)}`, details: { src } });
        }
    }

    private readonly onDuration = (): void => {
        const d = this.ctx.videoEl.duration;
        this.el.hidden = !Number.isFinite(d) || d <= 0 || this.el.hasAttribute('data-empty') || !this.base.getAttribute('d');
        // Canlıda / veri yokken tepe etiketi de yok (işaret DOM'dan çıkar, geri gelince eklenir).
        if (this.peak) {
            if (this.el.hidden) this.peak.remove();
            else if (!this.peak.isConnected) this.ctx.seekBar.el.appendChild(this.peak);
        }
        this.onTime();
    };

    private readonly onTime = (): void => {
        const v = this.ctx.videoEl;
        const ratio = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(1, Math.max(0, v.currentTime / v.duration)) : 0;
        // Gizliyken (canlı yayın / veri yok) stil yazma.
        if (this.el.hidden) return;
        this.el.style.setProperty('--hp-heatmap-p', `${(ratio * 100).toFixed(3)}%`);
    };
}
