/**
 * Tema uyumlu hover tooltip — tek delegasyon dinleyicisi; aria-label'lı her button/slider için otomatik.
 * Kısayol pill'i data-shortcut'tan. Yalnızca hover yapabilen cihazlarda.
 */
const SHOW_DELAY_MS = 450;
const HIDE_DELAY_MS = 60;
const GAP_PX = 8;
const EDGE_PADDING_PX = 6;
/** Bu selector'a uyan ama tooltip İSTEMEYEN elementler (ör. seek bar — sürekli üzerinde gezinilen bir kontrol, tooltip rahatsız eder). */
const EXCLUDE_PARTS = new Set(['seek-bar', 'time-display']);

/** Birincil giriş hover yapabiliyor mu (fare/trackpad) — dokunmatik telefon/tablette false. */
function canHover(): boolean {
    return typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover)').matches;
}

export class TooltipController {
    private readonly el: HTMLDivElement;
    private readonly labelEl: HTMLSpanElement;
    private readonly keyEl: HTMLSpanElement;
    private showTimer: ReturnType<typeof setTimeout> | null = null;
    private hideTimer: ReturnType<typeof setTimeout> | null = null;
    private currentTarget: HTMLElement | null = null;
    private isOccluded: ((rect: DOMRect) => boolean) | null = null;
    /** Gösterim gecikmesi (SHOW_DELAY_MS) içinde bekleyen hedef — `currentTarget` yalnızca gerçekten gösterilince set ediliyor. */
    private pendingTarget: HTMLElement | null = null;

    constructor(private readonly mountEl: HTMLElement) {
        this.el = document.createElement('div');
        this.el.setAttribute('part', 'tooltip');
        this.el.setAttribute('role', 'tooltip');
        this.el.className =
            'hp-tooltip hp:absolute hp:z-40 hp:flex hp:items-center hp:gap-1.5 hp:px-2 hp:py-1 hp:rounded hp:text-xs ' +
            'hp:whitespace-nowrap hp:pointer-events-none hp:opacity-0 hp:transition-opacity hp:duration-100';
        this.el.style.visibility = 'hidden';

        this.labelEl = document.createElement('span');
        this.el.appendChild(this.labelEl);

        this.keyEl = document.createElement('span');
        this.keyEl.className = 'hp-tooltip-key';
        this.el.appendChild(this.keyEl);

        mountEl.appendChild(this.el);

        mountEl.addEventListener('mouseover', this.onMouseOver);
        mountEl.addEventListener('mouseout', this.onMouseOut);
        mountEl.addEventListener('focusin', this.onFocusIn);
        mountEl.addEventListener('focusout', this.onFocusOut);
        mountEl.addEventListener('pointerdown', this.hideNow);
    }

    destroy(): void {
        if (this.showTimer) clearTimeout(this.showTimer);
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.mountEl.removeEventListener('mouseover', this.onMouseOver);
        this.mountEl.removeEventListener('mouseout', this.onMouseOut);
        this.mountEl.removeEventListener('focusin', this.onFocusIn);
        this.mountEl.removeEventListener('focusout', this.onFocusOut);
        this.mountEl.removeEventListener('pointerdown', this.hideNow);
        this.el.remove();
    }

    /**
     * Tooltip'i örten bir katman (ör. açık ayarlar menüsü) varsa çakışan tooltip gösterilmez — menü kontrol katmanının
     * (z-20) içinde olduğundan tooltip'i z-index ile menünün altına almak mümkün değil.
     */
    setOcclusionCheck(check: ((rect: DOMRect) => boolean) | null): void {
        this.isOccluded = check;
        this.recheckOcclusion();
    }

    /** Örten katman açıldı/kapandı — görünen tooltip artık çakışıyorsa gizle. */
    recheckOcclusion(): void {
        if (this.currentTarget && this.el.style.visibility === 'visible' && this.isOccluded?.(this.el.getBoundingClientRect())) this.hideNow();
    }

    private matchTarget(fromEl: EventTarget | null): HTMLElement | null {
        const el = fromEl as HTMLElement | null;
        const target = el?.closest?.('button[aria-label], [role="slider"][aria-label]') as HTMLElement | null;
        if (!target) return null;
        const part = target.getAttribute('part');
        if (part && EXCLUDE_PARTS.has(part)) return null;
        // Görünür değilse (ör. display:none pip butonu, kapalı bir panel) ölç/konumlandırma anlamsız.
        if (target.offsetParent === null && target !== document.activeElement) return null;
        return target;
    }

    private readonly onMouseOver = (e: MouseEvent): void => {
        const target = this.matchTarget(e.target);
        if (!target || target === this.currentTarget) return;
        this.scheduleShow(target);
    };

    private readonly onMouseOut = (e: MouseEvent): void => {
        const target = this.matchTarget(e.target);
        // Gecikme içinde çıkılırsa bekleyen gösterimi de iptal et — currentTarget yalnızca gösterimden sonra set ediliyor.
        if (!target || (target !== this.currentTarget && target !== this.pendingTarget)) return;
        const related = e.relatedTarget as Node | null;
        if (related && target.contains(related)) return;
        this.scheduleHide();
    };

    private readonly onFocusIn = (e: FocusEvent): void => {
        const target = this.matchTarget(e.target);
        if (!target) return;
        this.show(target);
    };

    private readonly onFocusOut = (e: FocusEvent): void => {
        const target = this.matchTarget(e.target);
        if (!target || target !== this.currentTarget) return;
        this.hideNow();
    };

    private scheduleShow(target: HTMLElement): void {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        if (this.showTimer) clearTimeout(this.showTimer);
        this.pendingTarget = target;
        this.showTimer = setTimeout(() => {
            this.showTimer = null;
            this.pendingTarget = null;
            this.show(target);
        }, SHOW_DELAY_MS);
    }

    private scheduleHide(): void {
        if (this.showTimer) {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        }
        this.pendingTarget = null;
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => this.hideNow(), HIDE_DELAY_MS);
    }

    private readonly hideNow = (): void => {
        if (this.showTimer) {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        }
        this.pendingTarget = null;
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        if (!this.currentTarget) return;
        this.currentTarget = null;
        this.el.style.opacity = '0';
        this.el.style.visibility = 'hidden';
    };

    private show(target: HTMLElement): void {
        // Dokunmatikte (hover yeteneği yok) gösterme — butona dokunmak hem
        // mouseover hem focusin tetikliyor, tooltip boşuna açılıyordu (istek
        // üzerine: "mobilde buton tooltiplerini gizle").
        if (!canHover()) return;
        const label = target.getAttribute('aria-label');
        if (!label) return;
        this.currentTarget = target;

        this.labelEl.textContent = label;
        const shortcut = target.dataset.shortcut;
        if (shortcut) {
            this.keyEl.textContent = shortcut;
            this.keyEl.style.display = '';
        } else {
            this.keyEl.textContent = '';
            this.keyEl.style.display = 'none';
        }

        // Ölçülebilmesi için önce (görünmez ama layout'ta) render ediliyor.
        this.el.style.visibility = 'hidden';
        this.el.style.opacity = '0';
        this.el.style.left = '0px';
        this.el.style.top = '0px';

        requestAnimationFrame(() => {
            if (this.currentTarget !== target) return;
            this.position(target);
            if (this.isOccluded?.(this.el.getBoundingClientRect())) return;
            this.el.style.visibility = 'visible';
            this.el.style.opacity = '1';
        });
    }

    private position(target: HTMLElement): void {
        const mountRect = this.mountEl.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const ttRect = this.el.getBoundingClientRect();

        let top = targetRect.top - mountRect.top - ttRect.height - GAP_PX;
        if (top < EDGE_PADDING_PX) {
            top = targetRect.bottom - mountRect.top + GAP_PX;
        }

        let left = targetRect.left - mountRect.left + targetRect.width / 2 - ttRect.width / 2;
        const maxLeft = mountRect.width - ttRect.width - EDGE_PADDING_PX;
        left = Math.max(EDGE_PADDING_PX, Math.min(left, maxLeft));

        this.el.style.top = `${top}px`;
        this.el.style.left = `${left}px`;
    }
}
