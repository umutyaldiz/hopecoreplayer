import { createIcon } from '../icons/Icon';
import type { HopeLocaleStrings } from '../i18n/types';

export interface SettingsQualityOption {
    label: string;
    onSelect: () => void;
    /** Kilitli kalite (ödüllü reklamla açılır) — satırda kilit işareti; seçilince kilit açma akışı başlar. */
    locked?: boolean;
}

/** Kilit işareti (ikon fontunda yok). */
export const LOCK_SVG =
    '<svg class="hp-lock" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>';

export interface SettingsCaptionOption {
    label: string;
    onSelect: () => void;
}

export interface SettingsSubmenuItem {
    label: string;
    active: boolean;
    onSelect: () => void;
    /** Sağdaki değer metni (ör. "150%") — verilirse onay işareti yerine gösterilir. */
    value?: string;
    /** Verilirse satır bir alt menü açar (`onSelect` çağrılmaz) — iç içe menüler için (ör. Erişilebilirlik → Filtre). */
    children?: () => SettingsSubmenuDef;
    /** Seçince menü kapanmasın, aynı alt menü yeniden çizilsin (aç/kapa satırları). */
    keepOpen?: boolean;
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

type PanelId =
    | 'main'
    | 'speed'
    | 'quality'
    | 'captions'
    | 'captions-settings'
    | 'captions-size'
    | 'captions-bg'
    | 'captions-text'
    | `custom:${string}`;

/** Ayarlar butonu + popup: ana liste (Hız/Kalite/Altyazı) → alt liste. */
/** Menü ile buton arası boşluk ve player kenarına bırakılan pay (px). */
const MENU_GAP_PX = 8;
const MENU_EDGE_PX = 8;
/** Panel yüksekliği: buton yanında bundan az yer varsa menü player kenarından açılır; üst sınır eski max-h-64. */
const MENU_MIN_HEIGHT_PX = 100;
const MENU_MAX_HEIGHT_PX = 256;

/**
 * Çözünürlükten rozet metni: kısa kenara göre 720+ → HD, 1440+ → 2K, 2160+ → 4K, 4320+ → 8K; altı → null (rozet yok).
 * Eşikler biraz aşağıda — kırpılmış kaynaklar (ör. 3840×1600 sinema oranı → kısa kenar 1600) bir alt sınıfa düşmesin
 * diye uzun kenar da sayılır.
 */
function iconEl(cls: string): HTMLElement {
    const i = document.createElement('i');
    i.className = `hp-icon ${cls}`;
    return i;
}

const checkIcon = (): HTMLElement => iconEl('hp-icon-check');

/** Sabit kilit SVG'sinden düğüm (yalnızca kendi sabitimiz ayrıştırılır). */
function lockIcon(): Node {
    const t = document.createElement('template');
    t.innerHTML = LOCK_SVG;
    return t.content.firstElementChild ?? document.createTextNode('');
}

export function qualityBadgeText(width: number, height: number): string | null {
    if (!width || !height) return null;
    const short = Math.min(width, height);
    const long = Math.max(width, height);
    if (short >= 4000 || long >= 7600) return '8K';
    if (short >= 2000 || long >= 3800) return '4K';
    if (short >= 1400 || long >= 2500) return '2K';
    if (short >= 700 || long >= 1260) return 'HD';
    // HD altı: en yakın standart yükseklik ("480", "360", "240", "144") — "p" yok, rozet dar kalsın.
    return String(LOW_HEIGHTS.reduce((best, h) => (Math.abs(h - short) < Math.abs(best - short) ? h : best)));
}
const LOW_HEIGHTS = [144, 240, 360, 480, 540, 576];

export class SettingsMenu {
    readonly el: HTMLDivElement;
    private readonly button: HTMLButtonElement;
    private readonly badge: HTMLSpanElement;
    private readonly quickSlot: HTMLSpanElement;
    /** Paneli en son açan hızlı erişim butonu — aynı butona tekrar basınca kapatmak için. */
    private quickOwner: HTMLButtonElement | null = null;
    private readonly quickObserver: MutationObserver;
    private badgeEnabled = true;
    private readonly panel: HTMLDivElement;
    private readonly video: HTMLVideoElement;
    private playbackRates: number[];
    private readonly labels: HopeLocaleStrings;

    private qualities: SettingsQualityOption[] = [];
    private activeQualityLabel: string;
    private captions: SettingsCaptionOption[] = [];
    private activeCaptionLabel: string;
    private captionAppearance: SettingsCaptionAppearance | null = null;
    private qrResumeToggle: SettingsToggleRow | null = null;
    private open = false;
    /** Menü açılıp kapanınca — HopePlayerElement açıkken kontrolleri otomatik gizlemez. */
    onOpenChange: ((open: boolean) => void) | null = null;
    private readonly panelObserver: MutationObserver;
    private currentPanel: PanelId = 'main';
    private submenus: SettingsSubmenuDef[] = [];
    /** Eklenti aç / kapa satırları. */
    private readonly toggles = new Map<string, SettingsToggleRow>();

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
        // Oynayan görüntünün çözünürlüğüne göre "HD" / "2K" / "4K" / "8K" rozeti — ayarlar ikonunun sağ üstünde.
        this.badge = document.createElement('span');
        this.badge.className = 'hp-quality-badge';
        this.badge.setAttribute('part', 'quality-badge');
        this.badge.setAttribute('aria-hidden', 'true');
        this.badge.hidden = true;
        for (const ev of ['resize', 'loadedmetadata', 'emptied']) video.addEventListener(ev, this.updateBadge);

        this.panel = document.createElement('div');
        this.panel.className =
            'hp-chip hp-chip-panel hp:hidden hp:absolute hp:bottom-full hp:right-0 hp:mb-2 hp:w-48 hp:max-h-64 hp:overflow-y-auto hp:text-sm hp:py-1';
        // Alt menüye geçince içerik yüksekliği değişir — yerleşimi yeniden hesapla.
        this.panelObserver = new MutationObserver(this.fitToPlayer);
        this.panelObserver.observe(this.panel, { childList: true });

        // Buton + rozet kendi konumlanmış kutusunda (rozet ona göre köşeye oturur); yanında hızlı erişim butonları,
        // panel ise hepsinin üstünde (sağa hizalı) açılır.
        const buttonWrap = document.createElement('span');
        buttonWrap.className = 'hp:relative hp:flex';
        buttonWrap.appendChild(this.button);
        // Rozet butonun DIŞINDA (kardeş, aynı konumlanmış kapsayıcıda): içinde olsaydı görünen "HD" metni butonun adıyla
        // ("Ayarlar") çelişirdi (WCAG 2.5.3, axe label-content-name-mismatch). pointer-events: none — tık butona geçer.
        buttonWrap.appendChild(this.badge);
        // Hızlı erişim butonları (ör. açık erişilebilirlik özellikleri) ayarlar butonunun sağında — panel bunların üstünde
        // açılır; aynı kapsayıcıda oldukları için tıklamaları "menü dışına tıklama" sayılmaz.
        this.quickSlot = document.createElement('span');
        this.quickSlot.className = 'hp-quick-slot hp:flex hp:items-center hp:gap-1';
        this.quickSlot.hidden = true;
        // Boşken yer kaplamasın (grup aralığı) — buton eklenip çıkarıldıkça.
        this.quickObserver = new MutationObserver(() => {
            this.quickSlot.hidden = this.quickSlot.childElementCount === 0;
            if (this.quickOwner && !this.quickOwner.isConnected) this.quickOwner = null;
        });
        this.quickObserver.observe(this.quickSlot, { childList: true });
        this.el.className = 'hp:relative hp:flex hp:items-center hp:gap-1';
        this.el.append(buttonWrap, this.quickSlot, this.panel);

        this.button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        document.addEventListener('click', this.onDocumentClick, true);

        this.renderMain();
    }

    /**
     * Ayarlar butonunun sağına hızlı erişim butonu ekler; `def` verilen alt menüyü doğrudan açar (aynı butona tekrar
     * basınca kapanır). `parents`: alt menüdeki "geri" satırının döneceği üst menüler. Kaldırmak için `btn.remove()`.
     */
    addQuickButton(btn: HTMLButtonElement, getDef: () => SettingsSubmenuDef, getParents: () => SettingsSubmenuDef[] = () => []): void {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const def = getDef();
            if (this.open && this.currentPanel === `custom:${def.key}` && this.quickOwner === btn) {
                this.close();
                return;
            }
            this.openSubmenu(def, getParents());
            this.quickOwner = btn;
        });
        this.quickSlot.appendChild(btn);
    }

    /** Menüyü doğrudan bir alt menüde açar (hızlı erişim butonları için). */
    openSubmenu(def: SettingsSubmenuDef, parents: SettingsSubmenuDef[] = []): void {
        if (!this.open) {
            this.open = true;
            this.panel.classList.remove('hp:hidden');
            this.onOpenChange?.(true);
        }
        this.currentPanel = `custom:${def.key}`;
        this.renderSubmenu(def, parents);
        this.fitToPlayer();
    }

    /**
     * `options.playbackRates` — menüdeki hızlar (sıralanır, tekrarlar atılır, geçersizler yok sayılır). Boş dizi: "Oynatma
     * hızı" satırı kalkar. Liste o anki hızı içermiyorsa ve 1 (normal) listedeyse hız 1'e döner — menüde seçili satır
     * olmayan bir hızda kalınmasın.
     */
    setPlaybackRates(rates: number[]): void {
        this.playbackRates = [...new Set(rates.filter((r) => Number.isFinite(r) && r > 0 && r <= 16))].sort((a, b) => a - b);
        if (this.playbackRates.length && !this.playbackRates.includes(this.video.playbackRate) && this.playbackRates.includes(1)) this.video.playbackRate = 1;
        if (this.open && (this.currentPanel === 'main' || this.currentPanel === 'speed')) this.renderMain();
    }

    /** `options.qualityBadge` — false ise rozet hiç gösterilmez. */
    setQualityBadgeEnabled(enabled: boolean): void {
        this.badgeEnabled = enabled;
        this.updateBadge();
    }

    /**
     * Rozet gerçekten oynayan görüntüden okunur (`videoWidth` / `videoHeight`): menüde "Otomatik" seçiliyken de ABR'nin
     * o an indirdiği kaliteyi gösterir; MP4, hls.js ve Safari'nin kendi HLS oynatıcısında aynı çalışır. Dikey videoda
     * kısa kenar sayılır (1080×1920 → HD). Ses modu / görüntüsüz kaynakta rozet yok.
     */
    private readonly updateBadge = (): void => {
        const text = this.badgeEnabled ? qualityBadgeText(this.video.videoWidth, this.video.videoHeight) : null;
        this.badge.textContent = text ?? '';
        this.badge.hidden = !text;
        if (text) this.badge.setAttribute('data-quality', text);
        else this.badge.removeAttribute('data-quality');
        this.badge.toggleAttribute('data-low', !!text && /^\d+$/.test(text));
    };

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

    /** Seçili altyazıyı dışarıdan günceller (ör. iOS native tam ekranda yapılan seçim) — seçenekler aynı kalır. */
    setActiveCaption(label: string): void {
        if (this.activeCaptionLabel === label) return;
        this.activeCaptionLabel = label;
        if (this.currentPanel === 'main' || this.currentPanel === 'captions') this.render();
    }

    /** Altyazı AÇIKKEN "Altyazı" alt menüsüne eklenecek Boyut/Renk/Konum satırları — `null` kaldırır. */
    setCaptionAppearance(appearance: SettingsCaptionAppearance | null): void {
        this.captionAppearance = appearance;
        if (
            this.currentPanel === 'captions' ||
            this.currentPanel === 'captions-settings' ||
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

    /** Aç / kapa satırı ekler (aynı anahtar yerine geçer). */
    registerToggle(key: string, row: SettingsToggleRow): void {
        this.toggles.set(key, row);
        if (this.open && this.currentPanel === 'main') this.renderMain();
    }

    unregisterToggle(key: string): void {
        if (!this.toggles.delete(key)) return;
        if (this.open && this.currentPanel === 'main') this.renderMain();
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
        this.fitToPlayer();
        this.onOpenChange?.(true);
    }

    get isOpen(): boolean {
        return this.open;
    }

    /** Açıksa menü panelinin ekran dikdörtgeni (tooltip çakışma kontrolü için). */
    get panelRect(): DOMRect | null {
        return this.open ? this.panel.getBoundingClientRect() : null;
    }

    /**
     * Yön + yükseklik player'a göre: kompakt düzende (buton üst bardaysa) aşağı açılır; her iki yönde de
     * yükseklik player içinde kalan alanla sınırlı — küçük player'da menü dışarı taşmaz, kendi içinde kayar.
     */
    private readonly fitToPlayer = (): void => {
        if (!this.open) return;
        const area = this.el.closest('.video-area');
        if (!area) return;
        // İnce ses çubuğu (~80 px): menü player'ın içine sığmaz — sayfaya taşarak açılır (yukarı, yer yoksa aşağı).
        if ((this.el.getRootNode() as ShadowRoot).host?.hasAttribute('data-audio-compact')) {
            this.fitToViewport();
            return;
        }
        const a = area.getBoundingClientRect();
        const b = this.button.getBoundingClientRect();
        const anchor = this.el.getBoundingClientRect();
        const drop = !!this.el.closest('.hp-top-bar');
        this.panel.toggleAttribute('data-drop', drop);
        Object.assign(this.panel.style, { top: '', bottom: '', marginTop: '', marginBottom: '' });

        const content = this.panel.scrollHeight;
        const room = (drop ? a.bottom - b.bottom : b.top - a.top) - MENU_GAP_PX - MENU_EDGE_PX;
        if (content <= room || room >= MENU_MIN_HEIGHT_PX) {
            this.panel.style.maxHeight = `${Math.min(MENU_MAX_HEIGHT_PX, room)}px`;
            return;
        }
        // Butonun yanında yer yok (küçük player) — menü player'ın kenarından başlayıp tüm yüksekliği kullanır.
        this.panel.style.maxHeight = `${Math.min(MENU_MAX_HEIGHT_PX, a.height - 2 * MENU_EDGE_PX)}px`;
        if (drop) Object.assign(this.panel.style, { top: `${a.top + MENU_EDGE_PX - anchor.top}px`, marginTop: '0' });
        else Object.assign(this.panel.style, { bottom: `${anchor.bottom - (a.bottom - MENU_EDGE_PX)}px`, marginBottom: '0' });
    };

    private fitToViewport(): void {
        const b = this.button.getBoundingClientRect();
        Object.assign(this.panel.style, { top: '', bottom: '', marginTop: '', marginBottom: '' });
        const content = this.panel.scrollHeight;
        const up = b.top - MENU_GAP_PX - MENU_EDGE_PX;
        const down = window.innerHeight - b.bottom - MENU_GAP_PX - MENU_EDGE_PX;
        const drop = up < Math.min(content, MENU_MAX_HEIGHT_PX) && down > up;
        this.panel.toggleAttribute('data-drop', drop);
        this.panel.style.maxHeight = `${Math.max(MENU_MIN_HEIGHT_PX, Math.min(MENU_MAX_HEIGHT_PX, drop ? down : up))}px`;
    }

    /** Düzen değişince (ör. kompakt ↔ normal) açık menüyü kapat — eski konumunda asılı kalmasın. */
    closeMenu(): void {
        if (this.open) this.close();
    }

    private close(): void {
        this.open = false;
        this.quickOwner = null;
        this.panel.classList.add('hp:hidden');
        this.onOpenChange?.(false);
    }

    /** PiP penceresi gibi ek bir belgede de dışarı tıklayınca kapansın. */
    readonly onDocumentClick = (e: MouseEvent): void => {
        // composedPath(): Shadow DOM'da e.target host'a retarget edilir; contains() menünün kendi satırlarını "dışarı tıklama" sanardı.
        if (this.open && !e.composedPath().includes(this.el)) this.close();
    };

    /** Metinler textContent ile yazılır (manifest / eklenti etiketleri HTML olarak çalışmasın); ikonlar düğüm olarak gelir. */
    private row(label: string, value: string | Node | Array<string | Node>, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'hp:flex hp:items-center hp:justify-between hp:w-full hp:px-3 hp:py-2 hp:text-left hp:bg-transparent hp:border-0 hp:cursor-pointer hp:text-on-surface hp:hover:bg-on-surface/10';
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        const valueEl = document.createElement('span');
        valueEl.className = 'hp:text-on-surface-muted hp:text-xs hp:flex hp:items-center hp:gap-1';
        valueEl.append(...(Array.isArray(value) ? value : [value]));
        btn.append(labelEl, valueEl);
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
        else if (this.currentPanel === 'captions-settings') this.renderCaptionSettings();
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
        // `playbackRates: []` → hız satırı yok.
        if (this.playbackRates.length) {
            this.panel.appendChild(
                this.row(this.labels.playbackSpeed, this.video.playbackRate === 1 ? this.labels.normal : `${this.video.playbackRate}x`, () => {
                    this.currentPanel = 'speed';
                    this.renderSpeed();
                })
            );
        }
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
        for (const toggle of this.toggles.values()) {
            this.panel.appendChild(
                this.row(toggle.label, toggle.getValueLabel(), () => {
                    toggle.onToggle();
                    this.renderMain();
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

    /** İç içe alt menüde geri dönülecek üst menüler (en üstteki = açık olanın bir üstü). */
    private submenuStack: SettingsSubmenuDef[] = [];

    private renderSubmenu(def: SettingsSubmenuDef, parents: SettingsSubmenuDef[] = []): void {
        this.submenuStack = parents;
        this.panel.innerHTML = '';
        this.panel.appendChild(
            this.backRow(def.title, () => {
                const parent = parents[parents.length - 1];
                if (parent) this.renderSubmenu(parent, parents.slice(0, -1));
                else this.renderMain();
            })
        );
        for (const item of def.getItems()) {
            const value = item.children ? iconEl('hp-icon-chevron-left hp-chevron-forward') : item.active ? checkIcon() : '';
            const row = this.row(item.label, item.value !== undefined ? (item.children ? [item.value, value] : item.value) : value, () => {
                if (item.children) {
                    this.renderSubmenu(item.children(), [...parents, def]);
                    return;
                }
                item.onSelect();
                if (item.keepOpen) this.renderSubmenu(def, parents);
                else this.close();
            });
            this.panel.appendChild(row);
        }
    }

    private renderSpeed(): void {
        this.panel.innerHTML = '';
        this.panel.appendChild(this.backRow(this.labels.playbackSpeed, () => this.renderMain()));
        for (const rate of this.playbackRates) {
            const active = this.video.playbackRate === rate;
            const btn = this.row(rate === 1 ? this.labels.normal : `${rate}x`, active ? checkIcon() : '', () => {
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
            const row = this.row(q.label, q.locked ? lockIcon() : active ? checkIcon() : '', () => {
                q.onSelect();
                this.close();
            });
            if (q.locked) row.setAttribute('data-locked', '');
            this.panel.appendChild(row);
        }
    }

    private renderCaptions(): void {
        this.panel.innerHTML = '';
        this.panel.appendChild(this.backRow(this.labels.captions, () => this.renderMain()));
        for (const c of this.captions) {
            const active = c.label === this.activeCaptionLabel;
            this.panel.appendChild(
                this.row(c.label, active ? checkIcon() : '', () => {
                    c.onSelect();
                    this.close();
                })
            );
        }
        // Görünüm ayarları ayrı bir (3.) panelde — dil listesi sade kalsın. Altyazı KAPALIYKEN anlamsız, gizli.
        if (this.captionAppearance && this.activeCaptionLabel !== this.labels.captionsOff) {
            const divider = document.createElement('div');
            divider.className = 'hp:my-1 hp:border-t hp:border-on-surface/10';
            divider.setAttribute('role', 'separator');
            this.panel.appendChild(divider);
            this.panel.appendChild(
                this.row(this.labels.captionSettings, '', () => {
                    this.currentPanel = 'captions-settings';
                    this.renderCaptionSettings();
                })
            );
        }
    }

    /** Altyazı → Altyazı ayarları: boyut, arka plan / yazı rengi, konumu sıfırla — her satırda o anki değer. */
    private renderCaptionSettings(): void {
        this.panel.innerHTML = '';
        this.panel.appendChild(
            this.backRow(this.labels.captionSettings, () => {
                this.currentPanel = 'captions';
                this.renderCaptions();
            })
        );
        const appearance = this.captionAppearance;
        if (!appearance) return;
        const dot = (color: string | undefined): string | Node => {
            if (!color) return '';
            const el = document.createElement('span');
            el.className = 'hp:inline-block hp:w-3 hp:h-3 hp:rounded-full hp:border hp:border-on-surface/30';
            el.style.background = color;
            return el;
        };
        this.panel.appendChild(
            this.row(appearance.sizeLabel, appearance.getSizeOptions().find((o) => o.active)?.label ?? '', () => {
                this.currentPanel = 'captions-size';
                this.renderCaptionsSize();
            })
        );
        this.panel.appendChild(
            this.row(appearance.bgColorLabel, dot(appearance.getBgColorOptions().find((o) => o.active)?.value), () => {
                this.currentPanel = 'captions-bg';
                this.renderCaptionColorPanel('bg');
            })
        );
        this.panel.appendChild(
            this.row(appearance.textColorLabel, dot(appearance.getTextColorOptions().find((o) => o.active)?.value), () => {
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

    private backToCaptionSettings = (): void => {
        this.currentPanel = 'captions-settings';
        this.renderCaptionSettings();
    };

    private renderCaptionsSize(): void {
        this.panel.innerHTML = '';
        const appearance = this.captionAppearance;
        this.panel.appendChild(this.backRow(appearance?.sizeLabel ?? this.labels.captionSize, this.backToCaptionSettings));
        if (!appearance) return;
        for (const item of appearance.getSizeOptions()) {
            this.panel.appendChild(
                this.row(item.label, item.active ? checkIcon() : '', () => {
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
        this.panel.appendChild(this.backRow(title, this.backToCaptionSettings));
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
        for (const ev of ['resize', 'loadedmetadata', 'emptied']) this.video.removeEventListener(ev, this.updateBadge);
        this.panelObserver.disconnect();
        this.quickObserver.disconnect();
    }
}
