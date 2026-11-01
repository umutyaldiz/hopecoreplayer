import type { SponsorshipConfig, SponsorshipOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface SponsorshipContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    /** Logo ve giriş kartının ekleneceği alan (video alanı). */
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    log(entry: { message: string; fatal?: boolean; details?: Record<string, string | number | boolean | undefined> }): void;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_LOGO_WIDTH = 96;
const DEFAULT_INTRO_MS = 3500;
/** API'den gelen tema değerleri → player'ın CSS değişkenleri. */
const THEME_TOKENS: Record<keyof NonNullable<SponsorshipConfig['theme']>, string> = {
    accent: '--hp-color-accent',
    onAccent: '--hp-color-on-accent',
    surface: '--hp-color-surface',
    onSurface: '--hp-color-on-surface',
};
const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

/** Yalnızca http(s) ya da göreli adresler — `javascript:` / `data:` gibi şemalar reddedilir. */
function safeUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const u = new URL(value, document.baseURI);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch {
        return null;
    }
}

function safeColor(value: unknown): string | null {
    return typeof value === 'string' && value.length < 64 && CSS.supports('color', value) ? value : null;
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
    return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** API yanıtını doğrular, geçersiz alanları atar; katman kapalıysa null. */
export function normalizeSponsorship(raw: unknown): SponsorshipConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<SponsorshipConfig>;
    if (r.active !== true || !r.sponsor || typeof r.sponsor.name !== 'string' || !r.sponsor.name.trim()) return null;
    const now = Date.now();
    const from = r.validFrom ? Date.parse(r.validFrom) : NaN;
    const until = r.validUntil ? Date.parse(r.validUntil) : NaN;
    if ((Number.isFinite(from) && now < from) || (Number.isFinite(until) && now > until)) return null;
    const theme: NonNullable<SponsorshipConfig['theme']> = {};
    for (const key of Object.keys(THEME_TOKENS) as Array<keyof typeof THEME_TOKENS>) {
        const c = safeColor(r.theme?.[key]);
        if (c) theme[key] = c;
    }
    const urls = (list: unknown): string[] => (Array.isArray(list) ? list.map(safeUrl).filter((u): u is string => !!u).slice(0, 10) : []);
    return {
        active: true,
        id: typeof r.id === 'string' ? r.id.slice(0, 120) : undefined,
        sponsor: {
            name: r.sponsor.name.slice(0, 80),
            logo: safeUrl(r.sponsor.logo) ?? undefined,
            url: safeUrl(r.sponsor.url) ?? undefined,
        },
        theme,
        logo: {
            position: POSITIONS.includes(r.logo?.position as (typeof POSITIONS)[number]) ? r.logo!.position : 'top-left',
            width: clamp(r.logo?.width, 32, 240, DEFAULT_LOGO_WIDTH),
            opacity: clamp(r.logo?.opacity, 0.2, 1, 0.9),
            label: typeof r.logo?.label === 'string' ? r.logo.label.slice(0, 40) : undefined,
        },
        intro: r.intro
            ? {
                  text: typeof r.intro.text === 'string' ? r.intro.text.slice(0, 120) : undefined,
                  durationMs: clamp(r.intro.durationMs, 1000, 15000, DEFAULT_INTRO_MS),
                  repeatMinutes: typeof r.intro.repeatMinutes === 'number' && r.intro.repeatMinutes > 0 ? Math.min(240, Math.max(1, r.intro.repeatMinutes)) : undefined,
                  maxShows: typeof r.intro.maxShows === 'number' && r.intro.maxShows >= 1 ? Math.min(100, Math.floor(r.intro.maxShows)) : undefined,
              }
            : undefined,
        tracking: { impression: urls(r.tracking?.impression), click: urls(r.tracking?.click), intro: urls(r.tracking?.intro) },
    };
}

/** Takip pikseli: yanıtı beklenmeyen GET (img beacon). */
function fire(urls: string[] | undefined): void {
    for (const u of urls ?? []) {
        const img = new Image();
        img.referrerPolicy = 'no-referrer-when-downgrade';
        img.src = u;
    }
}

/**
 * Sponsorluk katmanı: `endpoint`'ten JSON çeker (SponsorshipConfig), player renklerini değiştirir, köşeye logo koyar,
 * oynatma başlarken "X sunar" kartını gösterir. Canlıda `refreshSeconds` ile kampanya değişimi izlenir. API hatasında
 * son geçerli ayar korunur; hiç alınamadıysa katman kapalı kalır — player normal çalışır.
 */
export class SponsorshipLayer {
    private options: SponsorshipOptions;
    private config: SponsorshipConfig | null = null;
    private logoEl: HTMLAnchorElement | HTMLDivElement | null = null;
    private introEl: HTMLDivElement | null = null;
    private introTimer: ReturnType<typeof setTimeout> | null = null;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    /** Player boyutu / kontrol düzeni değişince logo kontrollerin üstüne binmesin diye yeniden konumlanır. */
    private readonly resizeObserver: ResizeObserver | null;
    /** Uygulanan tema değişkenlerinin önceki satır içi değerleri — katman kalkınca geri yüklenir. */
    private previousTokens = new Map<string, string>();
    /** Gösterim pikseli kampanya başına bir kez. */
    private impressed = new Set<string>();
    /** Kampanya başına giriş gösterim sayısı. */
    private introCount = new Map<string, number>();
    /** Son girişten bu yana gerçek izleme süresi (ms) — intro.repeatMinutes için. */
    private watchedSinceIntro = 0;
    private lastTick = 0;
    private readonly tickTimer: ReturnType<typeof setInterval>;
    private destroyed = false;
    private requestSeq = 0;

    constructor(
        private readonly ctx: SponsorshipContext,
        options: SponsorshipOptions
    ) {
        this.options = options;
        ctx.videoEl.addEventListener('play', this.onPlay);
        ctx.hostEl.addEventListener('hp:adstart', this.onAdStart);
        ctx.hostEl.addEventListener('hp:adend', this.onAdEnd);
        this.lastTick = performance.now();
        this.tickTimer = setInterval(this.tick, 1000);
        this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.positionLogo()) : null;
        this.resizeObserver?.observe(ctx.overlayEl);
        const topBar = ctx.overlayEl.querySelector('.hp-top-bar');
        if (topBar) this.resizeObserver?.observe(topBar);
        void this.load();
        this.scheduleRefresh();
    }

    update(options: SponsorshipOptions): void {
        const changed = options.endpoint !== this.options.endpoint || JSON.stringify(options.params) !== JSON.stringify(this.options.params);
        const refreshChanged = options.refreshSeconds !== this.options.refreshSeconds;
        this.options = options;
        if (changed) void this.load();
        if (refreshChanged) this.scheduleRefresh();
    }

    /** Şu an uygulanan kampanya (yoksa null). */
    get current(): SponsorshipConfig | null {
        return this.config;
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = null;
        const s = this.options.refreshSeconds;
        if (typeof s === 'number' && s >= 10) this.refreshTimer = setInterval(() => void this.load(), s * 1000);
    }

    private buildUrl(): string {
        const u = new URL(this.options.endpoint, document.baseURI);
        for (const [k, v] of Object.entries(this.options.params ?? {})) u.searchParams.set(k, v);
        return u.href;
    }

    private async load(): Promise<void> {
        const seq = ++this.requestSeq;
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = setTimeout(() => ctrl?.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        let url = '';
        try {
            url = this.buildUrl();
            const res = await fetch(url, { ...this.options.fetchInit, signal: ctrl?.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json: unknown = await res.json();
            if (this.destroyed || seq !== this.requestSeq) return; // daha yeni bir istek var
            this.apply(normalizeSponsorship(json));
        } catch (err) {
            if (this.destroyed || seq !== this.requestSeq) return;
            // Son geçerli kampanya korunur — geçici API hatası katmanı söndürmesin.
            this.ctx.log({ message: `Sponsorship API failed: ${String(err)}`, details: { url } });
        } finally {
            clearTimeout(timer);
        }
    }

    private apply(config: SponsorshipConfig | null): void {
        const prevKey = this.key(this.config);
        this.config = config;
        this.applyTheme(config?.theme ?? null);
        this.renderLogo();
        this.ctx.hostEl.toggleAttribute('data-sponsored', !!config);
        if (this.key(config) !== prevKey) {
            this.watchedSinceIntro = 0;
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:sponsorship', { detail: { config } }));
            // Yeni kampanya oynarken geldiyse (canlı yenileme) girişi hemen göster.
            if (config && !this.ctx.videoEl.paused) this.onPlay();
        }
    }

    private key(c: SponsorshipConfig | null): string {
        return c ? c.id || c.sponsor.name : '';
    }

    private applyTheme(theme: SponsorshipConfig['theme'] | null): void {
        const style = this.ctx.hostEl.style;
        // Önce önceki kampanyanın değerlerini geri al.
        for (const [prop, value] of this.previousTokens) {
            if (value) style.setProperty(prop, value);
            else style.removeProperty(prop);
        }
        this.previousTokens.clear();
        if (!theme) return;
        for (const [key, prop] of Object.entries(THEME_TOKENS) as Array<[keyof typeof THEME_TOKENS, string]>) {
            const value = theme[key];
            if (!value) continue;
            this.previousTokens.set(prop, style.getPropertyValue(prop));
            style.setProperty(prop, value);
        }
    }

    private renderLogo(): void {
        this.logoEl?.remove();
        this.logoEl = null;
        const c = this.config;
        if (!c || (!c.sponsor.logo && !c.logo?.label)) return;
        const el = c.sponsor.url ? document.createElement('a') : document.createElement('div');
        el.className = 'hp-sponsor-logo';
        el.setAttribute('part', 'sponsor-logo');
        el.setAttribute('data-position', c.logo?.position ?? 'top-left');
        el.style.setProperty('--hp-sponsor-logo-w', `${c.logo?.width ?? DEFAULT_LOGO_WIDTH}px`);
        el.style.opacity = String(c.logo?.opacity ?? 0.9);
        if (el instanceof HTMLAnchorElement) {
            el.href = c.sponsor.url!;
            el.target = '_blank';
            el.rel = 'noopener sponsored';
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                fire(c.tracking?.click);
                this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:sponsorclick', { detail: { id: c.id, sponsor: c.sponsor.name } }));
            });
        }
        el.setAttribute('aria-label', c.sponsor.name);
        if (c.sponsor.logo) {
            const img = document.createElement('img');
            img.src = c.sponsor.logo;
            img.alt = c.sponsor.name;
            img.decoding = 'async';
            img.addEventListener('error', () => img.remove());
            el.appendChild(img);
        }
        // Etiket logonun altında, ortalı.
        if (c.logo?.label) {
            const label = document.createElement('span');
            label.className = 'hp-sponsor-label';
            label.textContent = c.logo.label;
            el.appendChild(label);
        }
        for (const t of ['pointerdown', 'dblclick'] as const) el.addEventListener(t, (e) => e.stopPropagation());
        this.ctx.overlayEl.appendChild(el);
        this.logoEl = el;
        this.positionLogo();
    }

    /**
     * Logo kontrollerin üstüne binmesin: sağ üstte (dar player'da ayarlar / PiP oraya taşınır) üst çubuğun soluna,
     * altta seek bar'ın hemen üstüne yerleşir. Dar player'da logo en fazla 48 px.
     */
    private positionLogo(): void {
        const el = this.logoEl;
        if (!el) return;
        const area = this.ctx.overlayEl;
        const compact = area.hasAttribute('data-compact');
        const position = el.getAttribute('data-position');
        // Kontroller görünürken kaçınılacak mesafe CSS değişkenine yazılır; kontroller gizliyken CSS logoyu köşeye
        // alır (bkz. :host([data-chrome-hidden])) ve geçiş animasyonlu olur.
        el.style.removeProperty('--hp-sponsor-avoid-right');
        el.style.removeProperty('--hp-sponsor-avoid-bottom');
        el.toggleAttribute('data-compact', compact);
        const a = area.getBoundingClientRect();
        if (position === 'top-right') {
            const bar = area.querySelector('.hp-top-bar')?.getBoundingClientRect();
            if (bar && bar.width > 0) el.style.setProperty('--hp-sponsor-avoid-right', `${Math.round(a.right - bar.left + 8)}px`);
        } else if (position === 'bottom-left' || position === 'bottom-right') {
            const seek = area.querySelector('[part="seek-bar"]')?.getBoundingClientRect();
            if (seek && seek.height > 0) el.style.setProperty('--hp-sponsor-avoid-bottom', `${Math.round(a.bottom - seek.top + 6)}px`);
        }
    }

    /** Oynatma başladı: kampanya başına bir kez gösterim pikseli + "X sunar" kartı. */
    private readonly onPlay = (): void => {
        const c = this.config;
        if (!c) return;
        const key = this.key(c);
        if (!this.impressed.has(key)) {
            this.impressed.add(key);
            fire(c.tracking?.impression);
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:sponsorimpression', { detail: { id: c.id, sponsor: c.sponsor.name } }));
        }
        if (c.intro && !this.introCount.has(key)) this.showIntro(c);
    };

    /**
     * intro.repeatMinutes: yalnızca gerçekten izlenirken sayar (oynuyor, sekme önde, reklam yok); süre dolunca giriş
     * tekrar gösterilir — maxShows'a kadar.
     */
    private readonly tick = (): void => {
        const now = performance.now();
        // Sekme uyuyunca setInterval seyrekleşir — tek seferde en fazla 2 sn sayılır.
        const delta = Math.min(2000, Math.max(0, now - this.lastTick));
        this.lastTick = now;
        const c = this.config;
        const repeat = c?.intro?.repeatMinutes;
        if (!c || !repeat) return;
        const watching =
            !this.ctx.videoEl.paused && !this.ctx.videoEl.ended && !document.hidden && !this.ctx.hostEl.hasAttribute('data-sponsor-hidden');
        if (!watching || !this.introCount.has(this.key(c))) return;
        this.watchedSinceIntro += delta;
        if (this.watchedSinceIntro < repeat * 60_000) return;
        const max = c.intro?.maxShows;
        if (max && (this.introCount.get(this.key(c)) ?? 0) >= max) return;
        this.showIntro(c);
    };

    private showIntro(c: SponsorshipConfig): void {
        const key = this.key(c);
        const count = (this.introCount.get(key) ?? 0) + 1;
        this.introCount.set(key, count);
        this.watchedSinceIntro = 0;
        fire(c.tracking?.intro);
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:sponsorintro', { detail: { id: c.id, sponsor: c.sponsor.name, count } }));
        if (this.introTimer) clearTimeout(this.introTimer);
        this.introEl?.remove();
        const el = document.createElement('div');
        el.className = 'hp-sponsor-intro';
        el.setAttribute('part', 'sponsor-intro');
        el.setAttribute('role', 'status');
        if (c.sponsor.logo) {
            const img = document.createElement('img');
            img.src = c.sponsor.logo;
            img.alt = '';
            img.addEventListener('error', () => img.remove());
            el.appendChild(img);
        }
        const text = document.createElement('span');
        text.textContent = c.intro?.text || this.ctx.i18n.sponsorPresents.replace('{name}', c.sponsor.name);
        el.appendChild(text);
        this.ctx.overlayEl.appendChild(el);
        this.introEl = el;
        // Giriş kartı sponsoru zaten gösteriyor — kart görünürken köşe logosu gizli (küçük player'da üst üste binmesin).
        this.ctx.hostEl.setAttribute('data-sponsor-intro', '');
        this.introTimer = setTimeout(() => {
            el.setAttribute('data-leaving', '');
            this.ctx.hostEl.removeAttribute('data-sponsor-intro');
            this.introTimer = setTimeout(() => {
                el.remove();
                if (this.introEl === el) this.introEl = null;
            }, 400);
        }, c.intro?.durationMs ?? DEFAULT_INTRO_MS);
    }

    /** Lineer reklam sırasında logo / giriş gizlenir (reklamın üstüne binmesin). */
    private readonly onAdStart = (e: Event): void => {
        if ((e as CustomEvent<{ linear?: boolean }>).detail?.linear === false) return;
        this.ctx.hostEl.setAttribute('data-sponsor-hidden', '');
    };

    private readonly onAdEnd = (e: Event): void => {
        if ((e as CustomEvent<{ linear?: boolean }>).detail?.linear === false) return;
        this.ctx.hostEl.removeAttribute('data-sponsor-hidden');
    };

    destroy(): void {
        this.destroyed = true;
        clearInterval(this.tickTimer);
        this.resizeObserver?.disconnect();
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        if (this.introTimer) clearTimeout(this.introTimer);
        this.ctx.videoEl.removeEventListener('play', this.onPlay);
        this.ctx.hostEl.removeEventListener('hp:adstart', this.onAdStart);
        this.ctx.hostEl.removeEventListener('hp:adend', this.onAdEnd);
        this.applyTheme(null);
        this.logoEl?.remove();
        this.introEl?.remove();
        this.ctx.hostEl.removeAttribute('data-sponsored');
        this.ctx.hostEl.removeAttribute('data-sponsor-hidden');
        this.ctx.hostEl.removeAttribute('data-sponsor-intro');
    }
}
