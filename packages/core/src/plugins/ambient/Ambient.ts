import type { AmbientOptions } from '../../types';

export interface AmbientContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement & { webkitDisplayingFullscreen?: boolean };
    videoArea: HTMLElement;
    isAdActive(): boolean;
}

type BatteryLike = EventTarget & { charging: boolean; level: number };

/** Örnek kare genişliği (px) — renk için yeterli, kopyalaması ucuz. */
const SAMPLE_W = 16;
/** Gösterilen canvas genişliği — küçük kare yumuşak büyütülür, CSS filter (GPU blur) yok. */
const VIEW_W = 64;
/** Pil bu oranın altında ve şarjda değilse güncelleme durur. */
const LOW_BATTERY = 0.2;

/** Ortam ışığı: seyrek, 16px'lik kareden yumuşak büyütülmüş ışık; yalnızca oynarken ve görünürken güncellenir. */
export class Ambient {
    private readonly layer: HTMLDivElement;
    private readonly views: [HTMLCanvasElement, HTMLCanvasElement];
    private readonly sample = document.createElement('canvas');
    private front = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inView = true;
    private lowBattery = false;
    private battery: BatteryLike | null = null;
    private readonly io: IntersectionObserver | null;
    private readonly ro: ResizeObserver | null;
    private readonly root: HTMLElement;
    private updateMs = 2000;
    private spread = 0.12;
    private sx = 1;
    private sy = 1;

    constructor(
        private readonly ctx: AmbientContext,
        options: AmbientOptions
    ) {
        this.root = ctx.videoArea.parentElement as HTMLElement;
        this.layer = document.createElement('div');
        this.layer.className = 'hp-ambient';
        this.layer.setAttribute('part', 'ambient');
        this.layer.setAttribute('aria-hidden', 'true');
        this.views = [document.createElement('canvas'), document.createElement('canvas')];
        for (const c of this.views) this.layer.appendChild(c);
        this.root.classList.add('hp-ambient-on');
        this.root.insertBefore(this.layer, this.root.firstChild);
        this.setOptions(options);

        const v = ctx.videoEl;
        v.addEventListener('play', this.onPlay);
        v.addEventListener('pause', this.stop);
        v.addEventListener('ended', this.stop);
        v.addEventListener('loadeddata', this.drawOnce);
        v.addEventListener('seeked', this.drawOnce);
        v.addEventListener('emptied', this.clear);
        document.addEventListener('visibilitychange', this.onPlay);
        document.addEventListener('fullscreenchange', this.onPlay);
        document.addEventListener('webkitfullscreenchange', this.onPlay);
        v.addEventListener('webkitendfullscreen', this.onPlay);
        this.io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(this.onIntersect) : null;
        this.io?.observe(ctx.hostEl);
        this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(this.fit) : null;
        this.ro?.observe(ctx.videoArea);
        this.watchBattery();
        this.onPlay();
    }

    setOptions(o: AmbientOptions): void {
        const num = (x: unknown, d: number, min: number, max: number): number =>
            typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d;
        this.updateMs = num(o.updateMs, 2000, 500, 60000);
        // Geçiş aralığın %60'ı (en fazla 1.2 sn), kısa aralıkta da kare bitmeden tamamlanır.
        this.layer.style.setProperty('--hp-ambient-fade', `${Math.min(1200, this.updateMs * 0.6)}ms`);
        this.layer.style.setProperty('--hp-ambient-opacity', String(num(o.opacity, 0.7, 0, 1)));
        this.spread = num(o.spread, 0.12, 0, 0.5);
        this.fit();
    }

    /** Işık yalnızca video alanının arkasında (paneller hariç); taşma her yönde aynı piksel. */
    private readonly fit = (): void => {
        const a = this.ctx.videoArea;
        const w = a.offsetWidth;
        const h = a.offsetHeight;
        this.layer.style.top = `${a.offsetTop}px`;
        this.layer.style.height = `${h}px`;
        if (!w || !h) return;
        const px = this.spread * w;
        const sx = 1 + (2 * px) / w;
        const sy = 1 + (2 * px) / h;
        // Maske ölçeğe bağlı — yalnızca değişince yeniden çiz.
        if (sx === this.sx && sy === this.sy && this.views[this.front]!.hasAttribute('data-on')) return;
        this.sx = sx;
        this.sy = sy;
        this.layer.style.setProperty('--hp-ambient-sx', String(this.sx));
        this.layer.style.setProperty('--hp-ambient-sy', String(this.sy));
        this.drawOnce();
    };

    private readonly onIntersect = (entries: IntersectionObserverEntry[]): void => {
        this.inView = entries[entries.length - 1]!.isIntersecting;
        this.onPlay();
    };

    private watchBattery(): void {
        const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
        void nav
            .getBattery?.()
            .then((b) => {
                if (!this.layer.isConnected) return;
                this.battery = b;
                b.addEventListener('levelchange', this.onBattery);
                b.addEventListener('chargingchange', this.onBattery);
                this.onBattery();
            })
            .catch(() => {});
    }

    private readonly onBattery = (): void => {
        const b = this.battery;
        this.lowBattery = !!b && !b.charging && b.level <= LOW_BATTERY;
        this.onPlay();
    };

    private fullscreen(): boolean {
        const h = this.ctx.hostEl;
        const doc = document as Document & { webkitFullscreenElement?: Element | null };
        return document.fullscreenElement === h || doc.webkitFullscreenElement === h || h.hasAttribute('data-hp-fullscreen') || !!this.ctx.videoEl.webkitDisplayingFullscreen;
    }

    /** Güncelleme döngüsü yalnızca gerektiğinde çalışır. */
    private readonly onPlay = (): void => {
        const v = this.ctx.videoEl;
        const run = !v.paused && !v.ended && !document.hidden && this.inView && !this.lowBattery && !this.fullscreen();
        if (!run) return this.stop();
        if (this.timer) return;
        this.tick();
    };

    private readonly tick = (): void => {
        this.timer = null;
        this.drawOnce();
        this.timer = setTimeout(this.tick, this.updateMs);
    };

    private readonly stop = (): void => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    };

    private readonly clear = (): void => {
        this.stop();
        for (const c of this.views) c.removeAttribute('data-on');
    };

    /** Kareyi al, yumuşak büyüt, kenarları sönümle; iki canvas arasında opacity geçişi. */
    private readonly drawOnce = (): void => {
        const v = this.ctx.videoEl;
        // DRM'li karede canvas siyah kalır; reklam sırasında içerik videosu değişmez.
        if (v.readyState < 2 || !v.videoWidth || v.mediaKeys || this.ctx.isAdActive() || this.fullscreen()) return;
        const sh = Math.max(4, Math.round((SAMPLE_W * v.videoHeight) / v.videoWidth));
        const vh = Math.max(16, Math.round((VIEW_W * v.videoHeight) / v.videoWidth));
        const s = this.sample;
        if (s.width !== SAMPLE_W || s.height !== sh) {
            s.width = SAMPLE_W;
            s.height = sh;
        }
        const next = this.views[1 - this.front]!;
        if (next.width !== VIEW_W || next.height !== vh) {
            next.width = VIEW_W;
            next.height = vh;
        }
        const sc = s.getContext('2d');
        const nc = next.getContext('2d');
        if (!sc || !nc) return;
        try {
            sc.filter = 'saturate(1.4)';
            sc.drawImage(v, 0, 0, SAMPLE_W, sh);
            nc.globalCompositeOperation = 'copy';
            nc.imageSmoothingEnabled = true;
            nc.imageSmoothingQuality = 'high';
            nc.drawImage(s, 0, 0, VIEW_W, vh);
            // Video kenarından dışa doğru sönümlenen yumuşak dikdörtgen (yatay × dikey maske).
            nc.globalCompositeOperation = 'destination-in';
            this.fade(nc, nc.createLinearGradient(0, 0, VIEW_W, 0), this.sx, VIEW_W, vh);
            this.fade(nc, nc.createLinearGradient(0, 0, 0, vh), this.sy, VIEW_W, vh);
        } catch {
            return;
        }
        next.setAttribute('data-on', '');
        this.views[this.front]!.removeAttribute('data-on');
        this.front = 1 - this.front;
    };

    private fade(c: CanvasRenderingContext2D, g: CanvasGradient, scale: number, w: number, h: number): void {
        const e = Math.min(0.49, Math.max(0.01, (1 - 1 / scale) / 2));
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(e * 0.45, 'rgba(0,0,0,0.3)');
        g.addColorStop(e, '#000');
        g.addColorStop(1 - e, '#000');
        g.addColorStop(1 - e * 0.45, 'rgba(0,0,0,0.3)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
    }

    destroy(): void {
        this.stop();
        const v = this.ctx.videoEl;
        v.removeEventListener('play', this.onPlay);
        v.removeEventListener('pause', this.stop);
        v.removeEventListener('ended', this.stop);
        v.removeEventListener('loadeddata', this.drawOnce);
        v.removeEventListener('seeked', this.drawOnce);
        v.removeEventListener('emptied', this.clear);
        document.removeEventListener('visibilitychange', this.onPlay);
        document.removeEventListener('fullscreenchange', this.onPlay);
        document.removeEventListener('webkitfullscreenchange', this.onPlay);
        v.removeEventListener('webkitendfullscreen', this.onPlay);
        this.battery?.removeEventListener('levelchange', this.onBattery);
        this.battery?.removeEventListener('chargingchange', this.onBattery);
        this.io?.disconnect();
        this.ro?.disconnect();
        this.layer.remove();
        this.root.classList.remove('hp-ambient-on');
    }
}
