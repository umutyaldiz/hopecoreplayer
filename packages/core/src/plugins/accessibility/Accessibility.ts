import type { AccessibilityFilter, AccessibilityOptions, AccessibilityState } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import type { SettingsSubmenuDef, SettingsSubmenuItem } from '../../controls/SettingsMenu';
import { colorBlindFilterUrl } from './colorBlind';

export interface AccessibilityPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    videoAreaEl: HTMLElement;
    i18n: HopeLocaleStrings;
    registerSubmenu(def: SettingsSubmenuDef): void;
    unregisterSubmenu(key: string): void;
    /** Ayarlar butonunun sağına hızlı erişim butonu (SettingsMenu.addQuickButton). */
    addQuickButton(btn: HTMLButtonElement, getDef: () => SettingsSubmenuDef, getParents: () => SettingsSubmenuDef[]): void;
    /** Klavyeyle sarma adımı (sn) — kısayol listesinde gösterilir. */
    seekStep(): number;
    /** Eklentilerin kısayolları (listeye eklenir). */
    extraShortcuts?(): Array<{ keys: string[]; description: string }>;
}

const DEFAULT_ZOOM = [1, 1.25, 1.5, 2, 3];
const DEFAULT_BOOST = [1, 1.5, 2, 3];
const ALL_FILTERS: AccessibilityFilter[] = ['none', 'grayscale', 'daylight', 'night', 'contrast', 'protanopia', 'deuteranopia', 'tritanopia'];
const STORAGE_KEY = 'hp-accessibility';
/** Shift + ok ile bir adımda kaydırma (yakınlaştırılmış alanın oranı). */
const PAN_STEP = 0.15;
const SUBMENU_KEY = 'accessibility';
/** Bundan fazla kayan basış sürükleme sayılır — ardından gelen tık yutulur. */
const DRAG_THRESHOLD_PX = 6;
/**
 * Bunların üstünde başlayan sürükleme / iki parmak görüntüyü kaydırmaz (butonlar, ilerleme çubuğu, menüler). Ortadaki
 * oynat butonu hariç: duraklatılmışken bütün alanı kaplıyor — onun üstünde de kaydırılabilmeli.
 */
const CONTROL_SELECTOR = 'button:not(.hp-center-play), a, input, [role="slider"], [part="control-bar"], .hp-chip, .hp-chip-panel, .hp-shortcuts, .hp-top-bar';

/** CSS filtreleri. Renk körlüğü filtreleri SVG renk matrisi (daltonizasyon) — bkz. colorBlind.ts. */
const CSS_FILTERS: Record<AccessibilityFilter, string> = {
    none: '',
    grayscale: 'grayscale(1)',
    // Aydınlık ortamda (gün ışığında ekran) seçilebilirlik: daha parlak, daha kontrastlı.
    daylight: 'brightness(1.18) contrast(1.18) saturate(1.1)',
    // Gece: sıcak ton, mavi ışık azaltılmış, biraz karartılmış.
    night: 'sepia(0.4) saturate(1.15) hue-rotate(-12deg) brightness(0.9)',
    contrast: 'contrast(1.55) saturate(1.25)',
    protanopia: '',
    deuteranopia: '',
    tritanopia: '',
};

type QuickId = 'zoom' | 'filter' | 'mono' | 'boost' | 'largeControls';

/** Hızlı erişim butonlarının ikonları (satır içi SVG — ikon fontunda karşılıkları yok). */
const svg = (body: string): string =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:var(--hp-ctrl-icon-size);height:var(--hp-ctrl-icon-size)">${body}</svg>`;
const QUICK_ICONS: Record<QuickId, string> = {
    // Büyüteç + artı
    zoom: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5l-4.9-4.9M11 8.2v5.6M8.2 11h5.6"/>'),
    // Yarısı dolu daire (renk / kontrast)
    filter: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>'),
    // Tek dalgalı hoparlör + "1"
    mono: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M19 8.5v7"/>'),
    // Hoparlör + artı
    boost: svg('<path d="M3 9.5h3.5L11 5.5v13l-4.5-4H3z"/><path d="M14.5 12h6M17.5 9v6"/>'),
    // Büyüyen kare (dışa oklar)
    largeControls: svg('<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.2"/>'),
};
interface AudioGraph {
    ctx: AudioContext;
    gain: GainNode;
}

/**
 * Erişilebilirlik alt menüsü: yakınlaştırma (sürükle / Shift+ok / iki parmak), görüntü filtreleri, mono ses, ses
 * güçlendirme (Web Audio), büyük kontroller ve klavye kısayolları paneli (`?`). Seçimler tarayıcıda hatırlanır.
 */
export class Accessibility {
    private readonly state: AccessibilityState = { zoom: 1, filter: 'none', mono: false, boost: 1, largeControls: false };
    private readonly zoomLevels: number[];
    private readonly boostLevels: number[];
    private readonly filters: AccessibilityFilter[];
    /** Kaydırma — her eksende -1…1 (yakınlaştırılmış görüntünün kenarına kadar). */
    private panX = 0;
    private panY = 0;
    private graph: AudioGraph | null = null;
    private shortcutsEl: HTMLDivElement | null = null;
    private drag: { id: number; x: number; y: number; panX: number; panY: number } | null = null;
    private readonly touches = new Map<number, { x: number; y: number }>();
    private pinch: { dist: number; zoom: number } | null = null;
    private readonly quickButtons = new Map<QuickId, HTMLButtonElement>();

    constructor(
        private readonly ctx: AccessibilityPlayerContext,
        private readonly options: AccessibilityOptions
    ) {
        this.zoomLevels = options.zoom === false ? [] : normalizeLevels(Array.isArray(options.zoom) ? options.zoom : DEFAULT_ZOOM);
        this.boostLevels = options.audio === false ? [] : normalizeLevels(options.boostLevels ?? DEFAULT_BOOST);
        this.filters = options.filters === false ? [] : Array.isArray(options.filters) ? ['none', ...options.filters.filter((f) => f !== 'none' && f in CSS_FILTERS)] : ALL_FILTERS;

        this.restore();
        ctx.registerSubmenu(this.menu());
        ctx.hostEl.addEventListener('keydown', this.onKeyDown, true);
        if (this.zoomLevels.length > 1) {
            // Video alanının tamamı (oynat butonu / altyazı katmanı videonun üstünde) — kontrollerden başlayan sürükleme hariç.
            const area = ctx.videoAreaEl;
            area.addEventListener('pointerdown', this.onPointerDown);
            area.addEventListener('pointermove', this.onPointerMove);
            area.addEventListener('pointerup', this.onPointerUp);
            area.addEventListener('pointercancel', this.onPointerUp);
            window.addEventListener('resize', this.applyZoom);
        }
        ctx.videoEl.addEventListener('play', this.resumeAudio);
        this.applyAll();
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        this.ctx.unregisterSubmenu(SUBMENU_KEY);
        this.ctx.hostEl.removeEventListener('keydown', this.onKeyDown, true);
        const area = this.ctx.videoAreaEl;
        area.removeEventListener('pointerdown', this.onPointerDown);
        area.removeEventListener('pointermove', this.onPointerMove);
        area.removeEventListener('pointerup', this.onPointerUp);
        area.removeEventListener('pointercancel', this.onPointerUp);
        v.removeEventListener('play', this.resumeAudio);
        window.removeEventListener('resize', this.applyZoom);
        this.closeShortcuts();
        for (const btn of this.quickButtons.values()) btn.remove();
        this.quickButtons.clear();
        Object.assign(v.style, { transform: '', transformOrigin: '', filter: '', touchAction: '' });
        this.ctx.hostEl.removeAttribute('data-large-controls');
        this.ctx.hostEl.removeAttribute('data-zoomed');
        // Web Audio grafiği geri alınamaz (createMediaElementSource kalıcı) — nötr değerlere çekilir.
        if (this.graph) {
            this.state.mono = false;
            this.state.boost = 1;
            this.applyAudio();
        }
    }

    /** Dil değişince alt menü yeni etiketlerle yeniden kaydedilir. */
    refreshLabels(): void {
        this.ctx.registerSubmenu(this.menu());
        this.syncQuickButtons();
        if (this.shortcutsEl) {
            this.closeShortcuts();
            this.openShortcuts();
        }
    }

    // ── Menü ──

    private menu(): SettingsSubmenuDef {
        const t = this.ctx.i18n;
        return {
            key: SUBMENU_KEY,
            title: t.a11yMenu,
            getValueLabel: () => '',
            getItems: () => {
                const items: SettingsSubmenuItem[] = [];
                const sub = (label: string, value: string, children: () => SettingsSubmenuDef): SettingsSubmenuItem => ({ label, value, active: false, onSelect: () => {}, children });
                if (this.zoomLevels.length > 1) items.push(sub(t.a11yZoom, pct(this.state.zoom), () => this.zoomDef()));
                if (this.filters.length > 1) items.push(sub(t.a11yFilter, this.filterLabel(this.state.filter), () => this.filterDef()));
                if (this.boostLevels.length) {
                    const ok = this.audioAllowed();
                    items.push({
                        label: t.a11yMono,
                        value: ok ? (this.state.mono ? t.a11yOn : t.a11yOff) : t.a11yUnavailable,
                        active: this.state.mono,
                        keepOpen: true,
                        onSelect: () => {
                            if (ok) this.set('mono', !this.state.mono);
                        },
                    });
                    if (this.boostLevels.length > 1) items.push(sub(t.a11yBoost, ok ? pct(this.state.boost) : t.a11yUnavailable, () => this.boostDef()));
                }
                if (this.options.largeControls !== false)
                    items.push({
                        label: t.a11yLargeControls,
                        value: this.state.largeControls ? t.a11yOn : t.a11yOff,
                        active: this.state.largeControls,
                        keepOpen: true,
                        onSelect: () => this.set('largeControls', !this.state.largeControls),
                    });
                if (this.options.shortcuts !== false)
                    items.push({ label: t.a11yShortcuts, value: '?', active: false, onSelect: () => queueMicrotask(() => this.openShortcuts()) });
                return items;
            },
        };
    }

    // Özelliklerin kendi alt menüleri — hem Erişilebilirlik menüsünden hem hızlı erişim butonlarından açılır.

    private zoomDef(): SettingsSubmenuDef {
        return {
            key: 'a11y-zoom',
            title: this.ctx.i18n.a11yZoom,
            getValueLabel: () => '',
            getItems: () => this.zoomLevels.map((z) => ({ label: pct(z), active: Math.abs(this.state.zoom - z) < 0.001, onSelect: () => this.setZoom(z) })),
        };
    }

    private filterDef(): SettingsSubmenuDef {
        return {
            key: 'a11y-filter',
            title: this.ctx.i18n.a11yFilter,
            getValueLabel: () => '',
            getItems: () => this.filters.map((f) => ({ label: this.filterLabel(f), active: this.state.filter === f, onSelect: () => this.set('filter', f) })),
        };
    }

    private boostDef(): SettingsSubmenuDef {
        return {
            key: 'a11y-boost',
            title: this.ctx.i18n.a11yBoost,
            getValueLabel: () => '',
            getItems: () => (this.audioAllowed() ? this.boostLevels.map((b) => ({ label: pct(b), active: this.state.boost === b, onSelect: () => this.set('boost', b) })) : []),
        };
    }

    /** Aç / kapa özellikleri (mono, büyük kontroller) için hızlı butonun açtığı iki satırlık menü. */
    private toggleDef(key: 'mono' | 'largeControls', title: string): SettingsSubmenuDef {
        const t = this.ctx.i18n;
        return {
            key: `a11y-${key}`,
            title,
            getValueLabel: () => '',
            getItems: () => [
                { label: t.a11yOn, active: this.state[key], onSelect: () => this.set(key, true) },
                { label: t.a11yOff, active: !this.state[key], onSelect: () => this.set(key, false) },
            ],
        };
    }

    // ── Hızlı erişim butonları ──

    /**
     * Açık olan her özelliğin ayarlar butonunun sağında kendi butonu olur; basınca doğrudan o özelliğin ayarları açılır
     * (yakınlaştırma seviyeleri, filtre listesi…). Özellik kapanınca buton kalkar. "Geri" Erişilebilirlik menüsüne döner.
     */
    private syncQuickButtons(): void {
        const t = this.ctx.i18n;
        const s = this.state;
        const specs: { id: QuickId; on: boolean; label: string; def: () => SettingsSubmenuDef }[] = [
            { id: 'zoom', on: s.zoom > 1.001, label: `${t.a11yZoom}: ${pct(s.zoom)}`, def: () => this.zoomDef() },
            { id: 'filter', on: s.filter !== 'none', label: `${t.a11yFilter}: ${this.filterLabel(s.filter)}`, def: () => this.filterDef() },
            { id: 'mono', on: s.mono, label: `${t.a11yMono}: ${t.a11yOn}`, def: () => this.toggleDef('mono', t.a11yMono) },
            { id: 'boost', on: s.boost !== 1, label: `${t.a11yBoost}: ${pct(s.boost)}`, def: () => this.boostDef() },
            { id: 'largeControls', on: s.largeControls, label: `${t.a11yLargeControls}: ${t.a11yOn}`, def: () => this.toggleDef('largeControls', t.a11yLargeControls) },
        ];
        for (const spec of specs) {
            let btn = this.quickButtons.get(spec.id);
            if (!spec.on) {
                btn?.remove();
                this.quickButtons.delete(spec.id);
                continue;
            }
            if (!btn) {
                btn = document.createElement('button');
                btn.type = 'button';
                btn.className =
                    'hp-chip hp-a11y-quick hp:flex hp:items-center hp:justify-center hp:w-[var(--hp-ctrl-btn-size)] hp:h-[var(--hp-ctrl-btn-size)] hp:cursor-pointer';
                btn.setAttribute('part', `a11y-quick a11y-quick-${spec.id}`);
                btn.setAttribute('data-a11y', spec.id);
                btn.innerHTML = QUICK_ICONS[spec.id];
                this.ctx.addQuickButton(btn, spec.def, () => [this.menu()]);
                this.quickButtons.set(spec.id, btn);
            }
            // Tooltip ve ekran okuyucu: özelliğin adı + değeri ("Yakınlaştırma: 200%").
            btn.setAttribute('aria-label', spec.label);
        }
    }
    private filterLabel(f: AccessibilityFilter): string {
        const t = this.ctx.i18n;
        const labels: Record<AccessibilityFilter, string> = {
            none: t.a11yFilterNone,
            grayscale: t.a11yFilterGrayscale,
            daylight: t.a11yFilterDaylight,
            night: t.a11yFilterNight,
            contrast: t.a11yFilterContrast,
            protanopia: t.a11yFilterProtanopia,
            deuteranopia: t.a11yFilterDeuteranopia,
            tritanopia: t.a11yFilterTritanopia,
        };
        return labels[f];
    }

    // ── Durum ──

    private set<K extends keyof AccessibilityState>(key: K, value: AccessibilityState[K]): void {
        if (this.state[key] === value) return;
        this.state[key] = value;
        this.applyAll();
        this.save();
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:accessibility', { detail: { ...this.state, changed: key } }));
    }

    private setZoom(z: number): void {
        if (z <= 1) {
            this.panX = 0;
            this.panY = 0;
        }
        this.set('zoom', z);
    }

    private applyAll(): void {
        this.applyZoom();
        this.applyFilter();
        this.applyAudio();
        this.ctx.hostEl.toggleAttribute('data-large-controls', this.state.largeControls);
        this.syncQuickButtons();
    }

    private readonly applyZoom = (): void => {
        const v = this.ctx.videoEl;
        const z = this.state.zoom;
        this.ctx.hostEl.toggleAttribute('data-zoomed', z > 1);
        if (this.zoomLevels.length > 1) {
            // Yakınlaştırılmamışken sayfa kaydırması serbest, tarayıcının kendi iki parmak büyütmesi kapalı (bizimki çalışsın);
            // yakınlaştırılmışken sürükleme görüntüyü kaydırır.
            v.style.touchAction = z > 1 ? 'none' : 'pan-x pan-y';
        }
        if (z <= 1) {
            v.style.transform = '';
            return;
        }
        // Kenar dışına kaydırılamaz: en fazla (z-1)/2 genişlik kadar.
        const maxX = ((z - 1) * v.clientWidth) / 2;
        const maxY = ((z - 1) * v.clientHeight) / 2;
        v.style.transformOrigin = 'center center';
        v.style.transform = `translate(${(-this.panX * maxX).toFixed(1)}px, ${(-this.panY * maxY).toFixed(1)}px) scale(${z})`;
    };

    private applyFilter(): void {
        const f = this.state.filter;
        this.ctx.videoEl.style.filter = f === 'protanopia' || f === 'deuteranopia' || f === 'tritanopia' ? colorBlindFilterUrl(f) : CSS_FILTERS[f];
    }

    // ── Ses (Web Audio) ──

    /**
     * Web Audio kaynağı başka alan adındaysa ve CORS'la yüklenmediyse tarayıcı sesi sıfırlar — o zaman kapalı kalır.
     * blob: (hls.js / MSE; hls.js zaten CORS'la indirir) ve aynı origin güvenli.
     */
    private audioAllowed(): boolean {
        if (typeof AudioContext === 'undefined') return false;
        const src = this.ctx.videoEl.currentSrc;
        if (!src || src.startsWith('blob:') || src.startsWith('data:')) return true;
        try {
            if (new URL(src, location.href).origin === location.origin) return true;
        } catch {
            return false;
        }
        return this.ctx.videoEl.crossOrigin !== null;
    }

    private applyAudio(): void {
        const needed = this.state.mono || this.state.boost !== 1;
        if (!needed && !this.graph) return;
        if (!this.graph) {
            if (!this.audioAllowed()) return;
            try {
                const ctx = new AudioContext();
                const source = ctx.createMediaElementSource(this.ctx.videoEl);
                const gain = ctx.createGain();
                source.connect(gain).connect(ctx.destination);
                this.graph = { ctx, gain };
            } catch {
                return;
            }
        }
        const { gain, ctx } = this.graph;
        gain.gain.value = this.state.boost;
        // Mono: kanalları 'speakers' kuralıyla tek kanala indir ((L+R)/2); çıkış iki hoparlöre aynı gider.
        gain.channelCountMode = this.state.mono ? 'explicit' : 'max';
        gain.channelCount = this.state.mono ? 1 : 2;
        gain.channelInterpretation = 'speakers';
        if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    }

    private readonly resumeAudio = (): void => {
        if (this.graph?.ctx.state === 'suspended') void this.graph.ctx.resume().catch(() => {});
    };

    // ── Kalıcılık ──

    private restore(): void {
        if (this.options.remember === false) return;
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<AccessibilityState> | null;
            if (!saved) return;
            if (saved.filter && this.filters.includes(saved.filter)) this.state.filter = saved.filter;
            if (typeof saved.mono === 'boolean' && this.boostLevels.length) this.state.mono = saved.mono;
            if (typeof saved.boost === 'number' && this.boostLevels.includes(saved.boost)) this.state.boost = saved.boost;
            if (typeof saved.largeControls === 'boolean' && this.options.largeControls !== false) this.state.largeControls = saved.largeControls;
            // Yakınlaştırma bilerek hatırlanmaz — bir sonraki videoda kadrajı kaçırmasın.
        } catch {
            /* gizli sekme / bozuk kayıt — varsayılanlar */
        }
    }

    private save(): void {
        if (this.options.remember === false) return;
        try {
            const { filter, mono, boost, largeControls } = this.state;
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ filter, mono, boost, largeControls }));
        } catch {
            /* depolama yok — yalnızca bu oturum */
        }
    }

    // ── Yakınlaştırma: sürükle, iki parmak ──

    private readonly onPointerDown = (e: PointerEvent): void => {
        const target = e.composedPath()[0];
        if (target instanceof Element && target.closest(CONTROL_SELECTOR)) return;
        if (e.pointerType === 'touch') {
            this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (this.touches.size === 2) {
                this.pinch = { dist: this.touchDistance(), zoom: this.state.zoom };
                this.drag = null;
                return;
            }
        }
        if (this.state.zoom <= 1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinch && this.touches.size === 2) {
            const max = this.zoomLevels[this.zoomLevels.length - 1]!;
            const z = Math.min(max, Math.max(1, (this.pinch.zoom * this.touchDistance()) / this.pinch.dist));
            this.state.zoom = Math.round(z * 100) / 100;
            if (this.state.zoom <= 1) this.panX = this.panY = 0;
            this.applyZoom();
            return;
        }
        if (!this.drag || this.drag.id !== e.pointerId) return;
        const v = this.ctx.videoEl;
        const z = this.state.zoom;
        const maxX = ((z - 1) * v.clientWidth) / 2 || 1;
        const maxY = ((z - 1) * v.clientHeight) / 2 || 1;
        // Görüntü parmağı / imleci takip eder (sağa sürükle → görüntü sağa → sol taraf görünür).
        this.panX = clamp(this.drag.panX - (e.clientX - this.drag.x) / maxX);
        this.panY = clamp(this.drag.panY - (e.clientY - this.drag.y) / maxY);
        this.applyZoom();
    };

    private readonly onPointerUp = (e: PointerEvent): void => {
        this.touches.delete(e.pointerId);
        if (this.pinch && this.touches.size < 2) {
            this.pinch = null;
            this.syncQuickButtons();
            // İki parmakla serbest büyütme bitince olay / kayıt bir kez.
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:accessibility', { detail: { ...this.state, changed: 'zoom' } }));
        }
        if (this.drag?.id === e.pointerId) {
            // Gerçekten sürüklendiyse ardından gelen tık oynat / duraklat sayılmasın (oynat butonu bütün alanı kaplayabiliyor).
            if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > DRAG_THRESHOLD_PX) this.swallowNextClick();
            this.drag = null;
        }
    };

    private swallowNextClick(): void {
        const area = this.ctx.videoAreaEl;
        const swallow = (ev: Event): void => {
            ev.stopPropagation();
            ev.preventDefault();
        };
        area.addEventListener('click', swallow, { capture: true, once: true });
        // Tık hiç gelmezse (ör. dokunmatik) sonraki gerçek tık yutulmasın.
        setTimeout(() => area.removeEventListener('click', swallow, { capture: true }), 400);
    }

    private touchDistance(): number {
        const [a, b] = [...this.touches.values()];
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) || 1 : 1;
    }

    // ── Klavye ──

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
        if (this.shortcutsEl && e.key === 'Escape') {
            e.preventDefault();
            this.closeShortcuts();
            return;
        }
        if (e.key === '?' && this.options.shortcuts !== false) {
            e.preventDefault();
            if (this.shortcutsEl) this.closeShortcuts();
            else this.openShortcuts();
            return;
        }
        if (this.zoomLevels.length < 2) return;
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            this.setZoom(this.zoomLevels.find((z) => z > this.state.zoom + 0.001) ?? this.state.zoom);
        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            this.setZoom([...this.zoomLevels].reverse().find((z) => z < this.state.zoom - 0.001) ?? 1);
        } else if (e.key === '0' && this.state.zoom > 1) {
            e.preventDefault();
            this.setZoom(1);
        } else if (e.shiftKey && this.state.zoom > 1 && e.key.startsWith('Arrow')) {
            // Shift + ok: yakınlaştırılmış görüntüde gezin (oklar tek başına sarma / ses olarak kalır).
            e.preventDefault();
            if (e.key === 'ArrowLeft') this.panX = clamp(this.panX - PAN_STEP);
            if (e.key === 'ArrowRight') this.panX = clamp(this.panX + PAN_STEP);
            if (e.key === 'ArrowUp') this.panY = clamp(this.panY - PAN_STEP);
            if (e.key === 'ArrowDown') this.panY = clamp(this.panY + PAN_STEP);
            this.applyZoom();
        }
    };

    // ── Kısayol paneli ──

    private openShortcuts(): void {
        if (this.shortcutsEl) return;
        const t = this.ctx.i18n;
        const el = document.createElement('div');
        el.className = 'hp-shortcuts';
        el.setAttribute('part', 'shortcuts');
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'hp-shortcuts-title');

        const box = document.createElement('div');
        box.className = 'hp-shortcuts-box';
        const head = document.createElement('div');
        head.className = 'hp-shortcuts-head';
        const title = document.createElement('h2');
        title.id = 'hp-shortcuts-title';
        title.textContent = t.a11yShortcuts;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'hp-shortcuts-close';
        close.setAttribute('aria-label', t.a11yClose);
        close.textContent = '✕';
        close.addEventListener('click', () => this.closeShortcuts());
        head.append(title, close);

        const rows: [string[], string][] = [
            [['Space', 'K'], t.a11yKeyPlay],
            [['←', '→', 'J', 'L'], t.a11yKeySeek(this.ctx.seekStep())],
            [['↑', '↓'], t.a11yKeyVolume],
            [['M'], t.a11yKeyMute],
            [['F'], t.a11yKeyFullscreen],
            [[',', '.'], t.a11yKeyFrame],
        ];
        if (this.zoomLevels.length > 1) {
            rows.push([['+', '−', '0'], t.a11yKeyZoom]);
            rows.push([['Shift', '+', '←↑↓→'], t.a11yKeyPan]);
        }
        for (const s of this.ctx.extraShortcuts?.() ?? []) rows.push([s.keys, s.description]);
        rows.push([['?'], t.a11yKeyShortcuts]);

        const list = document.createElement('dl');
        list.className = 'hp-shortcuts-list';
        for (const [keys, desc] of rows) {
            const dt = document.createElement('dt');
            for (const k of keys) {
                if (k === '+' && keys[0] === 'Shift') {
                    dt.append(' + ');
                    continue;
                }
                const kbd = document.createElement('kbd');
                kbd.textContent = k;
                dt.appendChild(kbd);
            }
            const dd = document.createElement('dd');
            dd.textContent = desc;
            list.append(dt, dd);
        }
        box.append(head, list);
        el.appendChild(box);
        // Arka plana tıklama kapatır; panelin içindeki tıklama oynat/duraklat'a geçmez.
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target === el) this.closeShortcuts();
        });
        for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
        // Odak paneli terk etmesin (Tab tek butonda kalır).
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                close.focus();
            }
        });
        this.ctx.videoAreaEl.appendChild(el);
        this.shortcutsEl = el;
        close.focus({ preventScroll: true });
    }

    private closeShortcuts(): void {
        if (!this.shortcutsEl) return;
        const hadFocus = this.shortcutsEl.contains((this.ctx.hostEl.shadowRoot ?? document).activeElement);
        this.shortcutsEl.remove();
        this.shortcutsEl = null;
        if (hadFocus) this.ctx.hostEl.focus({ preventScroll: true });
    }
}

function normalizeLevels(levels: number[]): number[] {
    const valid = levels.filter((n) => Number.isFinite(n) && n >= 1 && n <= 8);
    return [...new Set([1, ...valid])].sort((a, b) => a - b);
}

const clamp = (n: number): number => Math.min(1, Math.max(-1, n));
const pct = (n: number): string => `${Math.round(n * 100)}%`;
