import type { AmbientOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { storageGet, storageSet } from '../../utils/storage';

export interface AmbientContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement & { webkitDisplayingFullscreen?: boolean };
    videoArea: HTMLElement;
    i18n: HopeLocaleStrings;
    isAdActive(): boolean;
    registerToggle(row: { key: string; label: string; getValueLabel(): string; onToggle(): void }): void;
    unregisterToggle(key: string): void;
}

type BatteryLike = EventTarget & { charging: boolean; level: number };

/** Gösterilen canvas genişliği — küçük kare yumuşak büyütülür, CSS filter (GPU blur) yok. */
const VIEW_W = 64;
/** Pil bu oranın altında ve şarjda değilse güncelleme durur. */
const LOW_BATTERY = 0.2;
/** Sarma / ilk kare geçişi (ms). */
const QUICK_FADE = 300;
/** İzleyicinin menüden verdiği aç-kapa tercihi. */
const STORE = 'hp-ambient';
const TOGGLE_KEY = 'ambient';

/** Ortam ışığı: seyrek, 16px'lik kareden yumuşak büyütülmüş ışık; yalnızca oynarken ve görünürken güncellenir. */
export class Ambient {
    private readonly layer: HTMLDivElement;
    private readonly glow: HTMLDivElement;
    /** Alttaki canvas önceki görüntüyü tutar, üstteki yeni görüntüyle doğrusal belirir. */
    private readonly back = document.createElement('canvas');
    private readonly top = document.createElement('canvas');
    private readonly sample = document.createElement('canvas');
    /** Kareler arası harmanlanmış renkler (hızlı aralıkta titreşimi yumuşatır). */
    private readonly acc = document.createElement('canvas');
    private anim: Animation | null = null;
    private drawn = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inView = true;
    private lowBattery = false;
    private battery: BatteryLike | null = null;
    private readonly io: IntersectionObserver | null;
    private readonly ro: ResizeObserver | null;
    private readonly root: HTMLElement;
    private updateMs = 2000;
    private spread = 0.12;
    /** Örnek kare genişliği (px) — blur'dan; küçük kare yumuşak büyütülünce bulanıklık oluşur. */
    private sampleW = 16;
    private filter = 'saturate(1.4)';
    /** İzleyici menüden kapattıysa false (tercih hatırlanır). */
    private enabled = storageGet(STORE) !== '0';

    constructor(
        private readonly ctx: AmbientContext,
        options: AmbientOptions
    ) {
        this.root = ctx.videoArea.parentElement as HTMLElement;
        this.layer = document.createElement('div');
        this.layer.className = 'hp-ambient';
        this.layer.setAttribute('part', 'ambient');
        this.layer.setAttribute('aria-hidden', 'true');
        this.glow = document.createElement('div');
        this.glow.className = 'hp-ambient-glow';
        this.glow.append(this.back, this.top);
        this.layer.appendChild(this.glow);
        this.root.classList.add('hp-ambient-on');
        this.root.insertBefore(this.layer, this.root.firstChild);
        this.setOptions(options);

        const v = ctx.videoEl;
        v.addEventListener('play', this.onPlay);
        v.addEventListener('pause', this.stop);
        v.addEventListener('ended', this.stop);
        v.addEventListener('loadeddata', this.drawQuick);
        v.addEventListener('seeked', this.drawQuick);
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
        if (!this.timer) this.drawQuick();
    }

    setOptions(o: AmbientOptions): void {
        const num = (x: unknown, d: number, min: number, max: number): number =>
            typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d;
        this.updateMs = num(o.updateMs, 2000, 100, 60000);
        this.layer.style.setProperty('--hp-ambient-opacity', String(num(o.opacity, 0.7, 0, 1)));
        this.spread = num(o.spread, 0.12, 0, 0.5);
        const sampleW = Math.min(VIEW_W, Math.max(4, Math.round(80 / num(o.blur, 5, 1, 20))));
        const filter = `saturate(${num(o.saturation, 1.4, 0, 3)}) brightness(${num(o.brightness, 1, 0, 2)})`;
        const changed = sampleW !== this.sampleW || filter !== this.filter;
        this.sampleW = sampleW;
        this.filter = filter;
        this.fit();
        if (o.menu === false) this.ctx.unregisterToggle(TOGGLE_KEY);
        else this.registerToggle();
        // Duraklatılmışken de yeni görünüm hemen yansısın.
        if (changed && this.drawn) this.draw(true);
    }

    private registerToggle(): void {
        const t = this.ctx.i18n;
        this.ctx.registerToggle({
            key: TOGGLE_KEY,
            label: t.ambient,
            getValueLabel: () => (this.enabled ? t.a11yOn : t.a11yOff),
            onToggle: () => this.setEnabled(!this.enabled),
        });
    }

    /** İzleyicinin aç-kapa seçimi; kapalıyken kare alınmaz. */
    setEnabled(on: boolean): void {
        if (on === this.enabled) return;
        this.enabled = on;
        storageSet(STORE, on ? '1' : '0');
        if (!on) return this.clear();
        this.onPlay();
        if (!this.timer) this.drawQuick();
    }

    get isEnabled(): boolean {
        return this.enabled;
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
        const g = this.glow.style;
        g.transform = `scale(${sx}, ${sy})`;
        // Maske iki canvas'ın toplamına uygulanır — geçişte kenarlar parlayıp sönmez.
        const mask = `${this.fade('right', sx)}, ${this.fade('bottom', sy)}`;
        g.setProperty('-webkit-mask-image', mask);
        g.setProperty('mask-image', mask);
    };

    /** Video kenarından dışa doğru sönümlenen yumuşak kenar. */
    private fade(dir: string, scale: number): string {
        const e = Math.min(49, Math.max(1, ((1 - 1 / scale) / 2) * 100));
        // Yumuşak başlayıp biten eğri (smoothstep²) — dış kenarda çizgi görünmez.
        const stop = (t: number, at: number): string => {
            const k = t * t * (3 - 2 * t);
            return `rgba(0,0,0,${(k * k).toFixed(3)}) ${at.toFixed(2)}%`;
        };
        const steps = [0, 0.2, 0.4, 0.6, 0.8, 1];
        const left = steps.map((t) => stop(t, t * e));
        const right = steps.map((t) => stop(t, 100 - t * e)).reverse();
        return `linear-gradient(to ${dir}, ${left.join(', ')}, ${right.join(', ')})`;
    }

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
        const run = this.enabled && !v.paused && !v.ended && !document.hidden && this.inView && !this.lowBattery && !this.fullscreen();
        if (!run) return this.stop();
        if (this.timer) return;
        this.tick();
    };

    private readonly tick = (): void => {
        this.timer = null;
        this.draw(false);
        this.timer = setTimeout(this.tick, this.updateMs);
    };

    private readonly stop = (): void => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    };

    private readonly clear = (): void => {
        this.stop();
        this.anim?.cancel();
        this.drawn = false;
        this.layer.removeAttribute('data-on');
        for (const c of [this.back, this.top]) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    };

    private readonly drawQuick = (): void => this.draw(true);

    /** Kareyi al, öncekilerle harmanla, yumuşak büyüt; yeni görüntü eskisinin üstünde doğrusal belirir. */
    private draw(quick: boolean): void {
        const v = this.ctx.videoEl;
        // DRM'li karede canvas siyah kalır; reklam sırasında içerik videosu değişmez.
        if (!this.enabled || v.readyState < 2 || !v.videoWidth || v.mediaKeys || this.ctx.isAdActive() || this.fullscreen()) return;
        const sh = Math.max(4, Math.round((this.sampleW * v.videoHeight) / v.videoWidth));
        const vh = Math.max(16, Math.round((VIEW_W * v.videoHeight) / v.videoWidth));
        const size = (c: HTMLCanvasElement, w: number, h: number): void => {
            if (c.width !== w || c.height !== h) {
                c.width = w;
                c.height = h;
            }
        };
        size(this.sample, this.sampleW, sh);
        size(this.acc, this.sampleW, sh);
        size(this.back, VIEW_W, vh);
        size(this.top, VIEW_W, vh);
        const sc = this.sample.getContext('2d');
        const ac = this.acc.getContext('2d');
        const bc = this.back.getContext('2d');
        const tc = this.top.getContext('2d');
        if (!sc || !ac || !bc || !tc) return;
        const first = !this.drawn;
        try {
            sc.filter = this.filter;
            sc.drawImage(v, 0, 0, this.sampleW, sh);
            // Kısa aralıkta yeni kare öncekilerle karışır; 400 ms ve üstünde doğrudan alınır.
            ac.globalAlpha = quick || first ? 1 : Math.min(1, this.updateMs / 400);
            ac.drawImage(this.sample, 0, 0);
            ac.globalAlpha = 1;
            bc.globalCompositeOperation = 'copy';
            if (first) bc.clearRect(0, 0, VIEW_W, vh);
            else bc.drawImage(this.top, 0, 0);
            tc.globalCompositeOperation = 'copy';
            tc.imageSmoothingEnabled = true;
            tc.imageSmoothingQuality = 'high';
            tc.drawImage(this.acc, 0, 0, VIEW_W, vh);
        } catch {
            return;
        }
        this.drawn = true;
        this.layer.setAttribute('data-on', '');
        // Geçiş bir sonraki kareye kadar sürer — ışık adım adım değil, akarak değişir.
        const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        const ms = reduced ? 0 : quick || first ? QUICK_FADE : this.updateMs * 0.9;
        this.anim?.cancel();
        this.anim = typeof this.top.animate === 'function' ? this.top.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'linear', fill: 'forwards' }) : null;
    }

    destroy(): void {
        this.stop();
        this.ctx.unregisterToggle(TOGGLE_KEY);
        this.anim?.cancel();
        const v = this.ctx.videoEl;
        v.removeEventListener('play', this.onPlay);
        v.removeEventListener('pause', this.stop);
        v.removeEventListener('ended', this.stop);
        v.removeEventListener('loadeddata', this.drawQuick);
        v.removeEventListener('seeked', this.drawQuick);
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
