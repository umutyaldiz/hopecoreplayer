import { createIcon, setIconName } from '../icons/Icon';
import type { HopeLocaleStrings } from '../i18n/types';

/** Scroll ile ses adımı (tekerlek/trackpad cihazları arası tutarlılık için deltaY'in BÜYÜKLÜĞÜ değil YÖNÜ kullanılıyor — her "tık" sabit bir adım). */
const WHEEL_VOLUME_STEP = 0.05;
/** Butondan panele geçerken gerçek (0px) bir boşluk olmasa bile, fare bir an için ikisinin de dışına çıkarsa paneli hemen kapatmamak için kısa bir tolerans. */
const HIDE_DELAY_MS = 150;

/** Reklam sırasında ses reklamın sesini yönetir — IMA reklamı içerikten ayrı bir video'da oynatır. */
export interface VolumePanelAdHooks {
    isAdActive(): boolean;
    getVolume(): number;
    setVolume(volume: number): void;
    toggleMute(): void;
}

/** Mute toggle + hover'da açılan dikey ses çubuğu. */
export class VolumePanel {
    readonly el: HTMLDivElement;
    /** Dokunmatikte ses butonu gizli; sessiz oynarken görünen "Sesi aç" rozeti (chrome dışında monte edilir, otomatik gizlenmez). */
    readonly unmuteBadge: HTMLButtonElement;
    private readonly unmuteText: HTMLSpanElement;
    private readonly button: HTMLButtonElement;
    private readonly iconEl: HTMLElement;
    private readonly slider: HTMLDivElement;
    private readonly sliderFill: HTMLDivElement;
    private readonly video: HTMLVideoElement;
    private readonly labels: HopeLocaleStrings;
    private readonly adHooks: VolumePanelAdHooks;
    private dragging = false;
    private hideTimer: ReturnType<typeof setTimeout> | null = null;

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

        this.iconEl = createIcon('volume-high', 'hp:text-[length:var(--hp-ctrl-icon-size)]');
        this.button.appendChild(this.iconEl);
        this.el.appendChild(this.button);

        // Dikey panel butonun hemen üstünde, arada boşluk yok; görünürlük JS (mouseenter/mouseleave + kısa gecikme) —
        // CSS :hover'da aradaki boşluk paneli kapatıyordu.
        this.slider = document.createElement('div');
        this.slider.setAttribute('part', 'volume-slider');
        this.slider.className =
            'hp-chip hp:absolute hp:bottom-full hp:left-1/2 hp-center-x hp:mb-2 ' +
            'hp:w-7 hp:h-20 hp:rounded-full hp:cursor-pointer ' +
            'hp:flex hp:items-end hp:justify-center hp:p-1.5 ' +
            'hp:pointer-events-none hp:transition-opacity hp:duration-150 hp:will-change-[opacity]';
        this.slider.style.opacity = '0';
        // .hp-chip'in kendi --hp-chip-radius'u (plain CSS, Tailwind utility'lerinden
        // SONRA derleniyor) rounded-full'u ezer — tam pil şekli için inline override.
        this.slider.style.borderRadius = '9999px';
        this.slider.setAttribute('role', 'slider');
        this.slider.setAttribute('tabindex', '0');
        this.slider.setAttribute('aria-label', labels.volume);
        this.slider.setAttribute('aria-orientation', 'vertical');
        this.slider.setAttribute('aria-valuemin', '0');
        this.slider.setAttribute('aria-valuemax', '100');

        const track = document.createElement('div');
        track.className = 'hp:relative hp:w-1.5 hp:h-full hp:rounded-full hp:bg-on-surface/25 hp:overflow-hidden';
        this.slider.appendChild(track);

        this.sliderFill = document.createElement('div');
        this.sliderFill.className = 'hp:absolute hp:inset-x-0 hp:bottom-0 hp:bg-accent';
        track.appendChild(this.sliderFill);

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

        this.render();
    }

    private readonly openNow = (): void => {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        this.slider.style.opacity = '1';
        this.slider.style.pointerEvents = 'auto';
    };

    private readonly scheduleHide = (): void => {
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            this.hideTimer = null;
            this.slider.style.opacity = '0';
            this.slider.style.pointerEvents = 'none';
        }, HIDE_DELAY_MS);
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        if (this.adHooks.isAdActive()) {
            const current = this.adHooks.getVolume();
            this.adHooks.setVolume(Math.min(1, Math.max(0, current + (e.deltaY < 0 ? WHEEL_VOLUME_STEP : -WHEEL_VOLUME_STEP))));
            this.render();
            return;
        }
        const current = this.video.muted ? 0 : this.video.volume;
        const next = Math.min(1, Math.max(0, current + (e.deltaY < 0 ? WHEEL_VOLUME_STEP : -WHEEL_VOLUME_STEP)));
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

    /** Dikey çubukta: üst = tam ses (1), alt = sessiz (0) — Y ekseni ters çevrilir. */
    private setFromClientY(clientY: number): void {
        const rect = this.slider.getBoundingClientRect();
        const ratio = rect.height > 0 ? 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) : 0;
        if (this.adHooks.isAdActive()) {
            this.adHooks.setVolume(ratio);
            this.render();
            return;
        }
        this.video.volume = ratio;
        this.video.muted = ratio === 0;
    }

    private readonly onSliderPointerDown = (e: PointerEvent): void => {
        this.dragging = true;
        this.slider.setPointerCapture(e.pointerId);
        this.setFromClientY(e.clientY);
        this.slider.addEventListener('pointermove', this.onSliderPointerMove);
        this.slider.addEventListener('pointerup', this.onSliderPointerUp);
    };

    private readonly onSliderPointerMove = (e: PointerEvent): void => {
        if (this.dragging) this.setFromClientY(e.clientY);
    };

    private readonly onSliderPointerUp = (e: PointerEvent): void => {
        this.dragging = false;
        this.slider.releasePointerCapture(e.pointerId);
        this.slider.removeEventListener('pointermove', this.onSliderPointerMove);
        this.slider.removeEventListener('pointerup', this.onSliderPointerUp);
    };

    private readonly onSliderKeyDown = (e: KeyboardEvent): void => {
        if (this.adHooks.isAdActive()) {
            if (e.key === 'ArrowUp') {
                this.adHooks.setVolume(Math.min(1, this.adHooks.getVolume() + 0.1));
                e.preventDefault();
            } else if (e.key === 'ArrowDown') {
                this.adHooks.setVolume(Math.max(0, this.adHooks.getVolume() - 0.1));
                e.preventDefault();
            } else {
                return;
            }
            this.render();
            return;
        }
        if (e.key === 'ArrowUp') {
            this.video.volume = Math.min(1, this.video.volume + 0.1);
            this.video.muted = false;
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            this.video.volume = Math.max(0, this.video.volume - 0.1);
            e.preventDefault();
        }
    };

    private readonly render = (): void => {
        const effectiveVolume = this.adHooks.isAdActive() ? this.adHooks.getVolume() : this.video.muted ? 0 : this.video.volume;
        this.sliderFill.style.height = `${effectiveVolume * 100}%`;
        this.slider.setAttribute('aria-valuenow', String(Math.round(effectiveVolume * 100)));

        const label = effectiveVolume === 0 ? this.labels.unmute : this.labels.mute;
        this.button.setAttribute('aria-label', label);
        // Rozet: sessizken ve oynarken (ya da reklam varken) — duraklatılmış bir kapak karesinde kalabalık etmesin.
        const playing = this.adHooks.isAdActive() || !this.video.paused;
        this.unmuteBadge.toggleAttribute('data-visible', effectiveVolume === 0 && playing);
        this.unmuteText.textContent = this.labels.unmute;
        if (effectiveVolume === 0) setIconName(this.iconEl, 'volume-muted');
        else if (effectiveVolume < 0.5) setIconName(this.iconEl, 'volume-low');
        else setIconName(this.iconEl, 'volume-high');
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
