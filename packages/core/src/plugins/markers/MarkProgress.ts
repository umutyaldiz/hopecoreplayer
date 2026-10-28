import { createIcon } from '../../icons/Icon';
import type { MarkerItem, MarkerPingOptions, MarkerPopupOptions, MarkersOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface MarkersPlayerContext {
    videoEl: HTMLVideoElement;
    /** Popup overlay'in ekleneceği katman (shadow root içinde, video üzerinde). */
    overlayContainerEl: HTMLElement;
    /** Seek bar üzerinde işaretçi çizmek için — SeekBar.addMarker ile aynı imza. */
    addSeekBarMarker(ratio: number, extraClass?: string): HTMLDivElement;
    i18n: HopeLocaleStrings;
}

interface NormalizedMarker extends Required<Pick<MarkerItem, 'time'>> {
    idx: number;
    color?: string;
    label: string;
    pauseOnHit: boolean;
    once: boolean;
    tolerance: number;
    cooldownMs: number;
    action?: MarkerItem['action'];
    popup: MarkerPopupOptions | null;
    pingUrl: string;
    el?: HTMLElement;
}

const POPUP_DEFAULTS: Required<MarkerPopupOptions> = {
    enabled: false,
    mode: 'rich',
    text: '',
    imageUrl: '',
    imageAlt: '',
    linkUrl: '',
    // Boş bırakılıyor (sentinel) — gerçek varsayılan metin showPopup()'ta
    // `ctx.i18n.markerLearnMore`/`markerContinue`'dan okunuyor, dil
    // değişimini takip edebilsin diye burada SABİT bir dilde gömülü değil.
    linkText: '',
    continueText: '',
    showContinue: true,
    showClose: true,
    autoplayOnClose: true,
    autoplayOnContinue: true,
};

const PING_DEFAULTS: Required<MarkerPingOptions> = { enabled: false, url: '', method: 'GET', includeMarker: false };

/** Zaman tabanlı seek bar işaretçileri — seek/jump koruması, once/cooldown, popup/ping/aksiyon. */
export class MarkProgress {
    private readonly markers: NormalizedMarker[];
    private readonly popupGlobal: Required<MarkerPopupOptions>;
    private readonly pingGlobal: Required<MarkerPingOptions>;
    private readonly triggerOnSeek: boolean;
    private readonly seekJumpThresholdSec: number;
    private readonly seekIgnoreWindowMs: number;

    private hitSet = new Set<string>();
    private lastHitAt = new Map<string, number>();
    private lastTime = 0;
    private isSeeking = false;
    private ignoreUntilTs = 0;
    private popupEl: HTMLElement | null = null;

    constructor(
        private readonly ctx: MarkersPlayerContext,
        options: MarkersOptions
    ) {
        this.triggerOnSeek = options.triggerOnSeek === true;
        this.seekJumpThresholdSec = options.seekJumpThresholdSec ?? 1;
        this.seekIgnoreWindowMs = options.seekIgnoreWindowMs ?? 250;
        this.popupGlobal = { ...POPUP_DEFAULTS, ...options.popup };
        this.pingGlobal = { ...PING_DEFAULTS, ...options.ping };

        this.markers = (options.items || [])
            .map((m, idx) => this.normalize(m, idx))
            .filter((m) => Number.isFinite(m.time) && m.time >= 0)
            .sort((a, b) => a.time - b.time);

        ctx.videoEl.addEventListener('loadedmetadata', this.onLoadedMetadata);
        ctx.videoEl.addEventListener('timeupdate', this.onTimeUpdate);
        ctx.videoEl.addEventListener('seeking', this.onSeeking);
        ctx.videoEl.addEventListener('seeked', this.onSeeked);

        if (ctx.videoEl.readyState >= 1) this.onLoadedMetadata();
    }

    /** Popup lazy oluşturulup yeniden kullanılıyor (`ensurePopup`) — zaten açıksa close butonunun statik etiketini tazeler. */
    refreshLabels(): void {
        const closeBtn = this.popupEl?.querySelector('button') as HTMLButtonElement | null;
        if (closeBtn) {
            closeBtn.setAttribute('aria-label', this.ctx.i18n.close);
        }
    }

    destroy(): void {
        this.ctx.videoEl.removeEventListener('loadedmetadata', this.onLoadedMetadata);
        this.ctx.videoEl.removeEventListener('timeupdate', this.onTimeUpdate);
        this.ctx.videoEl.removeEventListener('seeking', this.onSeeking);
        this.ctx.videoEl.removeEventListener('seeked', this.onSeeked);
        this.markers.forEach((m) => m.el?.remove());
        this.popupEl?.remove();
        this.popupEl = null;
        this.hitSet.clear();
        this.lastHitAt.clear();
    }

    private normalize(m: MarkerItem, idx: number): NormalizedMarker {
        return {
            idx,
            time: Number(m.time),
            color: m.color,
            label: m.label ?? '',
            pauseOnHit: m.pauseOnHit ?? true,
            once: m.once ?? true,
            tolerance: m.tolerance ?? 0.25,
            cooldownMs: m.cooldownMs ?? 600,
            action: m.action,
            popup: m.popup ?? null,
            pingUrl: m.pingUrl ?? '',
        };
    }

    private readonly onLoadedMetadata = (): void => {
        const duration = this.ctx.videoEl.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;

        this.markers.forEach((m) => {
            if (m.el) return;
            const el = this.ctx.addSeekBarMarker(m.time / duration);
            if (m.color) el.style.backgroundColor = m.color;
            if (m.label) el.title = m.label;
            m.el = el;
        });

        this.lastTime = this.ctx.videoEl.currentTime || 0;
    };

    private readonly onSeeking = (): void => {
        this.isSeeking = true;
        this.ignoreUntilTs = Date.now() + this.seekIgnoreWindowMs;
        this.lastTime = this.ctx.videoEl.currentTime || 0;
    };

    private readonly onSeeked = (): void => {
        this.lastTime = this.ctx.videoEl.currentTime || 0;
        this.isSeeking = false;
        this.ignoreUntilTs = Date.now() + this.seekIgnoreWindowMs;
    };

    private readonly onTimeUpdate = (): void => {
        const now = Date.now();
        if (now < this.ignoreUntilTs) return;
        if (this.isSeeking) return;

        const t = this.ctx.videoEl.currentTime;
        if (!Number.isFinite(t)) return;

        const jumped = Math.abs(t - this.lastTime) >= this.seekJumpThresholdSec;
        if (jumped && !this.triggerOnSeek) {
            this.lastTime = t;
            return;
        }

        for (const m of this.markers) {
            const key = `${m.time}-${m.idx}`;
            if (m.once && this.hitSet.has(key)) continue;
            if (!m.once) {
                const last = this.lastHitAt.get(key) || 0;
                if (now - last < m.cooldownMs) continue;
            }

            const crossed = this.lastTime < m.time && t >= m.time - m.tolerance;
            if (!crossed) continue;

            if (m.once) this.hitSet.add(key);
            else this.lastHitAt.set(key, now);

            if (m.pauseOnHit) this.ctx.videoEl.pause();

            this.firePing(m);
            this.fireAction(m);

            const popupCfg = m.popup ? { ...this.popupGlobal, ...m.popup } : this.popupGlobal;
            if (popupCfg.enabled) {
                this.ctx.videoEl.pause();
                this.showPopup(popupCfg);
            }
            break;
        }

        this.lastTime = t;
    };

    private resolveUrlTemplate(url: string, m: NormalizedMarker): string {
        if (!url) return '';
        return url.replaceAll('{time}', encodeURIComponent(String(m.time))).replaceAll('{label}', encodeURIComponent(m.label));
    }

    private firePing(m: NormalizedMarker): void {
        const baseUrl = m.pingUrl || this.pingGlobal.url;
        const url = this.resolveUrlTemplate(baseUrl, m);
        if (!this.pingGlobal.enabled || !url) return;

        try {
            if (this.pingGlobal.method === 'POST') {
                fetch(url, {
                    method: 'POST',
                    keepalive: true,
                    headers: this.pingGlobal.includeMarker ? { 'Content-Type': 'application/json' } : undefined,
                    body: this.pingGlobal.includeMarker ? JSON.stringify({ time: m.time, label: m.label, ts: Date.now() }) : undefined,
                }).catch(() => {});
            } else {
                fetch(url, { method: 'GET', keepalive: true }).catch(() => {});
            }
        } catch {
            /* no-op */
        }
    }

    private fireAction(m: NormalizedMarker): void {
        const a = m.action;
        if (!a) return;

        if (a.type === 'log') {
            console.log('[HopePlayer markers]', a.name || 'marker_hit', { time: m.time, label: m.label }, a.payload);
            return;
        }

        if (a.type === 'datalayer') {
            try {
                const w = window as unknown as { dataLayer?: unknown[] };
                w.dataLayer = w.dataLayer || [];
                w.dataLayer.push({
                    event: 'HopePlayerVideoEvents',
                    trigger: a.name || 'marker_hit',
                    marker: { time: m.time, label: m.label, color: m.color },
                    payload: a.payload ?? {},
                    ts: Date.now(),
                });
            } catch {
                /* no-op */
            }
            return;
        }

        if (a.type === 'custom') {
            const fn = a.name ? (window as unknown as Record<string, unknown>)[a.name] : null;
            if (typeof fn === 'function') {
                try {
                    (fn as (ctx: unknown) => void)({ marker: m, payload: a.payload });
                } catch (err) {
                    console.warn('[HopePlayer markers] custom action fonksiyonu hata verdi:', err);
                }
            } else {
                console.warn('[HopePlayer markers] custom action fonksiyonu bulunamadı: window.' + a.name);
            }
        }
    }

    private ensurePopup(): HTMLElement {
        if (this.popupEl) return this.popupEl;

        const overlay = document.createElement('div');
        overlay.setAttribute('part', 'marker-popup');
        overlay.className = 'hp:hidden hp:absolute hp:inset-0 hp:z-30 hp:items-center hp:justify-center hp:bg-black/70';

        const panel = document.createElement('div');
        panel.className = 'hp:relative hp:max-w-[85%] hp:bg-surface-elev hp:text-on-surface hp:rounded-lg hp:p-4 hp:text-center hp:shadow-xl';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', this.ctx.i18n.close);
        closeBtn.className = 'hp:absolute hp:top-1 hp:right-1 hp:w-6 hp:h-6 hp:flex hp:items-center hp:justify-center hp:bg-transparent hp:border-0 hp:cursor-pointer hp:text-on-surface';
        closeBtn.appendChild(createIcon('close', 'hp:text-sm'));

        const mediaWrap = document.createElement('div');
        mediaWrap.className = 'hp:hidden hp:mb-2';
        const img = document.createElement('img');
        img.className = 'hp:max-w-full hp:rounded';
        mediaWrap.appendChild(img);

        const textEl = document.createElement('div');
        textEl.className = 'hp:text-sm hp:mb-2';

        const linkEl = document.createElement('a');
        linkEl.target = '_blank';
        linkEl.rel = 'noopener noreferrer';
        linkEl.className = 'hp:hidden hp:text-accent hp:underline hp:text-sm hp:block hp:mb-2';

        const continueBtn = document.createElement('button');
        continueBtn.type = 'button';
        continueBtn.className = 'hp:hidden hp:px-4 hp:py-1.5 hp:rounded hp:bg-accent hp:text-on-accent hp:border-0 hp:cursor-pointer hp:text-sm';

        panel.append(closeBtn, mediaWrap, textEl, linkEl, continueBtn);
        overlay.appendChild(panel);
        this.ctx.overlayContainerEl.appendChild(overlay);
        this.popupEl = overlay;
        return overlay;
    }

    private hidePopup(): void {
        this.popupEl?.classList.add('hp:hidden');
        this.popupEl?.classList.remove('hp:flex');
    }

    private safePlay(): void {
        void this.ctx.videoEl.play().catch(() => {});
    }

    private showPopup(cfg: Required<MarkerPopupOptions>): void {
        const el = this.ensurePopup();
        const textEl = el.querySelector('div.hp\\:text-sm.hp\\:mb-2:not(.hp\\:hidden)') as HTMLElement | null;
        const mediaWrap = el.querySelector('div.hp\\:mb-2') as HTMLElement | null;
        const img = el.querySelector('img') as HTMLImageElement | null;
        const linkEl = el.querySelector('a') as HTMLAnchorElement | null;
        const continueBtn = el.querySelectorAll('button')[1] as HTMLButtonElement | null;
        const closeBtn = el.querySelector('button') as HTMLButtonElement | null;

        if (closeBtn) closeBtn.style.display = cfg.showClose === false ? 'none' : '';
        if (textEl) textEl.textContent = cfg.text || '';

        const isRich = cfg.mode === 'rich';
        if (mediaWrap && img) {
            if (isRich && cfg.imageUrl) {
                mediaWrap.classList.remove('hp:hidden');
                img.src = cfg.imageUrl;
                img.alt = cfg.imageAlt || '';
            } else {
                mediaWrap.classList.add('hp:hidden');
                img.removeAttribute('src');
            }
        }

        if (linkEl) {
            if (isRich && cfg.linkUrl) {
                linkEl.classList.remove('hp:hidden');
                linkEl.href = cfg.linkUrl;
                linkEl.textContent = cfg.linkText || this.ctx.i18n.markerLearnMore;
            } else {
                linkEl.classList.add('hp:hidden');
                linkEl.removeAttribute('href');
            }
        }

        if (continueBtn) {
            if (cfg.showContinue) {
                continueBtn.classList.remove('hp:hidden');
                continueBtn.textContent = cfg.continueText || this.ctx.i18n.markerContinue;
            } else {
                continueBtn.classList.add('hp:hidden');
            }
        }

        const newClose = closeBtn?.cloneNode(true) as HTMLButtonElement | undefined;
        if (closeBtn && newClose) closeBtn.replaceWith(newClose);
        const newCont = continueBtn?.cloneNode(true) as HTMLButtonElement | undefined;
        if (continueBtn && newCont) continueBtn.replaceWith(newCont);

        newClose?.addEventListener('click', () => {
            this.hidePopup();
            if (cfg.autoplayOnClose) this.safePlay();
        });
        newCont?.addEventListener('click', () => {
            this.hidePopup();
            if (cfg.autoplayOnContinue) this.safePlay();
        });

        el.classList.remove('hp:hidden');
        el.classList.add('hp:flex');
    }
}
