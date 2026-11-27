import { createIcon } from '../icons/Icon';
import type { HopeLocaleStrings } from '../i18n/types';

/** Scroll ile ses adımı (tekerlek/trackpad cihazları arası tutarlılık için deltaY'in BÜYÜKLÜĞÜ değil YÖNÜ kullanılıyor — her "tık" sabit bir adım). */
const WHEEL_VOLUME_STEP = 0.05;
/** Butondan panele geçerken gerçek (0px) bir boşluk olmasa bile, fare bir an için ikisinin de dışına çıkarsa paneli hemen kapatmamak için kısa bir tolerans. */
const HIDE_DELAY_MS = 150;
/** Seviye değişince buton dolgusundaki dalganın hareket süresi (ms). */
const WAVE_MS = 1200;
/** Ok tuşlarıyla ses adımı. */
const KEY_VOLUME_STEP = 0.1;

/** Hoparlör + iki ses dalgası + sessiz çarpısı — seviyeye göre CSS ile canlandırılır (data-level). */
const VOLUME_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path class="hp-vol-spk" d="M4 9.5h3.2l4.4-3.9a.6.6 0 0 1 1 .45v11.9a.6.6 0 0 1-1 .45l-4.4-3.9H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/>' +
    '<path class="hp-vol-w1" d="M15.3 9.2a4 4 0 0 1 0 5.6"/>' +
    '<path class="hp-vol-w2" d="M17.9 6.6a7.6 7.6 0 0 1 0 10.8"/>' +
    '<path class="hp-vol-x" d="M16.2 9.7l4.6 4.6M20.8 9.7l-4.6 4.6"/>' +
    '</svg>';

export type VolumeOrientation = 'horizontal' | 'vertical';

/** Reklam sırasında ses reklamın sesini yönetir — IMA reklamı içerikten ayrı bir video'da oynatır. */
export interface VolumePanelAdHooks {
    isAdActive(): boolean;
    getVolume(): number;
    setVolume(volume: number): void;
    toggleMute(): void;
}

/** Sessize alma butonu (animasyonlu ikon) + fareyle açılan ses çubuğu: yatay (butonun yanında) ya da dikey (üstünde). */
export class VolumePanel {
    readonly el: HTMLDivElement;
    /** Sessiz oynarken görünen "Sesi aç" rozeti (dokunmatikte; chrome dışında monte edilir, otomatik gizlenmez). */
    readonly unmuteBadge: HTMLButtonElement;
    private readonly unmuteText: HTMLSpanElement;
    private readonly button: HTMLButtonElement;
    private readonly iconEl: HTMLElement;
    private readonly slider: HTMLDivElement;
    private readonly sliderFill: HTMLDivElement;
    /** options.volumePercent: buton seviye kadar dolar, tooltip yüzdeyi yazar. */
    private percent = false;
    private waveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly video: HTMLVideoElement;
    private readonly labels: HopeLocaleStrings;
    private readonly adHooks: VolumePanelAdHooks;
    private orientation: VolumeOrientation = 'horizontal';
    private dragging = false;
    private hideTimer: ReturnType<typeof setTimeout> | null = null;
    /** Son çizilen seviye — değişince ikon "atar". */
    private lastLevel: number | null = null;
    private bump = false;

    constructor(video: HTMLVideoElement, labels: HopeLocaleStrings, adHooks: VolumePanelAdHooks) {
        this.video = video;
        this.labels = labels;
        this.adHooks = adHooks;

        this.el = document.createElement('div');
        this.el.className = 'hp-volume hp:relative hp:flex hp:items-center';

        this.unmuteBadge = document.createElement('button');
        this.unmuteBadge.type = 'button';
        this.unmuteBadge.className = 'hp-unmute-badge';
        this.unmuteBadge.setAttribute('part', 'unmute-badge');
        this.unmuteBadge.appendChild(createIcon('volume-muted', 'hp:text-base'));
        this.unmuteText = document.createElement('span');
        this.unmuteText.textContent = labels.unmute;
        this.unmuteBadge.appendChild(this.unmuteText);
        // Videoya dokunma = oynat/duraklat (HopePlayerElement) — rozete dokunmak onu tetiklemesin.
        this.unmuteBadge.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.unmuteBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            this.unmute();
        });

        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.setAttribute('part', 'volume-button');
        this.button.className =
            'hp-chip hp:flex hp:items-center hp:justify-center hp:w-[var(--hp-ctrl-btn-size)] hp:h-[var(--hp-ctrl-btn-size)] hp:cursor-pointer';
        this.button.setAttribute('aria-label', labels.mute);
        this.button.dataset.shortcut = 'M';

        this.iconEl = createIcon(VOLUME_SVG, 'hp-vol-icon hp:text-[length:var(--hp-ctrl-icon-size)]');
        this.button.appendChild(this.iconEl);
        this.el.appendChild(this.button);

        // Görünürlük JS (mouseenter/mouseleave + kısa gecikme) — CSS :hover'da aradaki boşluk paneli kapatıyordu.
        this.slider = document.createElement('div');
        this.slider.setAttribute('part', 'volume-slider');
        this.slider.className = 'hp-vol-slider';
        this.slider.style.opacity = '0';
        this.slider.style.pointerEvents = 'none';
        this.slider.setAttribute('role', 'slider');
        this.slider.setAttribute('tabindex', '0');
        this.slider.setAttribute('aria-label', labels.volume);
        this.slider.setAttribute('aria-valuemin', '0');
        this.slider.setAttribute('aria-valuemax', '100');

        const track = document.createElement('div');
        track.className = 'hp-vol-track hp:bg-on-surface/25';
        this.slider.appendChild(track);

        this.sliderFill = document.createElement('div');
        this.sliderFill.className = 'hp-vol-fill hp:bg-accent';
        track.appendChild(this.sliderFill);

        const thumb = document.createElement('div');
        thumb.className = 'hp-vol-thumb hp:bg-accent';
        this.slider.appendChild(thumb);

        this.el.appendChild(this.slider);

        this.button.addEventListener('click', this.onToggleMute);
        this.slider.addEventListener('pointerdown', this.onSliderPointerDown);
        this.slider.addEventListener('keydown', this.onSliderKeyDown);
        this.el.addEventListener('mouseenter', this.openNow);
        this.el.addEventListener('mouseleave', this.scheduleHide);
        this.el.addEventListener('focusin', this.openNow);
        this.el.addEventListener('focusout', this.scheduleHide);
        // Buton VEYA panelin üzerindeyken tekerlek/trackpad ile ses ayarı —
        // sayfanın kendisinin kaymasını önlemek için preventDefault.
        this.el.addEventListener('wheel', this.onWheel, { passive: false });
        video.addEventListener('volumechange', this.render);
        video.addEventListener('play', this.render);
        video.addEventListener('pause', this.render);

        this.setOrientation('horizontal');
    }

    /** `options.volumeSlider` — yatay (varsayılan) ya da dikey çubuk. */
    setOrientation(orientation: VolumeOrientation): void {
        this.orientation = orientation;
        this.el.dataset.orientation = orientation;
        this.slider.setAttribute('aria-orientation', orientation);
        // Dikey çubuk butonun üstünde ayrı bir cam panel; yatay çubuk kontrol grubunun içinde.
        this.slider.classList.toggle('hp-chip', orientation === 'vertical');
        this.render();
    }

    /** `options.volumePercent` — buton içi seviye kadar dolar, tooltip'te "70%". */
    setPercentVisible(visible: boolean): void {
        this.percent = visible;
        this.button.toggleAttribute('data-level-fill', visible);
        if (!visible) {
            delete this.button.dataset.tooltipValue;
            delete this.slider.dataset.tooltipValue;
        }
        this.render();
    }

    private readonly openNow = (): void => {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        this.el.setAttribute('data-open', '');
        this.slider.style.opacity = '1';
        this.slider.style.pointerEvents = 'auto';
    };

    private readonly scheduleHide = (): void => {
        // Sürüklerken panelin dışına çıkmak onu kapatmasın.
        if (this.dragging) return;
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            this.hideTimer = null;
            this.el.removeAttribute('data-open');
            this.slider.style.opacity = '0';
            this.slider.style.pointerEvents = 'none';
        }, HIDE_DELAY_MS);
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const step = e.deltaY < 0 ? WHEEL_VOLUME_STEP : -WHEEL_VOLUME_STEP;
        if (this.adHooks.isAdActive()) {
            this.adHooks.setVolume(Math.min(1, Math.max(0, this.adHooks.getVolume() + step)));
            this.render();
            return;
        }
        const current = this.video.muted ? 0 : this.video.volume;
        const next = Math.min(1, Math.max(0, current + step));
        this.video.volume = next;
        this.video.muted = next === 0;
    };

    /** "Sesi aç" rozeti: yalnızca AÇAR (toggle değil) — reklam sırasında reklamın sesini. */
    private unmute(): void {
        if (this.adHooks.isAdActive()) {
            if (this.adHooks.getVolume() === 0) this.adHooks.toggleMute();
            this.render();
            return;
        }
        this.video.muted = false;
        if (this.video.volume === 0) this.video.volume = 0.5;
    }

    private readonly onToggleMute = (): void => {
        if (this.adHooks.isAdActive()) {
            this.adHooks.toggleMute();
            this.render();
            return;
        }
        this.video.muted = !this.video.muted;
        if (!this.video.muted && this.video.volume === 0) this.video.volume = 0.5;
    };

    private set(volume: number): void {
        const v = Math.min(1, Math.max(0, volume));
        if (this.adHooks.isAdActive()) {
            this.adHooks.setVolume(v);
        } else {
            this.video.volume = v;
            this.video.muted = v === 0;
        }
        // volumechange beklenmez: çubuk aynı karede parmağı izler.
        this.render();
    }

    /** Sürükleme başında ölçülen çubuk (her harekette yeniden ölçüp layout zorlamasın). */
    private dragRect: DOMRect | null = null;

    /** Yatayda sol = sessiz, sağ = tam; dikeyde alt = sessiz, üst = tam. */
    private setFromPointer(e: PointerEvent): void {
        const r = this.dragRect ?? this.slider.getBoundingClientRect();
        const ratio =
            this.orientation === 'vertical'
                ? r.height > 0
                    ? 1 - (e.clientY - r.top) / r.height
                    : 0
                : r.width > 0
                  ? (e.clientX - r.left) / r.width
                  : 0;
        this.set(ratio);
    }

    private readonly onSliderPointerDown = (e: PointerEvent): void => {
        if (this.dragging) return;
        e.preventDefault();
        this.dragging = true;
        this.slider.setAttribute('data-dragging', '');
        this.slider.setPointerCapture(e.pointerId);
        // preventDefault odağı da engeller — klavyeyle devam edilebilsin.
        this.slider.focus({ preventScroll: true });
        this.dragRect = this.slider.getBoundingClientRect();
        this.setFromPointer(e);
        this.slider.addEventListener('pointermove', this.onSliderPointerMove);
        this.slider.addEventListener('pointerup', this.onSliderPointerUp);
        this.slider.addEventListener('pointercancel', this.onSliderPointerUp);
        this.slider.addEventListener('lostpointercapture', this.onSliderPointerUp);
    };

    private readonly onSliderPointerMove = (e: PointerEvent): void => {
        if (this.dragging) this.setFromPointer(e);
    };

    /** Bırakma, iptal ya da yakalamanın kaybı — sürükleme takılı kalmaz. */
    private readonly onSliderPointerUp = (e: PointerEvent): void => {
        if (!this.dragging) return;
        this.dragging = false;
        this.dragRect = null;
        this.slider.removeAttribute('data-dragging');
        this.slider.removeEventListener('pointermove', this.onSliderPointerMove);
        this.slider.removeEventListener('pointerup', this.onSliderPointerUp);
        this.slider.removeEventListener('pointercancel', this.onSliderPointerUp);
        this.slider.removeEventListener('lostpointercapture', this.onSliderPointerUp);
        if (this.slider.hasPointerCapture(e.pointerId)) this.slider.releasePointerCapture(e.pointerId);
        // Sürüklerken panelden çıkıldıysa bırakınca kapanır.
        const active = (this.el.getRootNode() as Document | ShadowRoot).activeElement;
        if (!this.el.matches(':hover') && !this.el.contains(active)) this.scheduleHide();
    };

    private current(): number {
        if (this.adHooks.isAdActive()) return this.adHooks.getVolume();
        return this.video.muted ? 0 : this.video.volume;
    }

    private readonly onSliderKeyDown = (e: KeyboardEvent): void => {
        const map: Record<string, number> = { ArrowUp: KEY_VOLUME_STEP, ArrowRight: KEY_VOLUME_STEP, ArrowDown: -KEY_VOLUME_STEP, ArrowLeft: -KEY_VOLUME_STEP };
        if (e.key in map) this.set(this.current() + map[e.key]!);
        else if (e.key === 'Home') this.set(0);
        else if (e.key === 'End') this.set(1);
        else return;
        e.preventDefault();
        // Player'ın ←/→ sarma kısayolu çalışmasın.
        e.stopPropagation();
    };

    private readonly render = (): void => {
        const v = this.current();
        const vertical = this.orientation === 'vertical';
        this.sliderFill.style.transform = vertical ? `scaleY(${v})` : `scaleX(${v})`;
        this.slider.style.setProperty('--hp-vol', String(v));
        this.slider.setAttribute('aria-valuenow', String(Math.round(v * 100)));
        this.slider.setAttribute('aria-valuetext', `${Math.round(v * 100)}%`);
        if (this.percent) {
            this.button.style.setProperty('--hp-vol', String(v));
            const value = `${Math.round(v * 100)}%`;
            this.button.toggleAttribute('data-silent', v === 0);
            if (this.button.dataset.tooltipValue !== value) {
                const first = this.button.dataset.tooltipValue === undefined;
                this.button.dataset.tooltipValue = value;
                this.slider.dataset.tooltipValue = value;
                // Açık tooltip'in metni de güncellensin (buton ya da çubuk).
                this.button.dispatchEvent(new Event('hp-tooltip-update', { bubbles: true }));
                this.slider.dispatchEvent(new Event('hp-tooltip-update', { bubbles: true }));
                // Seviye değişince dalga kısa bir süre hareket eder; sonra durur (sürekli animasyon yok).
                if (!first) {
                    this.button.setAttribute('data-changing', '');
                    if (this.waveTimer) clearTimeout(this.waveTimer);
                    this.waveTimer = setTimeout(() => {
                        this.waveTimer = null;
                        this.button.removeAttribute('data-changing');
                    }, WAVE_MS);
                }
            }
        }

        this.button.setAttribute('aria-label', v === 0 ? this.labels.unmute : this.labels.mute);
        // Rozet: sessizken ve oynarken (ya da reklam varken) — duraklatılmış bir kapak karesinde kalabalık etmesin.
        const playing = this.adHooks.isAdActive() || !this.video.paused;
        this.unmuteBadge.toggleAttribute('data-visible', v === 0 && playing);
        this.unmuteText.textContent = this.labels.unmute;

        // İkon: 0 = sessiz (çarpı), 1 = tek dalga, 2 = iki dalga; dalgalar seviyeyle hafifçe büyür.
        const level = v === 0 ? 0 : v < 0.5 ? 1 : 2;
        this.iconEl.dataset.level = String(level);
        this.iconEl.style.setProperty('--hp-vol', String(v));
        if (this.lastLevel !== null && level !== this.lastLevel) {
            // İki animasyon adı arasında geçiş: yeniden başlatmak için reflow gerekmez.
            this.bump = !this.bump;
            this.iconEl.dataset.bump = this.bump ? 'a' : 'b';
        }
        this.lastLevel = level;
    };

    refreshLabels(): void {
        this.slider.setAttribute('aria-label', this.labels.volume);
        this.render();
    }

    /** Reklam modu açılıp/kapanınca (`ControlBar.setAdMode`) görüntüyü hemen ad/içerik ses kaynağına göre tazeler — `volumechange` event'i beklemeden. */
    refreshForAdMode(): void {
        this.render();
    }

    destroy(): void {
        if (this.hideTimer) clearTimeout(this.hideTimer);
        if (this.waveTimer) clearTimeout(this.waveTimer);
        this.el.removeEventListener('mouseenter', this.openNow);
        this.el.removeEventListener('mouseleave', this.scheduleHide);
        this.el.removeEventListener('focusin', this.openNow);
        this.el.removeEventListener('focusout', this.scheduleHide);
        this.el.removeEventListener('wheel', this.onWheel);
        this.video.removeEventListener('volumechange', this.render);
        this.video.removeEventListener('play', this.render);
        this.video.removeEventListener('pause', this.render);
        this.unmuteBadge.remove();
    }
}
