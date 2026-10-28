import type { SegmentItem } from '../../types';
import type { SeekBarChapterRange } from '../../controls/SeekBar';
import { formatTime } from '../../utils/format-time';

export interface SegmentsPlayerContext {
    videoEl: HTMLVideoElement;
    /** Chapter modunu destekleyen seek bar — parçalara bölme/zaman eşlemesi onda. */
    seekBar: {
        readonly el: HTMLElement;
        setChapters(ranges: SeekBarChapterRange[]): HTMLElement[];
        suppressHoverTime(key: string, suppressed: boolean): void;
        clearChapters(): void;
        ratioAtClientX(clientX: number): number;
    };
}

interface Chapter {
    start: number;
    end: number;
    text?: string;
    color?: string;
}

/**
 * YouTube tarzı bölümler: seek bar parçalara bölünür (SeekBar.setChapters), hover'da bölüm adı + zaman.
 * Zaman çizgisi her zaman tam kaplanır (boşluklar adsız bölüm, son bölüm sona uzar).
 */
export class Segments {
    private chapters: Chapter[] = [];
    private chapterEls: HTMLElement[] = [];
    private hoverIndex = -1;
    private readonly tooltipEl: HTMLDivElement;
    private readonly titleEl: HTMLDivElement;
    private readonly timeEl: HTMLDivElement;

    constructor(
        private readonly ctx: SegmentsPlayerContext,
        private readonly segments: SegmentItem[]
    ) {
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.className = 'hp-chapter-tooltip';
        this.tooltipEl.setAttribute('part', 'segment-tooltip');
        this.titleEl = document.createElement('div');
        this.titleEl.className = 'hp-chapter-tooltip-title';
        this.timeEl = document.createElement('div');
        this.timeEl.className = 'hp-chapter-tooltip-time';
        this.tooltipEl.append(this.titleEl, this.timeEl);
        ctx.seekBar.el.appendChild(this.tooltipEl);
        // Popup zamanı zaten gösteriyor — seek bar'ın varsayılan hover zamanı ikinci kez yazmasın.
        ctx.seekBar.suppressHoverTime('segments', true);

        ctx.seekBar.el.addEventListener('pointermove', this.onPointerMove);
        ctx.seekBar.el.addEventListener('pointerleave', this.onPointerLeave);
        ctx.videoEl.addEventListener('loadedmetadata', this.onLoadedMetadata);
        if (ctx.videoEl.readyState >= 1) this.onLoadedMetadata();
    }

    destroy(): void {
        this.ctx.videoEl.removeEventListener('loadedmetadata', this.onLoadedMetadata);
        this.ctx.seekBar.el.removeEventListener('pointermove', this.onPointerMove);
        this.ctx.seekBar.el.removeEventListener('pointerleave', this.onPointerLeave);
        this.ctx.seekBar.clearChapters();
        this.ctx.seekBar.suppressHoverTime('segments', false);
        this.tooltipEl.remove();
        this.chapterEls = [];
        this.chapters = [];
    }

    private readonly onLoadedMetadata = (): void => {
        const duration = this.ctx.videoEl.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;

        this.chapters = buildChapters(this.segments, duration);
        this.chapterEls = this.ctx.seekBar.setChapters(
            this.chapters.map((c) => ({ start: c.start / duration, end: c.end / duration, color: c.color }))
        );
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        const duration = this.ctx.videoEl.duration;
        if (!this.chapters.length || !Number.isFinite(duration) || duration <= 0) return;

        const time = this.ctx.seekBar.ratioAtClientX(e.clientX) * duration;
        let index = this.chapters.findIndex((c) => time < c.end);
        if (index === -1) index = this.chapters.length - 1;
        this.setHover(index);

        const chapter = this.chapters[index]!;
        this.titleEl.textContent = chapter.text ?? '';
        this.titleEl.style.display = chapter.text ? '' : 'none';
        this.timeEl.textContent = formatTime(time);

        // sprite-thumbnails önizlemesi de seek bar'ın hemen üstünde açılıyor —
        // görünürse popup onun ÜSTÜNE çıkıyor (üst üste binmesin).
        const sprite = this.ctx.seekBar.el.querySelector<HTMLElement>('[part="sprite-tooltip"]');
        const spriteH = sprite && sprite.hasAttribute('data-visible') && sprite.offsetHeight > 0 ? sprite.offsetHeight + 8 : 0;
        this.tooltipEl.style.bottom = spriteH ? `calc(100% + 6px + ${spriteH}px)` : '';
        // Sprite önizlemesi zamanı zaten kendi altında gösteriyor — aynı zaman iki kez yazılmasın.
        this.timeEl.style.display = spriteH ? 'none' : '';

        // Popup imleci ortalar ama seek bar kenarlarından taşmaz.
        const barRect = this.ctx.seekBar.el.getBoundingClientRect();
        this.tooltipEl.setAttribute('data-visible', '');
        const tipWidth = this.tooltipEl.offsetWidth;
        const x = Math.min(Math.max(e.clientX - barRect.left - tipWidth / 2, 0), Math.max(barRect.width - tipWidth, 0));
        this.tooltipEl.style.transform = `translateX(${x}px)`;
    };

    private readonly onPointerLeave = (): void => {
        this.setHover(-1);
        this.tooltipEl.removeAttribute('data-visible');
    };

    private setHover(index: number): void {
        if (index === this.hoverIndex) return;
        this.chapterEls[this.hoverIndex]?.removeAttribute('data-hover');
        this.hoverIndex = index;
        this.chapterEls[index]?.setAttribute('data-hover', '');
    }
}

/** Segmentleri sıralar, boşlukları adsız bölümle doldurur, son bölümü video sonuna uzatır — sonuç 0→duration'ı kesintisiz kaplar. */
function buildChapters(segments: SegmentItem[], duration: number): Chapter[] {
    const sorted = segments
        .filter((s) => Number.isFinite(s.start) && s.start < duration)
        .slice()
        .sort((a, b) => a.start - b.start);

    const chapters: Chapter[] = [];
    let cursor = 0;
    for (const seg of sorted) {
        const start = Math.max(seg.start, cursor);
        const end = Math.min(Number.isFinite(seg.end) ? seg.end : duration, duration);
        if (end <= start) continue;
        if (start > cursor) chapters.push({ start: cursor, end: start });
        chapters.push({ start, end, text: seg.text, color: seg.color });
        cursor = end;
    }
    if (!chapters.length) return [];
    if (cursor < duration) chapters[chapters.length - 1]!.end = duration;
    return chapters;
}
