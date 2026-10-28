import type { SpriteThumbnailsOptions } from '../../types';
import { formatTime } from '../../utils/format-time';

export interface SpriteThumbnailsPlayerContext {
    videoEl: HTMLVideoElement;
    /** Önizlemenin bağlandığı seek bar — zaman eşlemesi (chapter boşlukları dahil) onun `ratioAtClientX`'inden. */
    seekBar: {
        readonly el: HTMLElement;
        ratioAtClientX(clientX: number): number;
        suppressHoverTime(key: string, suppressed: boolean): void;
    };
    /** Responsive ölçekleme için referans genişlik — genelde player/video alanının genişliği. */
    playerWidth(): number;
}

/** Bir önizleme karesi: hangi görselin hangi dikdörtgeni. */
interface Frame {
    url: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

interface Sheet {
    img: HTMLImageElement;
    ready: boolean;
    failed: boolean;
    promise: Promise<void>;
}

export interface VttCue {
    start: number;
    end: number;
    url: string;
    /** `#xywh` yoksa null → görselin tamamı. */
    rect: { x: number; y: number; w: number; h: number } | null;
}

/** Aynı anda bellekte (decode edilmiş) tutulan en fazla sheet — uzun videolarda bellek sınırsız büyümesin. */
const MAX_CACHED_SHEETS = 8;
/** Sheet numarası şablonu: `%d` ya da sıfır dolgulu `%03d`. */
const SHEET_TEMPLATE = /%(0(\d+))?d/;

/**
 * Seek bar hover önizlemesi. Kaynak: tek görsel, çok parçalı (%d / %03d şablonu ya da sheets) veya WebVTT (#xywh).
 * sheetDuration verilmezse ilk sheet'in ızgarasından hesaplanır. Kurulumda hiçbir şey indirilmez; yalnızca imlecin
 * altındaki sheet + komşuları yüklenir, decode bitmeden gösterilmez, LRU cache.
 */
export class SpriteThumbnails {
    private readonly tooltip: HTMLElement;
    private readonly imageEl: HTMLElement;
    private readonly timeEl: HTMLElement;
    private readonly sheets = new Map<string, Sheet>();
    private vttCues: VttCue[] | null = null;
    private vttLoading: Promise<void> | null = null;
    /** Çok parçalı modda otomatik hesaplanan sheet süresi (ilk sheet yüklenince). */
    private derivedSheetDuration: number | null = null;
    private warmed = false;
    private hovering = false;
    private lastClientX = 0;
    private rafId: number | null = null;
    private destroyed = false;

    constructor(
        private readonly ctx: SpriteThumbnailsPlayerContext,
        private readonly options: SpriteThumbnailsOptions
    ) {
        this.tooltip = document.createElement('div');
        this.tooltip.setAttribute('part', 'sprite-tooltip');
        this.tooltip.className = 'hp-sprite-tooltip';
        this.imageEl = document.createElement('div');
        this.imageEl.className = 'hp-sprite-image';
        this.timeEl = document.createElement('div');
        this.timeEl.className = 'hp-sprite-time';
        this.tooltip.append(this.imageEl, this.timeEl);
        ctx.seekBar.el.appendChild(this.tooltip);
        // Önizlemenin altında zaman zaten yazıyor — varsayılan hover zamanı ikinci kez göstermesin.
        ctx.seekBar.suppressHoverTime('sprite', true);

        ctx.seekBar.el.addEventListener('pointerenter', this.onPointerEnter);
        ctx.seekBar.el.addEventListener('pointermove', this.onPointerMove);
        ctx.seekBar.el.addEventListener('pointerleave', this.onPointerLeave);
        ctx.videoEl.addEventListener('play', this.warm);
    }

    destroy(): void {
        this.destroyed = true;
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.ctx.seekBar.el.removeEventListener('pointerenter', this.onPointerEnter);
        this.ctx.seekBar.el.removeEventListener('pointermove', this.onPointerMove);
        this.ctx.seekBar.el.removeEventListener('pointerleave', this.onPointerLeave);
        this.ctx.videoEl.removeEventListener('play', this.warm);
        this.tooltip.remove();
        this.ctx.seekBar.suppressHoverTime('sprite', false);
        for (const sheet of this.sheets.values()) sheet.img.src = '';
        this.sheets.clear();
    }

    // ── olaylar ──

    private readonly onPointerEnter = (e: PointerEvent): void => {
        this.hovering = true;
        this.lastClientX = e.clientX;
        this.warm();
        this.scheduleRender();
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        this.hovering = true;
        this.lastClientX = e.clientX;
        this.scheduleRender();
    };

    private readonly onPointerLeave = (): void => {
        this.hovering = false;
        this.tooltip.removeAttribute('data-visible');
    };

    /** İlk ihtiyaç anında (hover / oynatma) kaynağı hazırla — kurulumda hiçbir şey indirilmiyor. */
    private readonly warm = (): void => {
        if (this.warmed || this.destroyed) return;
        this.warmed = true;
        if (this.options.vtt) {
            void this.loadVtt();
            return;
        }
        const duration = this.ctx.videoEl.duration;
        const t = Number.isFinite(duration) ? this.ctx.videoEl.currentTime : 0;
        // Şablonlu/çok parçalı modda sheet süresi henüz bilinmiyorsa ilk sheet'ten öğrenilecek.
        void this.ensureSheet(this.sheetUrl(this.isMultiSheet() && this.sheetDuration() === null ? 0 : this.sheetIndexAt(t)));
    };

    private scheduleRender(): void {
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.render();
        });
    }

    // ── çizim ──

    private render(): void {
        if (!this.hovering || this.destroyed) return;
        const duration = this.ctx.videoEl.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;

        const seconds = this.ctx.seekBar.ratioAtClientX(this.lastClientX) * duration;
        this.timeEl.textContent = formatTime(seconds);

        const frame = this.isNetworkEligible() ? this.frameAt(seconds, duration) : null;
        const scale = this.scale();
        if (frame) {
            const sheet = this.sheets.get(frame.url)!;
            const { naturalWidth, naturalHeight } = sheet.img;
            this.imageEl.style.display = '';
            this.imageEl.style.width = `${frame.w * scale}px`;
            this.imageEl.style.height = `${frame.h * scale}px`;
            this.imageEl.style.backgroundImage = `url("${frame.url}")`;
            this.imageEl.style.backgroundSize = `${naturalWidth * scale}px ${naturalHeight * scale}px`;
            this.imageEl.style.backgroundPosition = `${-frame.x * scale}px ${-frame.y * scale}px`;
        } else if (!this.imageEl.style.backgroundImage) {
            // Henüz hiçbir kare yüklenmedi — yalnızca zaman (yükleme bitince yeniden çizilir).
            this.imageEl.style.display = 'none';
        }

        // Kenarlarda taşmasın: imleci ortala ama seek bar sınırlarında kal.
        this.tooltip.setAttribute('data-visible', '');
        const barRect = this.ctx.seekBar.el.getBoundingClientRect();
        const tipWidth = this.tooltip.offsetWidth;
        const x = Math.min(Math.max(this.lastClientX - barRect.left - tipWidth / 2, 0), Math.max(barRect.width - tipWidth, 0));
        this.tooltip.style.transform = `translateX(${x}px)`;
    }

    private scale(): number {
        const responsive = this.options.responsive;
        const playerWidth = this.ctx.playerWidth();
        return responsive && playerWidth && playerWidth < responsive ? playerWidth / responsive : 1;
    }

    private isNetworkEligible(): boolean {
        const nav = navigator as Navigator & { connection?: { downlink?: number } };
        const downlink = nav.connection?.downlink;
        const anyReady = Array.from(this.sheets.values()).some((s) => s.ready);
        return downlink === undefined || downlink >= (this.options.downlink ?? 2) || anyReady;
    }

    // ── kare çözümleme ──

    /** Saniyedeki kareyi döner; gereken sheet hazır değilse yüklemeyi başlatıp null döner (yüklenince render tekrar çağrılır). */
    private frameAt(seconds: number, duration: number): Frame | null {
        return this.options.vtt ? this.vttFrameAt(seconds) : this.gridFrameAt(seconds, duration);
    }

    private isMultiSheet(): boolean {
        return !!this.options.sheets?.length || SHEET_TEMPLATE.test(this.options.url ?? '');
    }

    /** Tek sheet → Infinity (tüm video); çok parçalı → verilen ya da ilk sheet'ten hesaplanan süre; henüz bilinmiyorsa null. */
    private sheetDuration(): number | null {
        if (!this.isMultiSheet()) return Infinity;
        return this.options.sheetDuration ?? this.derivedSheetDuration;
    }

    private sheetIndexAt(seconds: number): number {
        const d = this.sheetDuration();
        if (d === null || d === Infinity) return 0;
        // floor (ceil DEĞİL): tam sınırda (ör. 60. sn) bir SONRAKİ sheet'in ilk karesi.
        let index = Math.floor(Math.max(0, seconds) / d);
        if (this.options.sheets?.length) index = Math.min(index, this.options.sheets.length - 1);
        return index;
    }

    /** 0 tabanlı sheet index'inden URL. */
    private sheetUrl(index: number): string {
        if (this.options.sheets?.length) return this.options.sheets[Math.min(index, this.options.sheets.length - 1)]!;
        const url = this.options.url ?? '';
        const number = index + (this.options.firstSheetIndex ?? 1);
        return url.replace(SHEET_TEMPLATE, (_m, _p, width?: string) => String(number).padStart(width ? Number(width) : 0, '0'));
    }

    private gridFrameAt(seconds: number, duration: number): Frame | null {
        const { width, height } = this.options;
        if (!width || !height) return null;
        const interval = this.options.interval || 1;

        const sheetDuration = this.sheetDuration();
        if (sheetDuration === null) {
            // Çok parçalı ama süre bilinmiyor — ilk sheet yüklenince hesaplanacak.
            void this.ensureSheet(this.sheetUrl(0));
            return null;
        }

        const lastIndex = sheetDuration === Infinity ? 0 : this.sheetIndexAt(Math.max(0, duration - 0.001));
        const index = Math.min(this.sheetIndexAt(seconds), lastIndex);
        const url = this.sheetUrl(index);
        this.preloadAround(index, lastIndex);

        const sheet = this.sheets.get(url);
        if (!sheet?.ready) {
            void this.ensureSheet(url);
            return null;
        }
        this.touch(url);

        // Her sheet'in KENDİ boyutu (son sheet daha kısa olabilir).
        const columns = Math.max(1, Math.floor(sheet.img.naturalWidth / width));
        const rows = Math.max(1, Math.floor(sheet.img.naturalHeight / height));
        const local = sheetDuration === Infinity ? seconds : seconds - index * sheetDuration;
        const frameIndex = Math.min(Math.max(0, Math.floor(local / interval)), columns * rows - 1);
        return { url, x: (frameIndex % columns) * width, y: Math.floor(frameIndex / columns) * height, w: width, h: height };
    }

    private preloadAround(index: number, lastIndex: number): void {
        const n = this.options.preloadSheets ?? 1;
        for (let d = 1; d <= n; d++) {
            if (index + d <= lastIndex) void this.ensureSheet(this.sheetUrl(index + d));
            if (index - d >= 0) void this.ensureSheet(this.sheetUrl(index - d));
        }
    }

    private vttFrameAt(seconds: number): Frame | null {
        if (!this.vttCues) {
            void this.loadVtt();
            return null;
        }
        const cues = this.vttCues;
        if (!cues.length) return null;
        // İkili arama — saatlerce süren videolarda binlerce cue olabilir.
        let lo = 0;
        let hi = cues.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (cues[mid]!.start <= seconds) lo = mid;
            else hi = mid - 1;
        }
        const cue = cues[lo]!;
        const neighbours = [cues[lo + 1], cues[lo - 1]].filter((c): c is VttCue => !!c && c.url !== cue.url);
        neighbours.forEach((c) => void this.ensureSheet(c.url));

        const sheet = this.sheets.get(cue.url);
        if (!sheet?.ready) {
            void this.ensureSheet(cue.url);
            return null;
        }
        this.touch(cue.url);
        const rect = cue.rect ?? { x: 0, y: 0, w: sheet.img.naturalWidth, h: sheet.img.naturalHeight };
        return { url: cue.url, ...rect };
    }

    // ── yükleme / cache ──

    private ensureSheet(url: string): Promise<void> {
        if (!url) return Promise.resolve();
        const existing = this.sheets.get(url);
        if (existing) return existing.promise;

        const img = new Image();
        img.decoding = 'async';
        const sheet: Sheet = { img, ready: false, failed: false, promise: Promise.resolve() };
        sheet.promise = new Promise<void>((resolve) => {
            img.onload = () => {
                // decode() bitmeden gösterme — yeni sheet'e geçerken boş/yanlış kare titremesi olmasın.
                const done = () => {
                    if (this.destroyed) return resolve();
                    sheet.ready = true;
                    this.learnSheetDuration(img);
                    if (this.hovering) this.scheduleRender();
                    resolve();
                };
                img.decode ? img.decode().then(done, done) : done();
            };
            img.onerror = () => {
                sheet.failed = true;
                resolve();
            };
        });
        img.src = url;
        this.sheets.set(url, sheet);
        this.evict();
        return sheet.promise;
    }

    /** Çok parçalı modda `sheetDuration` verilmediyse ilk yüklenen sheet'in ızgara kapasitesinden hesapla. */
    private learnSheetDuration(img: HTMLImageElement): void {
        if (this.derivedSheetDuration !== null || this.options.vtt || !this.isMultiSheet() || this.options.sheetDuration) return;
        const { width, height } = this.options;
        if (!width || !height) return;
        const capacity = Math.max(1, Math.floor(img.naturalWidth / width)) * Math.max(1, Math.floor(img.naturalHeight / height));
        this.derivedSheetDuration = capacity * (this.options.interval || 1);
    }

    /** LRU: kullanılan sheet'i sona taşı. */
    private touch(url: string): void {
        const sheet = this.sheets.get(url);
        if (!sheet) return;
        this.sheets.delete(url);
        this.sheets.set(url, sheet);
    }

    private evict(): void {
        while (this.sheets.size > MAX_CACHED_SHEETS) {
            const oldest = this.sheets.keys().next().value as string;
            const sheet = this.sheets.get(oldest)!;
            sheet.img.onload = null;
            sheet.img.onerror = null;
            this.sheets.delete(oldest);
        }
    }

    private loadVtt(): Promise<void> {
        if (this.vttLoading) return this.vttLoading;
        const vttUrl = this.options.vtt!;
        this.vttLoading = fetch(vttUrl)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.text();
            })
            .then((text) => {
                if (this.destroyed) return;
                this.vttCues = parseThumbnailVtt(text, new URL(vttUrl, document.baseURI).href);
                if (this.vttCues.length) void this.ensureSheet(this.vttCues[0]!.url);
                if (this.hovering) this.scheduleRender();
            })
            .catch((err) => {
                console.warn('[HopePlayer sprite-thumbnails] VTT yüklenemedi:', err);
                this.vttCues = [];
            });
        return this.vttLoading;
    }
}

/** "01:02:03.500" / "02:03.500" → saniye. */
function parseVttTime(value: string): number {
    const parts = value.trim().split(':').map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** WebVTT thumbnail dosyası → sıralı cue listesi. Görsel yolları VTT dosyasına göre çözümlenir. */
export function parseThumbnailVtt(text: string, baseUrl: string): VttCue[] {
    const cues: VttCue[] = [];
    const blocks = text.replace(/\r/g, '').split(/\n\n+/);
    for (const block of blocks) {
        const lines = block.split('\n').filter(Boolean);
        const timingIndex = lines.findIndex((l) => l.includes('-->'));
        if (timingIndex === -1) continue;
        const [startStr, endStr] = lines[timingIndex]!.split('-->');
        const target = lines[timingIndex + 1]?.trim();
        if (!startStr || !endStr || !target) continue;

        const [path, hash] = target.split('#');
        const match = hash?.match(/xywh=(\d+),(\d+),(\d+),(\d+)/);
        cues.push({
            start: parseVttTime(startStr),
            end: parseVttTime(endStr.trim().split(/\s+/)[0]!),
            url: new URL(path!, baseUrl).href,
            rect: match ? { x: +match[1]!, y: +match[2]!, w: +match[3]!, h: +match[4]! } : null,
        });
    }
    return cues.sort((a, b) => a.start - b.start);
}
