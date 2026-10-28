import type { HopeLocaleStrings } from '../i18n/types';

export type CaptionFontSize = 'small' | 'normal' | 'large';

const ROWS = 6;
/** En üst satırla video tepesi arasındaki boşluk (balon yüksekliğine eklenir). */
const TOP_GAP_PX = 20;
const GAP_ABOVE_SEEKBAR_PX = 14;
/** Kompakt (küçük player) düzende seek bar üstü boşluk — dikey alan kıt, altyazı üst bara binmesin. */
const GAP_ABOVE_SEEKBAR_COMPACT_PX = 6;
/** Kontroller gizliyken en alt satırın video altından boşluğu — video yüksekliğinin %4'ü, en az bu kadar px. */
const BOTTOM_GAP_MIN_PX = 10;
const DRAG_TAP_THRESHOLD_PX = 3;
const STORAGE_KEY_ROW = 'hope-caption-row';
const STORAGE_KEY_SIZE = 'hope-caption-font-size';
const STORAGE_KEY_BG_COLOR = 'hope-caption-bg-color';
const STORAGE_KEY_TEXT_COLOR = 'hope-caption-text-color';

const FONT_SIZE_MULTIPLIER: Record<CaptionFontSize, number> = {
    small: 0.78,
    normal: 1,
    large: 1.35,
};

/** YouTube tarzı hazır renk paleti — her ikisi de ayarlar menüsünde swatch grid'i olarak gösteriliyor (bkz. SettingsMenu.renderCaptionColorPanel). İlk eleman her zaman varsayılan. */
const BG_COLOR_PRESETS = [
    'rgba(0, 0, 0, 0.75)',
    'rgba(0, 0, 0, 0)',
    'rgba(255, 255, 255, 0.85)',
    'rgba(183, 28, 28, 0.8)',
    'rgba(13, 71, 161, 0.8)',
    'rgba(27, 94, 32, 0.8)',
];
const TEXT_COLOR_PRESETS = ['#ffffff', '#000000', '#ffeb3b', '#ff5252', '#18ffff', '#69f0ae'];

interface CueWithHtml extends TextTrackCue {
    getCueAsHTML?(): DocumentFragment;
    text?: string;
}

function readStoredRow(): number {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY_ROW);
        const n = raw === null ? 0 : Number(raw);
        return Number.isFinite(n) && n >= 0 && n < ROWS ? n : 0;
    } catch {
        return 0;
    }
}

function readStoredFontSize(): CaptionFontSize {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY_SIZE);
        return raw === 'small' || raw === 'normal' || raw === 'large' ? raw : 'normal';
    } catch {
        return 'normal';
    }
}

function readStoredColor(key: string, presets: readonly string[]): string {
    const fallback = presets[0] ?? '';
    try {
        const raw = window.localStorage.getItem(key);
        return raw !== null && presets.includes(raw) ? raw : fallback;
    } catch {
        return fallback;
    }
}

/** Altyazıyı native render yerine kendi <div>'imizde çizer — YouTube tarzı sürükle-bırak, boyut/renk ayarları. */
export class CaptionRenderer {
    static readonly BG_COLOR_PRESETS: readonly string[] = BG_COLOR_PRESETS;
    static readonly TEXT_COLOR_PRESETS: readonly string[] = TEXT_COLOR_PRESETS;

    readonly layerEl: HTMLDivElement;
    private readonly bubbleEl: HTMLDivElement;
    private readonly videoArea: HTMLElement;
    private readonly seekBarEl: HTMLElement;
    private labels: HopeLocaleStrings;

    private activeTrack: TextTrack | null = null;
    private fontSize: CaptionFontSize = readStoredFontSize();
    private bgColor: string = readStoredColor(STORAGE_KEY_BG_COLOR, BG_COLOR_PRESETS);
    private textColor: string = readStoredColor(STORAGE_KEY_TEXT_COLOR, TEXT_COLOR_PRESETS);
    private rowIndex = readStoredRow();
    private dragging = false;
    /** Kontrol çubuğu görünür mü — görünürken altyazı seek bar'ın üstünde, değilken en altta. */
    private chromeVisible = true;
    private dragStartClientY = 0;
    private dragStartBottomPx = 0;
    private dragMoved = false;
    private rafId: number | null = null;
    private pendingDeltaPx = 0;
    private readonly resizeObserver: ResizeObserver;

    constructor(video: HTMLVideoElement, videoArea: HTMLElement, seekBarEl: HTMLElement, labels: HopeLocaleStrings) {
        void video;
        this.videoArea = videoArea;
        this.seekBarEl = seekBarEl;
        this.labels = labels;

        this.layerEl = document.createElement('div');
        this.layerEl.className = 'hp-caption-layer';
        this.layerEl.setAttribute('part', 'caption-layer');

        this.bubbleEl = document.createElement('div');
        this.bubbleEl.className = 'hp-caption-bubble';
        this.bubbleEl.setAttribute('part', 'caption-bubble');
        this.bubbleEl.setAttribute('role', 'note');
        this.bubbleEl.setAttribute('aria-label', labels.captionDragHandle);
        this.bubbleEl.tabIndex = -1;
        this.applyFontSizeVar();
        this.bubbleEl.style.setProperty('--hp-caption-bg', this.bgColor);
        this.bubbleEl.style.setProperty('--hp-caption-text', this.textColor);
        this.layerEl.appendChild(this.bubbleEl);

        this.bubbleEl.addEventListener('pointerdown', this.onPointerDown);

        this.resizeObserver = new ResizeObserver(() => this.recomputePosition());
        this.resizeObserver.observe(this.videoArea);

        this.recomputePosition();
    }

    /** `applyOptions()`'tan — hangi track aktif (ya da null = kapalı). */
    setActiveTrack(track: TextTrack | null): void {
        if (this.activeTrack) this.activeTrack.removeEventListener('cuechange', this.onCueChange);
        this.activeTrack = track;
        if (this.activeTrack) this.activeTrack.addEventListener('cuechange', this.onCueChange);
        this.onCueChange();
    }

    getFontSize(): CaptionFontSize {
        return this.fontSize;
    }

    setFontSize(size: CaptionFontSize): void {
        this.fontSize = size;
        this.applyFontSizeVar();
        // Boyut büyüyünce balon da büyür — en üst satırdaysa `bounds()`'un
        // tepe boşluğu (bkz. aşağıdaki not) YENİ yüksekliğe göre yeniden
        // hesaplanmazsa balon video'nun tepesinden TAŞABİLİRDİ.
        this.recomputePosition();
        try {
            window.localStorage.setItem(STORAGE_KEY_SIZE, size);
        } catch {
            /* gizli mod vb. — sessizce yoksay */
        }
    }

    getBgColor(): string {
        return this.bgColor;
    }

    setBgColor(color: string): void {
        this.bgColor = color;
        this.bubbleEl.style.setProperty('--hp-caption-bg', color);
        try {
            window.localStorage.setItem(STORAGE_KEY_BG_COLOR, color);
        } catch {
            /* gizli mod vb. — sessizce yoksay */
        }
    }

    getTextColor(): string {
        return this.textColor;
    }

    setTextColor(color: string): void {
        this.textColor = color;
        this.bubbleEl.style.setProperty('--hp-caption-text', color);
        try {
            window.localStorage.setItem(STORAGE_KEY_TEXT_COLOR, color);
        } catch {
            /* gizli mod vb. — sessizce yoksay */
        }
    }

    /** Ayarlar menüsündeki "Konumu sıfırla". */
    resetPosition(): void {
        this.setRowIndex(0, true);
    }

    /** Dil sonradan değişince aria-label'ı tazeler. */
    refreshLabels(labels: HopeLocaleStrings): void {
        this.labels = labels;
        this.bubbleEl.setAttribute('aria-label', labels.captionDragHandle);
    }

    private applyFontSizeVar(): void {
        this.bubbleEl.style.setProperty('--hp-caption-size-multiplier', String(FONT_SIZE_MULTIPLIER[this.fontSize]));
    }

    private readonly onCueChange = (): void => {
        const cues = this.activeTrack?.activeCues;
        if (!this.activeTrack || !cues || cues.length === 0) {
            this.bubbleEl.classList.remove('hp-caption-visible');
            this.bubbleEl.textContent = '';
            return;
        }
        this.bubbleEl.textContent = '';
        for (let i = 0; i < cues.length; i++) {
            if (i > 0) this.bubbleEl.appendChild(document.createElement('br'));
            const cue = cues[i] as CueWithHtml;
            if (typeof cue.getCueAsHTML === 'function') {
                this.bubbleEl.appendChild(cue.getCueAsHTML());
            } else {
                this.bubbleEl.appendChild(document.createTextNode(cue.text ?? ''));
            }
        }
        this.bubbleEl.classList.add('hp-caption-visible');
    };

    private bounds(): { min: number; max: number } {
        const areaRect = this.videoArea.getBoundingClientRect();
        const seekRect = this.seekBarEl.getBoundingClientRect();
        // Tepe boşluğu balonun kendi yüksekliği + sabit boşluk.
        const bubbleHeight = this.bubbleEl.getBoundingClientRect().height || 32;
        const topMargin = bubbleHeight + TOP_GAP_PX;
        // Kontroller görünürken seek bar'ın üstü, gizliyken (ya da seek bar gizliyse) videonun en altı.
        const bottomGap = Math.max(BOTTOM_GAP_MIN_PX, Math.round(areaRect.height * 0.04));
        const min =
            this.chromeVisible && seekRect.height > 0
                ? Math.max(0, Math.round(areaRect.bottom - seekRect.top + (this.videoArea.hasAttribute('data-compact') ? GAP_ABOVE_SEEKBAR_COMPACT_PX : GAP_ABOVE_SEEKBAR_PX)))
                : bottomGap;
        const max = Math.max(min, Math.round(areaRect.height - topMargin));
        return { min, max };
    }

    private pxForRow(rowIndex: number): number {
        const { min, max } = this.bounds();
        if (ROWS <= 1) return min;
        const ratio = rowIndex / (ROWS - 1);
        return Math.round(min + ratio * (max - min));
    }

    /** FLIP: bottom anında yazılır, yalnızca transform animasyonlanır — bottom'u animasyonlamak bırakınca zıplatıyordu. */
    private setRowIndex(rowIndex: number, animate: boolean, fromPx?: number): void {
        this.rowIndex = Math.min(ROWS - 1, Math.max(0, rowIndex));
        const targetPx = this.pxForRow(this.rowIndex);
        const prevPx = fromPx ?? parseFloat(this.bubbleEl.style.bottom || `${targetPx}`);

        if (animate && prevPx !== targetPx) {
            this.bubbleEl.classList.add('hp-caption-no-transition');
            this.bubbleEl.style.bottom = `${targetPx}px`;
            this.bubbleEl.style.transform = `translateX(-50%) translateY(${prevPx - targetPx}px)`;
            void this.bubbleEl.offsetHeight; // reflow'u zorla — sıradaki transform değişikliği animasyonlansın
            this.bubbleEl.classList.remove('hp-caption-no-transition');
            this.bubbleEl.style.transform = 'translateX(-50%)';
        } else {
            this.bubbleEl.style.transform = 'translateX(-50%)';
            this.bubbleEl.style.bottom = `${targetPx}px`;
        }

        try {
            window.localStorage.setItem(STORAGE_KEY_ROW, String(this.rowIndex));
        } catch {
            /* gizli mod vb. — sessizce yoksay */
        }
    }

    /** Boyut değişimi (ör. fullscreen'e giriş) sonrası AYNI satıra, YENİ sınırlara göre yeniden konumlan — animasyonsuz (boyut değişimi anlık olmalı). */
    /** HopePlayerElement.setChromeOpacity'den — kontroller açılıp kapanınca balon yumuşakça yukarı/aşağı kayar (satır korunur). */
    setChromeVisible(visible: boolean): void {
        if (visible === this.chromeVisible) return;
        this.chromeVisible = visible;
        if (!this.dragging) this.setRowIndex(this.rowIndex, true);
    }

    recomputePosition(): void {
        if (this.dragging) return;
        this.setRowIndex(this.rowIndex, false);
    }

    private readonly onPointerDown = (e: PointerEvent): void => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        this.dragging = true;
        this.dragMoved = false;
        this.dragStartClientY = e.clientY;
        this.dragStartBottomPx = this.pxForRow(this.rowIndex);
        this.bubbleEl.setPointerCapture(e.pointerId);
        this.bubbleEl.classList.add('hp-caption-dragging');
        this.bubbleEl.addEventListener('pointermove', this.onPointerMove);
        this.bubbleEl.addEventListener('pointerup', this.onPointerUp);
        this.bubbleEl.addEventListener('pointercancel', this.onPointerUp);
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        if (!this.dragging) return;
        this.pendingDeltaPx = e.clientY - this.dragStartClientY;
        if (Math.abs(this.pendingDeltaPx) > DRAG_TAP_THRESHOLD_PX) this.dragMoved = true;
        if (this.rafId === null) this.rafId = requestAnimationFrame(this.applyPendingDrag);
    };

    private readonly applyPendingDrag = (): void => {
        this.rafId = null;
        if (!this.dragging) return;
        const { min, max } = this.bounds();
        // Aşağı sürüklemek (deltaPx pozitif) effective bottom'u AZALTMALI.
        const targetBottom = Math.min(max, Math.max(min, this.dragStartBottomPx - this.pendingDeltaPx));
        const translatePx = this.dragStartBottomPx - targetBottom;
        this.bubbleEl.style.transform = `translateX(-50%) translateY(${translatePx}px)`;
    };

    private readonly onPointerUp = (e: PointerEvent): void => {
        if (!this.dragging) return;
        this.dragging = false;
        this.bubbleEl.releasePointerCapture(e.pointerId);
        this.bubbleEl.removeEventListener('pointermove', this.onPointerMove);
        this.bubbleEl.removeEventListener('pointerup', this.onPointerUp);
        this.bubbleEl.removeEventListener('pointercancel', this.onPointerUp);
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.bubbleEl.classList.remove('hp-caption-dragging');
        if (!this.dragMoved) return;
        const { min, max } = this.bounds();
        const finalBottom = Math.min(max, Math.max(min, this.dragStartBottomPx - this.pendingDeltaPx));
        const ratio = max > min ? (finalBottom - min) / (max - min) : 0;
        const snappedIndex = Math.round(ratio * (ROWS - 1));
        this.setRowIndex(snappedIndex, true, finalBottom);
    };

    destroy(): void {
        if (this.activeTrack) this.activeTrack.removeEventListener('cuechange', this.onCueChange);
        this.resizeObserver.disconnect();
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.bubbleEl.removeEventListener('pointerdown', this.onPointerDown);
    }
}
