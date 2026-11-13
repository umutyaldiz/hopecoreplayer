import type { MultiviewOptions, MultiviewSource } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { adoptStyle } from '../../utils/plugin-style';
import css from './multiview.css?inline';

/** hls.js'ten kullanılan kısım (ana player'ınki ve önizlemelerinki). */
export interface HlsLike {
    levels: { details?: { fragments: { start: number; programDateTime: number | null }[] } }[];
    currentLevel: number;
    autoLevelCapping: number;
    loadSource(src: string): void;
    attachMedia(video: HTMLVideoElement): void;
    on(event: string, fn: () => void): void;
    destroy(): void;
}

export interface MultiviewPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    videoAreaEl: HTMLElement;
    i18n: HopeLocaleStrings;
    isAdActive(): boolean;
    loadSource(src: string, type?: string): Promise<void>;
    mainHls(): HlsLike | null;
    addButton(label: string, iconName: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
}

interface Tile {
    cam: MultiviewSource;
    el: HTMLButtonElement;
    video: HTMLVideoElement | null;
    hls: HlsLike | null;
    img: HTMLImageElement | null;
}

type Rect = [x: number, y: number, w: number, h: number];

/** Bölünmüş ekran hücreleri (% — oynatıcı 16:9'da her hücre de 16:9). İlk hücre seçili kameranın. */
const GRID: Record<number, Rect[]> = {
    2: [
        [0, 25, 50, 50],
        [50, 25, 50, 50],
    ],
    3: [
        [0, 0, 50, 50],
        [50, 0, 50, 50],
        [25, 50, 50, 50],
    ],
    4: [
        [0, 0, 50, 50],
        [50, 0, 50, 50],
        [0, 50, 50, 50],
        [50, 50, 50, 50],
    ],
};

/** Senkron eşiği: önizleme bu kadardan fazla kayarsa yeniden hizalanır (sn). */
const DRIFT = 0.6;

const isHls = (cam: MultiviewSource): boolean => cam.type === 'application/x-mpegURL' || /\.m3u8(\?|#|$)/i.test(cam.src);

/** Konum ↔ gerçek saat eşlemesi: hls.js'te EXT-X-PROGRAM-DATE-TIME'lı ilk segment, Safari'de getStartDate(). */
function clockOf(video: HTMLVideoElement, hls: HlsLike | null): { pos: number; date: number } | null {
    if (hls) {
        const details = hls.levels?.[Math.max(0, hls.currentLevel)]?.details ?? hls.levels?.find((l) => l.details)?.details;
        const frag = details?.fragments.find((f) => f.programDateTime);
        return frag?.programDateTime ? { pos: frag.start, date: frag.programDateTime } : null;
    }
    const start = (video as HTMLVideoElement & { getStartDate?(): Date }).getStartDate?.();
    const t = start?.getTime();
    return t !== undefined && Number.isFinite(t) ? { pos: 0, date: t } : null;
}

function clamp(video: HTMLVideoElement, pos: number): number {
    const s = video.seekable;
    if (!s.length) return Math.max(0, pos);
    return Math.min(Math.max(pos, s.start(0)), Math.max(s.start(0), s.end(s.length - 1) - 0.3));
}

/**
 * Çoklu kamera: aynı etkinliğin birden fazla yayını. Seçili kamera player'ın kendi videosunda oynar (kontroller,
 * altyazı, reklam ona bağlı); diğerleri sessiz, düşük kaliteli önizleme olarak akar. Kamera değişince yeni yayın
 * mevcut kameranın gerçek saatine (PROGRAM-DATE-TIME ya da `offset`) hizalanıp oradan devam eder.
 */
export class Multiview {
    private readonly cams: MultiviewSource[];
    private active: MultiviewSource;
    private layout: 'focus' | 'grid';
    private readonly root: HTMLDivElement;
    private readonly frame: HTMLDivElement;
    private readonly frameLabel: HTMLSpanElement;
    private tiles = new Map<string, Tile>();
    private button: HTMLButtonElement | null = null;
    private syncTimer: ReturnType<typeof setInterval> | null = null;
    private posterTimer: ReturnType<typeof setInterval> | null = null;
    private switching = false;
    private destroyed = false;
    private HlsCtor: (new (config: object) => HlsLike) | null = null;
    private readonly ro: ResizeObserver;

    constructor(
        private readonly ctx: MultiviewPlayerContext,
        private readonly options: MultiviewOptions
    ) {
        adoptStyle(ctx.videoAreaEl, 'multiview', css);
        this.cams = options.sources.filter((c) => c.id && c.src);
        this.active = this.cams.find((c) => c.id === options.start) ?? this.cams[0]!;
        this.layout = options.layout === 'grid' ? 'grid' : 'focus';

        this.root = document.createElement('div');
        this.root.className = 'hp-mv';
        this.root.setAttribute('part', 'multiview');
        this.root.setAttribute('data-thumbs', options.thumbnails === 'right' ? 'right' : 'bottom');
        this.root.setAttribute('role', 'group');
        this.frame = document.createElement('div');
        this.frame.className = 'hp-mv-frame';
        this.frameLabel = document.createElement('span');
        this.frameLabel.className = 'hp-mv-label';
        this.frame.appendChild(this.frameLabel);
        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
        ctx.videoAreaEl.appendChild(this.root);

        if (options.button !== false && this.cams.length > 1) {
            const { btn } = ctx.addButton(ctx.i18n.multiviewLayout, 'grid', () => this.setLayout(this.layout === 'grid' ? 'focus' : 'grid'));
            btn.setAttribute('aria-pressed', 'false');
            this.button = btn;
        }

        const v = ctx.videoEl;
        v.addEventListener('play', this.onMainPlay);
        v.addEventListener('pause', this.onMainPause);
        v.addEventListener('seeked', this.sync);
        v.addEventListener('ratechange', this.onRate);
        ctx.hostEl.addEventListener('hp:adstart', this.onAdStart);
        ctx.hostEl.addEventListener('hp:adend', this.onAdEnd);
        this.ro = new ResizeObserver(() => this.render());
        this.ro.observe(ctx.videoAreaEl);
        if (options.sync !== false) this.syncTimer = setInterval(this.sync, 1000);
        if (options.posterRefresh && options.posterRefresh > 0) this.posterTimer = setInterval(this.refreshPosters, options.posterRefresh * 1000);

        this.refreshLabels();
        this.render();
    }

    get activeId(): string {
        return this.active.id;
    }

    refreshLabels(): void {
        const i18n = this.ctx.i18n;
        this.root.setAttribute('aria-label', i18n.multiviewCameras);
        this.button?.setAttribute('aria-label', i18n.multiviewLayout);
        for (const t of this.tiles.values()) this.labelTile(t);
    }

    setLayout(layout: 'focus' | 'grid'): void {
        if (layout === this.layout) return;
        this.layout = layout;
        this.render();
        this.emit('layout');
    }

    /** Kamerayı değiştir: yeni yayın mevcut kameranın gerçek saatine hizalanır. */
    async switchTo(id: string): Promise<void> {
        const next = this.cams.find((c) => c.id === id);
        if (!next || next === this.active || this.switching || this.ctx.isAdActive()) return;
        this.switching = true;
        const v = this.ctx.videoEl;
        const from = this.active;
        const wasPaused = v.paused;
        const rate = v.playbackRate || 1;
        const startedAt = performance.now();
        // Şu anki an: gerçek saat (varsa) ve etkinlik saniyesi (offset ile).
        const clock = clockOf(v, this.ctx.mainHls());
        const nowDate = clock ? clock.date + (v.currentTime - clock.pos) * 1000 : null;
        const nowEvent = v.currentTime + (from.offset ?? 0);

        this.active = next;
        this.dropTile(next.id);
        this.render();
        try {
            await this.ctx.loadSource(next.src, next.type);
            await this.waitFor(v, 'loadedmetadata', 10_000);
            if (this.options.sync !== false) {
                const c = nowDate !== null ? await this.waitClock(v) : null;
                // Hedef her an yeniden hesaplanır: beklerken geçen süre de eklenir.
                const target = (): number => {
                    const elapsed = wasPaused ? 0 : ((performance.now() - startedAt) / 1000) * rate;
                    return clamp(v, nowDate !== null && c ? c.pos + (nowDate + elapsed * 1000 - c.date) / 1000 : nowEvent + elapsed - (next.offset ?? 0));
                };
                // hls.js ilk segmentte kendi başlangıç konumuna sarar — yavaş tarayıcıda bizim sarmamızı ezerdi.
                // Hizalama video oynamaya hazır olunca yapılır ve tutana kadar (en fazla 3 kez) tekrarlanır.
                await this.waitFor(v, 'canplay', 5000);
                for (let i = 0; i < 3; i++) {
                    v.currentTime = target();
                    await this.waitFor(v, 'seeked', 3000);
                    if (Math.abs(v.currentTime - target()) <= DRIFT) break;
                }
            }
            v.playbackRate = rate;
            if (!wasPaused) await v.play().catch(() => {});
        } finally {
            this.switching = false;
        }
        if (this.destroyed) return;
        this.render();
        this.emit('switch', from.id);
    }

    destroy(): void {
        this.destroyed = true;
        const v = this.ctx.videoEl;
        v.removeEventListener('play', this.onMainPlay);
        v.removeEventListener('pause', this.onMainPause);
        v.removeEventListener('seeked', this.sync);
        v.removeEventListener('ratechange', this.onRate);
        this.ctx.hostEl.removeEventListener('hp:adstart', this.onAdStart);
        this.ctx.hostEl.removeEventListener('hp:adend', this.onAdEnd);
        if (this.syncTimer) clearInterval(this.syncTimer);
        if (this.posterTimer) clearInterval(this.posterTimer);
        this.ro.disconnect();
        for (const id of [...this.tiles.keys()]) this.dropTile(id);
        this.root.remove();
        this.button?.remove();
        this.setMainRect(null);
    }

    private emit(state: 'switch' | 'layout', from?: string): void {
        this.ctx.hostEl.dispatchEvent(
            new CustomEvent('hp:multiview', { detail: { state, id: this.active.id, ...(from ? { from } : {}), layout: this.layout } })
        );
    }

    /** Dar / dokunmatik ekran: akış sayısı sınırlı, önizleme poster. */
    private isMobile(): boolean {
        return this.ctx.videoAreaEl.clientWidth < 560 || matchMedia('(pointer: coarse)').matches;
    }

    private wantsVideo(): boolean {
        const p = this.options.previews ?? 'auto';
        return p === 'video' || (p === 'auto' && !this.isMobile());
    }

    /** Görünür kameralar: grid'de ana dahil en fazla 4 (mobilde maxMobileStreams); focus'ta hepsi. */
    private visibleOthers(): MultiviewSource[] {
        const others = this.cams.filter((c) => c !== this.active);
        if (this.layout === 'focus') return others;
        const max = this.isMobile() ? Math.max(2, this.options.maxMobileStreams ?? 2) : 4;
        return others.slice(0, max - 1);
    }

    private render(): void {
        if (this.destroyed) return;
        const grid = this.layout === 'grid' && this.cams.length > 1;
        this.root.setAttribute('data-layout', grid ? 'grid' : 'focus');
        this.ctx.videoAreaEl.setAttribute('data-mv', grid ? 'grid' : 'focus');
        this.button?.setAttribute('aria-pressed', String(grid));

        const others = this.visibleOthers();
        // Görünmeyen önizlemeler kapanır (bant genişliği).
        const keep = new Set(others.map((c) => c.id));
        if (!grid) keep.add(this.active.id);
        for (const id of [...this.tiles.keys()]) if (!keep.has(id)) this.dropTile(id);

        const order = grid ? others : this.cams;
        const cells = GRID[others.length + 1];
        this.setMainRect(grid && cells ? cells[0]! : null);
        // Grid'de sesi açık (ana) hücrenin çerçevesi + adı.
        if (grid && cells) {
            const [x, y, w, h] = cells[0]!;
            Object.assign(this.frame.style, { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` });
            this.frameLabel.textContent = `${this.active.label} · ${this.ctx.i18n.multiviewWatching}`;
            this.root.appendChild(this.frame);
        } else {
            this.frame.remove();
        }
        order.forEach((cam, i) => {
            const tile = this.tiles.get(cam.id) ?? this.makeTile(cam);
            const isActive = cam === this.active;
            tile.el.toggleAttribute('data-active', isActive);
            tile.el.setAttribute('aria-pressed', String(isActive));
            if (grid && cells) {
                const [x, y, w, h] = cells[i + 1]!;
                Object.assign(tile.el.style, { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` });
            } else {
                tile.el.style.cssText = '';
            }
            this.root.appendChild(tile.el); // sırayı koru
            // Seçili kamera önizlemede akmaz (zaten büyük oynuyor); diğerleri ayara göre video ya da poster.
            this.setPreview(tile, !isActive && (grid || this.wantsVideo()));
        });
        this.labelTiles();
        this.sync();
    }

    /** Grid'de ana videonun hücresi (CSS değişkenleri); null → tam alan. */
    private setMainRect(rect: Rect | null): void {
        const area = this.ctx.videoAreaEl;
        if (!rect) {
            area.removeAttribute('data-mv-grid');
            for (const k of ['x', 'y', 'w', 'h']) area.style.removeProperty(`--hp-mv-${k}`);
            if (!this.destroyed) return;
            area.removeAttribute('data-mv');
            return;
        }
        area.setAttribute('data-mv-grid', '');
        const [x, y, w, h] = rect;
        area.style.setProperty('--hp-mv-x', `${x}%`);
        area.style.setProperty('--hp-mv-y', `${y}%`);
        area.style.setProperty('--hp-mv-w', `${w}%`);
        area.style.setProperty('--hp-mv-h', `${h}%`);
    }

    private makeTile(cam: MultiviewSource): Tile {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'hp-mv-tile';
        el.setAttribute('data-cam', cam.id);
        const label = document.createElement('span');
        label.className = 'hp-mv-label';
        label.textContent = cam.label;
        const badge = document.createElement('span');
        badge.className = 'hp-mv-badge';
        el.append(label, badge);
        el.addEventListener('click', () => void this.switchTo(cam.id));
        const tile: Tile = { cam, el, video: null, hls: null, img: null };
        this.tiles.set(cam.id, tile);
        return tile;
    }

    private labelTile(t: Tile): void {
        const i18n = this.ctx.i18n;
        const active = t.cam === this.active;
        t.el.setAttribute('aria-label', active ? `${t.cam.label} — ${i18n.multiviewWatching}` : i18n.multiviewSwitch(t.cam.label));
        const badge = t.el.querySelector('.hp-mv-badge')!;
        badge.textContent = active ? i18n.multiviewWatching : t.el.hasAttribute('data-waiting') ? i18n.multiviewNotStarted : '';
    }

    private labelTiles(): void {
        for (const t of this.tiles.values()) this.labelTile(t);
    }

    private dropTile(id: string): void {
        const t = this.tiles.get(id);
        if (!t) return;
        this.stopVideo(t);
        t.el.remove();
        this.tiles.delete(id);
    }

    private stopVideo(t: Tile): void {
        t.hls?.destroy();
        t.hls = null;
        if (t.video) {
            t.video.pause();
            t.video.removeAttribute('src');
            t.video.load();
            t.video.remove();
            t.video = null;
        }
    }

    /** Önizleme: video (sessiz, en düşük kalite) ya da poster. */
    private setPreview(t: Tile, video: boolean): void {
        if (!video) {
            this.stopVideo(t);
            if (!t.img && t.cam.poster) {
                const img = document.createElement('img');
                img.className = 'hp-mv-media';
                img.alt = '';
                img.decoding = 'async';
                img.src = t.cam.poster;
                img.addEventListener('error', () => img.remove());
                t.el.prepend(img);
                t.img = img;
            }
            return;
        }
        if (t.video) return;
        const v = document.createElement('video');
        v.className = 'hp-mv-media';
        v.muted = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.preload = 'auto';
        if (t.cam.poster) v.poster = t.cam.poster;
        t.el.prepend(v);
        t.video = v;
        void this.attach(t, v);
    }

    private async attach(t: Tile, v: HTMLVideoElement): Promise<void> {
        const cam = t.cam;
        const mse = typeof window.MediaSource !== 'undefined' || 'ManagedMediaSource' in window;
        if (isHls(cam) && mse) {
            if (!this.HlsCtor) this.HlsCtor = (await import('hls.js/light')).default as unknown as new (config: object) => HlsLike;
            if (t.video !== v) return;
            // Önizleme: en düşük kalite, kısa tampon.
            const hls = new this.HlsCtor({ startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 8, maxMaxBufferLength: 16, backBufferLength: 4 });
            hls.on('hlsManifestParsed', () => {
                hls.autoLevelCapping = 0;
            });
            hls.attachMedia(v);
            hls.loadSource(cam.src);
            t.hls = hls;
        } else {
            v.src = cam.src;
        }
        v.addEventListener('loadedmetadata', () => this.sync(), { once: true });
    }

    /** Önizlemeleri ana kameranın anına hizalar; oynat / duraklat / hızı izler. */
    private readonly sync = (): void => {
        if (this.destroyed || this.switching || this.options.sync === false) return;
        const main = this.ctx.videoEl;
        const clock = clockOf(main, this.ctx.mainHls());
        const mainDate = clock ? clock.date + (main.currentTime - clock.pos) * 1000 : null;
        const mainEvent = main.currentTime + (this.active.offset ?? 0);
        for (const t of this.tiles.values()) {
            const v = t.video;
            if (!v || v.readyState < 1) continue;
            const c = clockOf(v, t.hls);
            const want = mainDate !== null && c ? c.pos + (mainDate - c.date) / 1000 : mainEvent - (t.cam.offset ?? 0);
            // Kamera bu anda henüz yayında değil (etkinliğe sonra katıldı) ya da bitti.
            const s = v.seekable;
            const before = s.length ? want < s.start(0) - 0.2 : want < -0.2;
            const after = s.length ? want > s.end(s.length - 1) + 0.2 : false;
            const waiting = before || after;
            if (t.el.hasAttribute('data-waiting') !== waiting) {
                t.el.toggleAttribute('data-waiting', waiting);
                this.labelTile(t);
            }
            if (waiting) {
                if (!v.paused) v.pause();
                continue;
            }
            // Oynamaya hazır olmadan sarılmaz (hls.js ilk segmentte başlangıç konumuna sarıp ezerdi).
            if (v.readyState >= 3 && !v.seeking && Math.abs(v.currentTime - want) > DRIFT) v.currentTime = clamp(v, want);
            v.playbackRate = main.playbackRate || 1;
            if (main.paused || this.ctx.isAdActive()) {
                if (!v.paused) v.pause();
            } else if (v.paused) {
                void v.play().catch(() => {});
            }
        }
    };

    private readonly onMainPlay = (): void => this.sync();
    private readonly onMainPause = (): void => {
        for (const t of this.tiles.values()) t.video?.pause();
    };
    private readonly onRate = (): void => this.sync();

    private readonly onAdStart = (): void => {
        this.root.setAttribute('data-ad', '');
        this.onMainPause();
    };

    private readonly onAdEnd = (): void => {
        this.root.removeAttribute('data-ad');
        this.sync();
    };

    /** Canlı yayın posterleri: önbelleği atlayarak yenile. */
    private readonly refreshPosters = (): void => {
        for (const t of this.tiles.values()) {
            if (!t.img || !t.cam.poster) continue;
            const u = new URL(t.cam.poster, location.href);
            u.searchParams.set('_hp', String(Date.now()));
            t.img.src = u.toString();
        }
    };

    private waitFor(target: EventTarget, type: string, ms: number): Promise<void> {
        const v = target as HTMLVideoElement;
        // Olay zaten olmuşsa beklenmez.
        if ((type === 'loadedmetadata' && v.readyState >= 1) || (type === 'canplay' && v.readyState >= 3) || (type === 'seeked' && !v.seeking)) return Promise.resolve();
        return new Promise((resolve) => {
            const done = (): void => {
                clearTimeout(timer);
                target.removeEventListener(type, done);
                resolve();
            };
            const timer = setTimeout(done, ms);
            target.addEventListener(type, done, { once: true });
        });
    }

    /** Yeni yayının saat bilgisi (hls.js'te playlist yüklenince gelir) — en fazla 2 sn beklenir. */
    private async waitClock(v: HTMLVideoElement): Promise<{ pos: number; date: number } | null> {
        for (let i = 0; i < 20; i++) {
            const hls = this.ctx.mainHls();
            const c = clockOf(v, hls);
            if (c) return c;
            // Liste yüklendi ama saat etiketi yok (ya da hls.js değil) — beklemeye gerek yok, offset kullanılır.
            if (!hls || hls.levels?.some((l) => l.details)) return null;
            await new Promise((r) => setTimeout(r, 100));
        }
        return null;
    }
}
