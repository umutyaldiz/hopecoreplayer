import { createIcon } from '../icons/Icon';
import type { HopeLocaleStrings } from '../i18n/types';

export interface SettingsQualityOption {
    label: string;
    onSelect: () => void;
}

export interface SettingsCaptionOption {
    label: string;
    onSelect: () => void;
}

export interface SettingsSubmenuItem {
    label: string;
    active: boolean;
    onSelect: () => void;
}

/** Bir renk paleti satırındaki tek bir swatch — `value` hem swatch'ın KENDİ arkaplanı hem de uygulanacak CSS rengi. */
export interface SettingsColorOption {
    value: string;
    active: boolean;
    ariaLabel: string;
    onSelect: () => void;
}

/** Altyazı açıkken "Altyazı" alt menüsüne eklenen görünüm ayarları (boyut, renkler, konumu sıfırla). */
export interface SettingsCaptionAppearance {
    sizeLabel: string;
    getSizeOptions: () => SettingsSubmenuItem[];
    bgColorLabel: string;
    getBgColorOptions: () => SettingsColorOption[];
    textColorLabel: string;
    getTextColorOptions: () => SettingsColorOption[];
    resetPositionLabel: string;
    onResetPosition: () => void;
}

/** Plugin'lerin ana menüye kendi satır + alt menüsünü eklemesi için. */
export interface SettingsSubmenuDef {
    key: string;
    title: string;
    getValueLabel: () => string;
    getItems: () => SettingsSubmenuItem[];
}

/** Ana menüde tek bir aç/kapa satırı — alt menüye inmez. */
export interface SettingsToggleRow {
    label: string;
    getValueLabel: () => string;
    onToggle: () => void;
}

type PanelId = 'main' | 'speed' | 'quality' | 'captions' | 'captions-size' | 'captions-bg' | 'captions-text' | `custom:${string}`;

/** Ayarlar butonu + popup: ana liste (Hız/Kalite/Altyazı) → alt liste. */
export class SettingsMenu {
    readonly el: HTMLDivElement;
    private readonly button: HTMLButtonElement;
    private readonly panel: HTMLDivElement;
    private readonly video: HTMLVideoElement;
    private readonly playbackRates: number[];
    private readonly labels: HopeLocaleStrings;

    private qualities: SettingsQualityOption[] = [];
    private activeQualityLabel: string;
    private captions: SettingsCaptionOption[] = [];
    private activeCaptionLabel: string;
    private captionAppearance: SettingsCaptionAppearance | null = null;
    private qrResumeToggle: SettingsToggleRow | null = null;
    private open = false;
    private currentPanel: PanelId = 'main';
    private submenus: SettingsSubmenuDef[] = [];

    constructor(video: HTMLVideoElement, playbackRates: number[], labels: HopeLocaleStrings) {
        this.video = video;
        this.playbackRates = playbackRates;
        this.labels = labels;
        this.activeQualityLabel = labels.autoQuality;
        this.activeCaptionLabel = labels.captionsOff;

        this.el = document.createElement('div');
        this.el.className = 'hp:relative';

        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.setAttribute('aria-label', labels.settings);
        this.button.className =
            'hp-chip hp:flex hp:items-center hp:justify-center hp:w-[var(--hp-ctrl-btn-size)] hp:h-[var(--hp-ctrl-btn-size)] hp:cursor-pointer';
        this.button.appendChild(createIcon('settings', 'hp:text-[length:var(--hp-ctrl-icon-size)]'));

        this.panel = document.createElement('div');
        this.panel.className =
            'hp-chip hp-chip-panel hp:hidden hp:absolute hp:bottom-full hp:right-0 hp:mb-2 hp:w-48 hp:max-h-64 hp:overflow-y-auto hp:text-sm hp:py-1';

        this.el.appendChild(this.button);
        this.el.appendChild(this.panel);

        this.button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        document.addEventListener('click', this.onDocumentClick, true);

        this.renderMain();
    }

    setQualities(options: SettingsQualityOption[], activeLabel: string): void {
        this.qualities = options;
        this.activeQualityLabel = activeLabel;
        if (this.currentPanel === 'main' || this.currentPanel === 'quality') this.render();
    }

    setCaptions(options: SettingsCaptionOption[], activeLabel: string): void {
        this.captions = options;
        this.activeCaptionLabel = activeLabel;
        if (this.currentPanel === 'main' || this.currentPanel === 'captions') this.render();
    }

    /** Altyazı AÇIKKEN "Altyazı" alt menüsüne eklenecek Boyut/Renk/Konum satırları — `null` kaldırır. */
    setCaptionAppearance(appearance: SettingsCaptionAppearance | null): void {
        this.captionAppearance = appearance;
        if (
            this.currentPanel === 'captions' ||
            this.currentPanel === 'captions-size' ||
            this.currentPanel === 'captions-bg' ||
            this.currentPanel === 'captions-text'
        ) {
            this.render();
        }
    }

    /** Ana menüye tek aç/kapa satırı ekler (ör. QrResume). */
    setQrResumeToggle(toggle: SettingsToggleRow | null): void {
        this.qrResumeToggle = toggle;
        if (this.currentPanel === 'main') this.renderMain();
    }

    /** Plugin'lerin (ör. dubbing) ana menüye kendi satır + alt menüsünü eklemesi için. */
    registerSubmenu(def: SettingsSubmenuDef): void {
        this.submenus = this.submenus.filter((s) => s.key !== def.key);
        this.submenus.push(def);
        if (this.currentPanel === 'main') this.renderMain();
    }

    unregisterSubmenu(key: string): void {
        this.submenus = this.submenus.filter((s) => s.key !== key);
        if (this.currentPanel === 'main') this.renderMain();
        else if (this.currentPanel === `custom:${key}`) this.renderMain();
    }

    private toggle(): void {
        this.open ? this.close() : this.openMenu();
    }

    private openMenu(): void {
        this.open = true;
        this.currentPanel = 'main';
        this.panel.classList.remove('hp:hidden');
        this.renderMain();
    }

    private close(): void {
        this.open = false;
        this.panel.classList.add('hp:hidden');
    }

    private readonly onDocumentClick = (e: MouseEvent): void => {
        // composedPath(): Shadow DOM'da e.target host'a retarget edilir; contains() menünün kendi satırlarını "dışarı tıklama" sanardı.
        if (this.open && !e.composedPath().includes(this.el)) this.close();
    };

    private row(label: string, value: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'hp:flex hp:items-center hp:justify-between hp:w-full hp:px-3 hp:py-2 hp:text-left hp:bg-transparent hp:border-0 hp:cursor-pointer hp:text-on-surface hp:hover:bg-on-surface/10';
        btn.innerHTML = `<span>${label}</span><span class="hp:text-on-surface-muted hp:text-xs hp:flex hp:items-center hp:gap-1">${value}</span>`;
        btn.addEventListener('click', onClick);
        return btn;
    }

    private backRow(title: string, onBack: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'hp:flex hp:items-center hp:gap-2 hp:w-full hp:px-3 hp:py-2 hp:text-left hp:bg-transparent hp:border-0 hp:cursor-pointer hp:text-on-surface hp:font-medium hp:hover:bg-on-surface/10';
        btn.appendChild(createIcon('chevron-left', 'hp:text-sm'));
        const span = document.createElement('span');
        span.textContent = title;
        btn.appendChild(span);
        btn.addEventListener('click', onBack);
        return btn;
    }

    private render(): void {
        if (this.currentPanel === 'main') this.renderMain();
        else if (this.currentPanel === 'speed') this.renderSpeed();
        else if (this.currentPanel === 'quality') this.renderQuality();
        else if (this.currentPanel === 'captions') this.renderCaptions();
        else if (this.currentPanel === 'captions-size') this.renderCaptionsSize();
        else if (this.currentPanel === 'captions-bg') this.renderCaptionColorPanel('bg');
        else if (this.currentPanel === 'captions-text') this.renderCaptionColorPanel('text');
        else {
            const key = this.currentPanel.slice('custom:'.length);
            const def = this.submenus.find((s) => s.key === key);
            if (def) this.renderSubmenu(def);
            else this.renderMain();
        }
    }

    private renderMain(): void {
        this.currentPanel = 'main';
        this.panel.innerHTML = '';
        this.panel.appendChild(
            this.row(this.labels.playbackSpeed, this.video.playbackRate === 1 ? this.labels.normal : `${this.video.playbackRate}x`, () => {
                this.currentPanel = 'speed';
                this.renderSpeed();
            })
        );
        if (this.qualities.length > 0) {
            this.panel.appendChild(
                this.row(this.labels.quality, this.activeQualityLabel, () => {
                    this.currentPanel = 'quality';
                    this.renderQuality();
                })
            );
        }
        if (this.captions.length > 0) {
            this.panel.appendChild(
                this.row(this.labels.captions, this.activeCaptionLabel, () => {
                    this.currentPanel = 'captions';
                    this.renderCaptions();
                })
            );
        }
        for (const def of this.submenus) {
            this.panel.appendChild(
                this.row(def.title, def.getValueLabel(), () => {
                    this.currentPanel = `custom:${def.key}`;
                    this.renderSubmenu(def);
                })
            );
        }
        if (this.qrResumeToggle) {
            const toggle = this.qrResumeToggle;
            // Menü kapanmadan durumu değiştirip yeniden render eder.
            this.panel.appendChild(
                this.row(toggle.label, toggle.getValueLabel(), () => {
                    toggle.onToggle();
                    this.renderMain();
                })
            );
        }
    }

    private renderSubmenu(def: SettingsSubmenuDef): void {
        this.panel.innerHTML = '';
        this.panel.appendChild(this.backRow(def.title, () => this.renderMain()));
        for (const item of def.getItems()) {
            this.panel.appendChild(
                this.row(item.label, item.active ? '<i class="hp-icon hp-icon-check"></i>' : '', () => {
                    item.onSelect();
                    this.close();
                })
            );
        }
    }

    private renderSpeed(): void {
        this.panel.innerHTML = '';
        this.panel.appendChild(this.backRow(this.labels.playbackSpeed, () => this.renderMain()));
        for (const rate of this.playbackRates) {
            const active = this.video.playbackRate === rate;
            const btn = this.row(rate === 1 ? this.labels.normal : `${rate}x`, active ? '<i class="hp-icon hp-icon-check"></i>' : '', () => {
                this.video.playbackRate = rate;
                this.close();
            });
            this.panel.appendChild(btn);
        }
    }

    private renderQuality(): void {
        this.panel.innerHTML = '';
        this.panel.appendChild(this.backRow(this.labels.quality, () => this.renderMain()));
        for (const q of this.qualities) {
            const active = q.label === this.activeQualityLabel;
            this.panel.appendChild(
                this.row(q.label, active ? '<i class="hp-icon hp-icon-check"></i>' : '', () => {
                    q.onSelect();
                    this.close();
                })
            );
        }
    }

    private renderCaptions(): void {
        this.panel.innerHTML = '';
        this.panel.appendChild(this.backRow(this.labels.captions, () => this.renderMain()));
        for (const c of this.captions) {
            const active = c.label === this.activeCaptionLabel;
            this.panel.appendChild(
                this.row(c.label, active ? '<i class="hp-icon hp-icon-check"></i>' : '', () => {
                    c.onSelect();
                    this.close();
                })
            );
        }
        // Boyut/Renk/Konum satırları altyazı KAPALIYKEN anlamsız — yalnızca bir dil seçiliyken gösteriliyor.
        if (this.captionAppearance && this.activeCaptionLabel !== this.labels.captionsOff) {
            const appearance = this.captionAppearance;
            this.panel.appendChild(
                this.row(appearance.sizeLabel, '', () => {
                    this.currentPanel = 'captions-size';
                    this.renderCaptionsSize();
                })
            );
            this.panel.appendChild(
                this.row(appearance.bgColorLabel, '', () => {
                    this.currentPanel = 'captions-bg';
                    this.renderCaptionColorPanel('bg');
                })
            );
            this.panel.appendChild(
                this.row(appearance.textColorLabel, '', () => {
                    this.currentPanel = 'captions-text';
                    this.renderCaptionColorPanel('text');
                })
            );
            this.panel.appendChild(
                this.row(appearance.resetPositionLabel, '', () => {
                    appearance.onResetPosition();
                    this.close();
                })
            );
        }
    }

    private renderCaptionsSize(): void {
        this.panel.innerHTML = '';
        const appearance = this.captionAppearance;
        this.panel.appendChild(this.backRow(appearance?.sizeLabel ?? this.labels.captionSize, () => this.renderCaptions()));
        if (!appearance) return;
        for (const item of appearance.getSizeOptions()) {
            this.panel.appendChild(
                this.row(item.label, item.active ? '<i class="hp-icon hp-icon-check"></i>' : '', () => {
                    item.onSelect();
                    this.close();
                })
            );
        }
    }

    /** "Arka Plan Rengi" / "Yazı Rengi" — düz metin satırları yerine renkli swatch grid'i (YouTube'un kendi altyazı renk seçici deseni). */
    private renderCaptionColorPanel(kind: 'bg' | 'text'): void {
        this.panel.innerHTML = '';
        const appearance = this.captionAppearance;
        const title = kind === 'bg' ? (appearance?.bgColorLabel ?? this.labels.captionBgColor) : (appearance?.textColorLabel ?? this.labels.captionTextColor);
        this.panel.appendChild(this.backRow(title, () => this.renderCaptions()));
        if (!appearance) return;

        const grid = document.createElement('div');
        grid.className = 'hp:flex hp:flex-wrap hp:gap-2 hp:px-3 hp:py-2';
        const options = kind === 'bg' ? appearance.getBgColorOptions() : appearance.getTextColorOptions();
        for (const opt of options) {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.setAttribute('aria-label', opt.ariaLabel);
            swatch.className = 'hp:w-7 hp:h-7 hp:rounded-full hp:cursor-pointer hp:flex-shrink-0 hp:border hp:border-on-surface/20';
            swatch.style.background = opt.value;
            swatch.style.outline = opt.active ? '2px solid currentColor' : '2px solid transparent';
            swatch.style.outlineOffset = '2px';
            swatch.addEventListener('click', () => {
                opt.onSelect();
                this.render();
            });
            grid.appendChild(swatch);
        }
        this.panel.appendChild(grid);
    }

    /** Dil sonradan değişince statik buton etiketini tazeler + mevcut panel zaten güncel `this.labels`'ı okuyarak yeniden render edilir. */
    refreshLabels(): void {
        this.button.setAttribute('aria-label', this.labels.settings);
        this.render();
    }

    destroy(): void {
        document.removeEventListener('click', this.onDocumentClick, true);
    }
}
