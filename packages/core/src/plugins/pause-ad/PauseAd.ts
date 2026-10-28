import type { PauseAdOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { loadGpt, type GoogleTag, type GptSlot, type GptSlotRenderEndedEvent } from './loadGpt';

export interface PauseAdPlayerContext {
    videoEl: HTMLVideoElement;
    /** Light DOM sahibi (GPT reklam div'ini bulabilsin diye slot'lu div buraya eklenir) + hp:pausead olayları. */
    hostEl: HTMLElement;
    videoArea: HTMLElement;
    i18n: HopeLocaleStrings;
    /** IMA reklamı oynuyor ya da giriş ekranı (countdown/geo) açık — bu sırada gösterilmez. */
    isBlocked(): boolean;
}

const DEFAULT_SIZES: Array<[number, number]> = [
    [300, 250],
    [336, 280],
    [250, 250],
    [200, 200],
];
const PANEL_PADDING_X = 16;
/** Başlık + "Videoya devam et" satırı + boşluklar (px) — dikey sığma hesabı için. */
const PANEL_CHROME_Y = 104;
const SLOT_NAME = 'hp-pause-ad';
/** tailwind.css'teki sıkışma geçişiyle (380ms) aynı + küçük pay. */
const SHIFT_TRANSITION_MS = 420;
let instanceCount = 0;

/**
 * Pause reklamı: video duraklatılınca Google display reklamı (GPT) istenir; dolarsa video sola animasyonla
 * sıkışır (cover — dış kenarlar kırpılır), sağdan reklam paneli kayar. Boş dönerse hiçbir şey açılmaz.
 * GPT reklamı document.getElementById ile bulur — Shadow DOM'u göremez; bu yüzden reklam div'i host'un light
 * DOM çocuğu olarak oluşturulup paneldeki <slot>'a yansıtılır.
 */
export class PauseAd {
    private readonly panel: HTMLDivElement;
    private readonly adHost: HTMLDivElement;
    private readonly labelEl: HTMLSpanElement;
    private readonly closeBtn: HTMLButtonElement;
    private readonly resumeBtn: HTMLButtonElement;
    private readonly divId: string;
    private googletag: GoogleTag | null = null;
    private slot: GptSlot | null = null;
    private slotSizesKey = '';
    private lastFetchAt = 0;
    private lastFilled = false;
    private waitingForRender = false;
    private delayTimer: ReturnType<typeof setTimeout> | null = null;
    private coverTimer: ReturnType<typeof setTimeout> | null = null;
    private open = false;
    private destroyed = false;

    constructor(
        private readonly ctx: PauseAdPlayerContext,
        private readonly options: PauseAdOptions
    ) {
        this.divId = `hp-pause-ad-${++instanceCount}`;

        this.panel = document.createElement('div');
        this.panel.className = 'hp-pause-ad';
        this.panel.setAttribute('part', 'pause-ad');
        this.panel.setAttribute('aria-hidden', 'true');

        const header = document.createElement('div');
        header.className = 'hp-pause-ad-header';
        this.labelEl = document.createElement('span');
        this.labelEl.className = 'hp-pause-ad-label';
        this.closeBtn = document.createElement('button');
        this.closeBtn.type = 'button';
        this.closeBtn.className = 'hp-pause-ad-close';
        this.closeBtn.innerHTML =
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        this.closeBtn.addEventListener('click', () => this.hide('closed'));
        header.append(this.labelEl, this.closeBtn);

        const body = document.createElement('div');
        body.className = 'hp-pause-ad-body';
        const slotEl = document.createElement('slot');
        slotEl.name = SLOT_NAME;
        body.appendChild(slotEl);

        this.resumeBtn = document.createElement('button');
        this.resumeBtn.type = 'button';
        this.resumeBtn.className = 'hp-pause-ad-resume';
        this.resumeBtn.addEventListener('click', () => void this.ctx.videoEl.play());
        if (options.showResumeButton === false) this.resumeBtn.style.display = 'none';

        this.panel.append(header, body, this.resumeBtn);
        // Videoya dokunma/tıklama (oynat/duraklat) panelden tetiklenmesin.
        this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.panel.addEventListener('click', (e) => e.stopPropagation());
        ctx.videoArea.appendChild(this.panel);
        ctx.videoArea.setAttribute('data-pause-ad-ready', '');

        // Light DOM reklam kapsayıcısı — GPT bunu id ile bulur; görüntüsü paneldeki slot'ta.
        this.adHost = document.createElement('div');
        this.adHost.slot = SLOT_NAME;
        this.adHost.id = this.divId;
        ctx.hostEl.appendChild(this.adHost);

        this.refreshLabels();
        ctx.videoEl.addEventListener('pause', this.onPause);
        ctx.videoEl.addEventListener('play', this.onPlay);
    }

    refreshLabels(): void {
        this.labelEl.textContent = this.options.label ?? this.ctx.i18n.pauseAdLabel;
        this.closeBtn.setAttribute('aria-label', this.ctx.i18n.pauseAdClose);
        this.resumeBtn.textContent = this.ctx.i18n.pauseAdResume;
    }

    destroy(): void {
        this.destroyed = true;
        if (this.delayTimer) clearTimeout(this.delayTimer);
        this.ctx.videoEl.removeEventListener('pause', this.onPause);
        this.ctx.videoEl.removeEventListener('play', this.onPlay);
        this.googletag?.pubads().removeEventListener?.('slotRenderEnded', this.onRenderEnded);
        if (this.slot) this.googletag?.destroySlots([this.slot]);
        this.setShift(0);
        if (this.coverTimer) clearTimeout(this.coverTimer);
        this.ctx.videoArea.removeAttribute('data-pause-ad');
        this.ctx.videoArea.removeAttribute('data-pause-ad-ready');
        this.panel.remove();
        this.adHost.remove();
    }

    // ── olaylar ──

    private readonly onPause = (): void => {
        if (this.delayTimer) clearTimeout(this.delayTimer);
        this.delayTimer = setTimeout(() => void this.request(), this.options.delayMs ?? 300);
    };

    private readonly onPlay = (): void => {
        if (this.delayTimer) clearTimeout(this.delayTimer);
        this.waitingForRender = false;
        this.hide('resumed');
    };

    // ── istek / gösterim ──

    /** Alana sığan reklam boyutları (genişlik oranı + dikey alan) — hiçbiri sığmazsa gösterilmez. */
    private fittingSizes(): Array<[number, number]> {
        const area = this.ctx.videoArea.getBoundingClientRect();
        if (area.width < (this.options.minPlayerWidth ?? 640)) return [];
        const maxW = area.width * (this.options.maxWidthRatio ?? 0.5) - PANEL_PADDING_X * 2;
        const maxH = area.height - PANEL_CHROME_Y;
        return (this.options.sizes ?? DEFAULT_SIZES).filter(([w, h]) => w <= maxW && h <= maxH);
    }

    private async request(): Promise<void> {
        const v = this.ctx.videoEl;
        if (this.destroyed || !v.paused || v.ended || v.seeking || this.ctx.isBlocked()) return;
        const sizes = this.fittingSizes();
        if (!sizes.length) return;

        // Panel genişliği: sığan en geniş reklam + iç boşluk.
        const panelW = Math.max(...sizes.map(([w]) => w)) + PANEL_PADDING_X * 2;
        this.panel.style.setProperty('--hp-pause-ad-panel-w', `${panelW}px`);

        const refreshMs = (this.options.refreshIntervalSec ?? 30) * 1000;
        const sizesKey = JSON.stringify(sizes);
        // Yakın zamanda doldurulmuş ve boyutlar aynı → yeni istek atmadan mevcut reklamı göster.
        if (this.slot && this.lastFilled && sizesKey === this.slotSizesKey && Date.now() - this.lastFetchAt < refreshMs) {
            this.show(panelW);
            return;
        }

        try {
            this.googletag = this.googletag ?? (await loadGpt());
        } catch (err) {
            console.warn('[HopePlayer pause-ad]', err);
            return;
        }
        if (this.destroyed || !v.paused) return;
        const gt = this.googletag;
        this.waitingForRender = true;
        gt.cmd.push(() => {
            if (this.destroyed) return;
            if (!this.slot || sizesKey !== this.slotSizesKey) {
                if (this.slot) gt.destroySlots([this.slot]);
                this.slot = gt.defineSlot(this.options.adUnitPath, sizes, this.divId);
                if (!this.slot) return;
                this.slot.addService(gt.pubads());
                for (const [k, val] of Object.entries(this.options.targeting ?? {})) this.slot.setTargeting(k, val);
                this.slotSizesKey = sizesKey;
                gt.pubads().addEventListener('slotRenderEnded', this.onRenderEnded);
                gt.enableServices();
                gt.display(this.divId);
                // Sayfa disableInitialLoad kullanıyorsa display istek atmaz — elle refresh.
                if (gt.pubads().isInitialLoadDisabled()) gt.pubads().refresh([this.slot]);
            } else {
                gt.pubads().refresh([this.slot]);
            }
            this.lastFetchAt = Date.now();
        });
    }

    private readonly onRenderEnded = (e: GptSlotRenderEndedEvent): void => {
        if (e.slot !== this.slot) return;
        this.lastFilled = !e.isEmpty;
        const wasWaiting = this.waitingForRender;
        this.waitingForRender = false;
        if (e.isEmpty) {
            this.emit('empty');
            return;
        }
        // İstek sürerken kullanıcı oynattıysa açma.
        if (!wasWaiting || !this.ctx.videoEl.paused || this.ctx.isBlocked()) return;
        const width = Array.isArray(e.size) && typeof e.size[0] === 'number' ? e.size[0] : null;
        this.show(width ? width + PANEL_PADDING_X * 2 : undefined, e.size as [number, number] | undefined);
    };

    private show(panelW?: number, size?: [number, number]): void {
        if (panelW) this.panel.style.setProperty('--hp-pause-ad-panel-w', `${panelW}px`);
        const w = parseFloat(this.panel.style.getPropertyValue('--hp-pause-ad-panel-w')) || 332;
        this.open = true;
        this.panel.setAttribute('data-open', '');
        this.panel.setAttribute('aria-hidden', 'false');
        this.setShift(w);
        this.emit('shown', size);
    }

    private hide(reason: 'closed' | 'resumed'): void {
        if (!this.open) return;
        this.open = false;
        this.panel.removeAttribute('data-open');
        this.panel.setAttribute('aria-hidden', 'true');
        this.setShift(0);
        this.emit('hidden', undefined, reason);
    }

    /** Video ve kontrolleri panel genişliği kadar sola sıkıştırır (tailwind.css `.video-area[data-pause-ad]`). */
    private setShift(px: number): void {
        const area = this.ctx.videoArea;
        if (this.coverTimer) clearTimeout(this.coverTimer);
        this.coverTimer = null;
        area.style.setProperty('--hp-pause-ad-w', `${px}px`);
        if (px > 0) {
            area.setAttribute('data-pause-ad', '');
        } else if (area.hasAttribute('data-pause-ad')) {
            // cover, genişleme animasyonu bitene kadar kalır — hemen contain'e dönmek kapanışta görüntüyü sıçratıyordu.
            this.coverTimer = setTimeout(() => {
                this.coverTimer = null;
                area.removeAttribute('data-pause-ad');
            }, SHIFT_TRANSITION_MS);
        }
    }

    private emit(state: 'shown' | 'hidden' | 'empty', size?: [number, number], reason?: 'closed' | 'resumed'): void {
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:pausead', { detail: { state, size, reason } }));
    }
}
