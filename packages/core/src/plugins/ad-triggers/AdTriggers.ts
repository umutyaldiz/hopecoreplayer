import type { AdTrigger, AdTriggerLayout, AdTriggerRule, AdTriggersConfig, AdTriggersOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { firePixels as fire } from '../shared/trackingPixel';
import { loadGpt, type GoogleTag, type GptSlot, type GptSlotRenderEndedEvent } from '../pause-ad/loadGpt';

export interface AdTriggersContext {
    /** Light DOM sahibi: GPT reklam div'ini id ile bulabilsin diye div buraya eklenir (tam ekranda da görünür). */
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    /** Reklam kutusunun ekleneceği alan (video alanı). */
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    log(entry: { message: string; fatal?: boolean; details?: Record<string, string | number | boolean | undefined> }): void;
    /** Video reklamı (IMA) oynuyor ya da giriş ekranı (geri sayım / geo) açık — bu sırada istenmez. */
    isBlocked(): boolean;
    isFullscreen(): boolean;
    /** iPhone'un kendi video tam ekranı — player katmanları orada görünmez, reklam istenmez. */
    isNativeFullscreen(): boolean;
    /** İçerik kimliği — kalite değişimi / yedek kaynak aynı içerik sayılır; değişince sayaçlar sıfırlanır. */
    contentKey(): string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RENDER_TIMEOUT_MS = 8000;
const DEFAULT_GLOBAL_GAP_S = 30;
const LAYOUTS: AdTriggerLayout[] = ['none', 'full', 'center', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const TRIGGER_TYPES = ['time', 'interval', 'percent', 'fullscreen', 'fullscreenExit', 'start', 'pause', 'resume', 'ended'] as const;
/** Doğal ilerleme sayılan en büyük timeupdate adımı (sn) — daha büyük sıçrama ileri sarmadır, aradaki anlar atlanır. */
const MAX_NATURAL_STEP_S = 1.5;
let instanceCount = 0;

function safeUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const u = new URL(value, document.baseURI);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch {
        return null;
    }
}

const num = (n: unknown, min: number, max: number): number | undefined =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;

type KeyValues = Record<string, string | string[]>;
const prim = (v: unknown): string | null =>
    typeof v === 'string' ? v.slice(0, 200) : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? String(v) : null;

/**
 * Ad Manager key-value'ları (GPT slot hedeflemesi = VAST tag'lerindeki `cust_params`): JSON nesnesi
 * `{ "kategori": "spor", "etiket": ["mac", "ozet"], "sezon": 2026 }` ya da `"kategori=spor&etiket=mac,ozet"` metni.
 * Sayı / boolean metne çevrilir; geçersiz anahtar ve değerler atılır.
 */
export function parseCustParams(raw: unknown): KeyValues | undefined {
    let entries: Array<[string, unknown]>;
    if (typeof raw === 'string') {
        if (!raw.trim()) return undefined;
        entries = [...new URLSearchParams(raw.trim().replace(/^\?/, '')).entries()].map(([k, v]) => [k, v.includes(',') ? v.split(',') : v]);
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        entries = Object.entries(raw as Record<string, unknown>);
    } else {
        return undefined;
    }
    const out: KeyValues = {};
    for (const [k, v] of entries.slice(0, 50)) {
        if (!/^[\w.-]{1,40}$/.test(k)) continue;
        if (Array.isArray(v)) {
            const list = v.map(prim).filter((x): x is string => x !== null && x !== '').slice(0, 30);
            if (list.length) out[k] = list;
        } else {
            const one = prim(v);
            if (one !== null && one !== '') out[k] = one;
        }
    }
    return Object.keys(out).length ? out : undefined;
}

function normalizeTrigger(raw: unknown): AdTrigger | null {
    if (!raw || typeof raw !== 'object') return null;
    const t = raw as Record<string, unknown>;
    const type = t.type as (typeof TRIGGER_TYPES)[number];
    if (!TRIGGER_TYPES.includes(type)) return null;
    const list = (v: unknown, min: number, max: number): number[] =>
        (Array.isArray(v) ? v : [v]).map((x) => num(x, min, max)).filter((x): x is number => x !== undefined).slice(0, 50);
    if (type === 'time') {
        const at = list(t.at, 0, 86_400);
        return at.length ? { type, at } : null;
    }
    if (type === 'percent') {
        const at = list(t.at, 1, 99);
        return at.length ? { type, at } : null;
    }
    if (type === 'interval') {
        const every = num(t.every, 10, 86_400);
        return every ? { type, every, startAfter: num(t.startAfter, 0, 86_400) } : null;
    }
    return { type, delay: num(t.delay, 0, 600) };
}

/** API yanıtını doğrular, geçersiz kural/tetikleyicileri atar; modül kapalıysa ya da geçerli kural yoksa null. */
export function normalizeAdTriggers(raw: unknown): AdTriggersConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<AdTriggersConfig>;
    if (r.active !== true || !Array.isArray(r.rules)) return null;
    const now = Date.now();
    const from = r.validFrom ? Date.parse(r.validFrom) : NaN;
    const until = r.validUntil ? Date.parse(r.validUntil) : NaN;
    if ((Number.isFinite(from) && now < from) || (Number.isFinite(until) && now > until)) return null;
    const urls = (list: unknown): string[] => (Array.isArray(list) ? list.map(safeUrl).filter((u): u is string => !!u).slice(0, 10) : []);
    const rules: AdTriggerRule[] = [];
    for (const raw of r.rules.slice(0, 20)) {
        if (!raw || typeof raw !== 'object') continue;
        const x = raw as Partial<AdTriggerRule>;
        // Reklam birimi yolu: "/ağ kodu/birim/..." biçimi.
        if (typeof x.adUnitPath !== 'string' || !/^\/\d+(?:[,/][\w.\-/]*)?$/.test(x.adUnitPath)) continue;
        const triggers = (Array.isArray(x.triggers) ? x.triggers : []).map(normalizeTrigger).filter((t): t is AdTrigger => !!t).slice(0, 20);
        if (!triggers.length) continue;
        const size = Array.isArray(x.size) && x.size.length === 2 ? [num(x.size[0], 1, 4000), num(x.size[1], 1, 4000)] : null;
        const layout = LAYOUTS.includes(x.layout as AdTriggerLayout) ? x.layout! : 'none';
        rules.push({
            id: typeof x.id === 'string' ? x.id.slice(0, 80) : undefined,
            adUnitPath: x.adUnitPath,
            mode: x.mode === 'fullscreen' || x.mode === 'normal' ? x.mode : 'any',
            triggers,
            targeting: parseCustParams(x.targeting),
            // API'lerde yaygın `cust_params` yazımı da kabul edilir.
            custParams: parseCustParams(x.custParams ?? (x as { cust_params?: unknown }).cust_params),
            layout,
            size: size && size[0] && size[1] ? [size[0], size[1]] : undefined,
            backdrop: typeof x.backdrop === 'boolean' ? x.backdrop : layout === 'full',
            pauseContent: x.pauseContent === true,
            closeButton: x.closeButton !== false,
            closeDelay: num(x.closeDelay, 0, 120) ?? 0,
            duration: num(x.duration, 1, 3600),
            label: x.label === false ? false : typeof x.label === 'string' ? x.label.slice(0, 40) : undefined,
            maxShows: num(x.maxShows, 1, 1000),
            minGapSeconds: num(x.minGapSeconds, 0, 86_400),
            minPlayerWidth: num(x.minPlayerWidth, 0, 4000),
            tracking: { impression: urls(x.tracking?.impression), close: urls(x.tracking?.close), empty: urls(x.tracking?.empty) },
        });
    }
    if (!rules.length) return null;
    return {
        active: true,
        id: typeof r.id === 'string' ? r.id.slice(0, 120) : undefined,
        minGapSeconds: num(r.minGapSeconds, 0, 86_400) ?? DEFAULT_GLOBAL_GAP_S,
        rules,
    };
}


type TriggerType = AdTrigger['type'];
type CloseReason = 'user' | 'timeout' | 'mode' | 'ad' | 'content' | 'replaced';

interface Showing {
    rule: AdTriggerRule;
    trigger: TriggerType;
    box: HTMLDivElement;
    adHost: HTMLDivElement;
    slot: GptSlot | null;
    filled: boolean;
    pausedContent: boolean;
    timers: Array<ReturnType<typeof setTimeout>>;
    /** İsteğe giden key-value'ların son hali (olayda bildirilir). */
    custParams?: KeyValues;
}

/**
 * Reklam tetikleyici: kurallara göre Ad Manager out-of-page reklamı ister ve player içinde (tam ekranda da) gösterir.
 * Kurallar API'den (`endpoint`) ya da `config`'ten gelir; API hatasında son geçerli kurallar korunur.
 * Aynı anda tek reklam; video reklamı (IMA) oynarken, sekme arka plandayken ve iPhone native tam ekranında istenmez.
 */
export class AdTriggers {
    private options: AdTriggersOptions;
    private config: AdTriggersConfig | null = null;
    private loaded = false;
    private googletag: GoogleTag | null = null;
    private showing: Showing | null = null;
    private readonly instance = ++instanceCount;
    private seq = 0;
    private requestSeq = 0;
    private destroyed = false;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private readonly tickTimer: ReturnType<typeof setInterval>;
    /** Olaydan `delay` sn sonra çalışacak tetiklemeler — koşul bozulunca iptal edilir. */
    private delayed: Array<{ type: TriggerType; timer: ReturnType<typeof setTimeout> }> = [];
    // ── içerik başına durum (kaynak değişince sıfırlanır) ──
    private contentKey = '';
    private fired = new Set<string>();
    private shows = new Map<number, number>();
    private lastShownAt = new Map<number, number>();
    private lastAnyAt = 0;
    private watchedMs = 0;
    private lastTick = performance.now();
    private lastPos = 0;
    private started = false;
    private userPaused = false;
    /** Player'ın kendi duraklatması (pauseContent) — pause/resume kuralı sayılmaz. */
    private selfPause = false;
    private wasFullscreen = false;

    constructor(
        private readonly ctx: AdTriggersContext,
        options: AdTriggersOptions
    ) {
        this.options = options;
        const v = ctx.videoEl;
        v.addEventListener('timeupdate', this.onTimeUpdate);
        v.addEventListener('seeked', this.onSeeked);
        v.addEventListener('playing', this.onPlaying);
        v.addEventListener('pause', this.onPause);
        v.addEventListener('ended', this.onEnded);
        v.addEventListener('loadstart', this.onLoadStart);
        v.addEventListener('webkitbeginfullscreen', this.onFullscreenChange);
        v.addEventListener('webkitendfullscreen', this.onFullscreenChange);
        document.addEventListener('fullscreenchange', this.onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);
        ctx.hostEl.addEventListener('hp:adstart', this.onVideoAdStart);
        this.wasFullscreen = ctx.isFullscreen();
        this.contentKey = ctx.contentKey();
        this.tickTimer = setInterval(this.tick, 1000);
        void this.load();
        this.scheduleRefresh();
    }

    update(options: AdTriggersOptions): void {
        const changed =
            options.endpoint !== this.options.endpoint ||
            JSON.stringify(options.params) !== JSON.stringify(this.options.params) ||
            JSON.stringify(options.config) !== JSON.stringify(this.options.config);
        const refreshChanged = options.refreshSeconds !== this.options.refreshSeconds;
        this.options = options;
        if (changed) void this.load();
        if (refreshChanged) this.scheduleRefresh();
    }

    get current(): AdTriggersConfig | null {
        return this.config;
    }

    /** Şu an bir reklam gösteriliyor mu. */
    get active(): boolean {
        return !!this.showing?.filled;
    }

    // ── kurallar ──

    private scheduleRefresh(): void {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = null;
        const s = this.options.refreshSeconds;
        if (this.options.endpoint && typeof s === 'number' && s >= 10) this.refreshTimer = setInterval(() => void this.load(), s * 1000);
    }

    private async load(): Promise<void> {
        const seq = ++this.requestSeq;
        if (!this.options.endpoint) {
            this.apply(normalizeAdTriggers(this.options.config));
            return;
        }
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = setTimeout(() => ctrl?.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        let url = '';
        try {
            const u = new URL(this.options.endpoint, document.baseURI);
            for (const [k, v] of Object.entries(this.options.params ?? {})) u.searchParams.set(k, v);
            url = u.href;
            const res = await fetch(url, { ...this.options.fetchInit, signal: ctrl?.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json: unknown = await res.json();
            if (this.destroyed || seq !== this.requestSeq) return;
            this.apply(normalizeAdTriggers(json));
        } catch (err) {
            if (this.destroyed || seq !== this.requestSeq) return;
            this.ctx.log({ message: `Ad triggers API failed: ${String(err)}`, details: { url } });
            // Hiç kural yoksa yerel varsayılan (config) kullanılır; varsa son geçerli kurallar korunur.
            if (!this.config && this.options.config) this.apply(normalizeAdTriggers(this.options.config));
        } finally {
            clearTimeout(timer);
        }
    }

    private apply(config: AdTriggersConfig | null): void {
        // İlk yanıt her zaman bildirilir (kapalı olsa da) — sonrakiler yalnızca değişince.
        const changed = !this.loaded || JSON.stringify(config) !== JSON.stringify(this.config);
        this.loaded = true;
        this.config = config;
        if (!changed) return;
        this.cancelDelayed();
        if (!config) this.close('content');
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adtriggers', { detail: { config } }));
    }

    // ── olaylar → tetikleyiciler ──

    private readonly onLoadStart = (): void => {
        const key = this.ctx.contentKey();
        // Aynı içeriğin kalite değişimi de loadstart üretir — yalnızca gerçekten başka bir içerik gelince sıfırla.
        if (key === this.contentKey) return;
        this.contentKey = key;
        this.fired.clear();
        this.shows.clear();
        this.lastShownAt.clear();
        this.watchedMs = 0;
        this.lastPos = 0;
        this.started = false;
        this.userPaused = false;
        this.cancelDelayed();
        this.close('content');
    };

    private readonly onPlaying = (): void => {
        if (this.ctx.isBlocked()) return;
        if (!this.started) {
            this.started = true;
            this.trigger('start');
        } else if (this.userPaused) {
            this.trigger('resume');
        }
        this.userPaused = false;
        this.cancelDelayed('pause');
    };

    private readonly onPause = (): void => {
        const v = this.ctx.videoEl;
        if (this.selfPause) {
            this.selfPause = false;
            return;
        }
        if (v.ended || v.seeking || this.ctx.isBlocked()) return;
        this.userPaused = true;
        this.cancelDelayed('start', 'resume');
        this.trigger('pause');
    };

    private readonly onEnded = (): void => {
        if (!this.ctx.isBlocked()) this.trigger('ended');
    };

    private readonly onSeeked = (): void => {
        this.lastPos = this.ctx.videoEl.currentTime;
    };

    private readonly onFullscreenChange = (): void => {
        const fs = this.ctx.isFullscreen();
        if (fs === this.wasFullscreen) return;
        this.wasFullscreen = fs;
        this.cancelDelayed(fs ? 'fullscreenExit' : 'fullscreen');
        // Tam ekran durumu değişti: o duruma özel gösterilen reklam kapanır.
        const mode = this.showing?.rule.mode;
        if ((mode === 'fullscreen' && !fs) || (mode === 'normal' && fs)) this.close('mode');
        this.trigger(fs ? 'fullscreen' : 'fullscreenExit');
    };

    private readonly onVideoAdStart = (e: Event): void => {
        if ((e as CustomEvent<{ linear?: boolean }>).detail?.linear === false) return;
        this.cancelDelayed();
        this.close('ad');
    };

    private isLive(): boolean {
        return this.ctx.videoEl.duration === Infinity;
    }

    private readonly onTimeUpdate = (): void => {
        const v = this.ctx.videoEl;
        const pos = v.currentTime;
        const prev = this.lastPos;
        this.lastPos = pos;
        const c = this.config;
        if (!c || v.paused || v.seeking || this.isLive() || this.ctx.isBlocked()) return;
        // Yalnızca doğal ilerleme — ileri sarınca aradaki anlar tetiklenmez.
        if (pos <= prev || pos - prev > MAX_NATURAL_STEP_S) return;
        const dur = v.duration;
        c.rules.forEach((rule, ri) =>
            rule.triggers.forEach((t, ti) => {
                if (t.type !== 'time' && t.type !== 'percent') return;
                for (const mark of t.at) {
                    const at = t.type === 'percent' ? (Number.isFinite(dur) && dur > 0 ? (dur * mark) / 100 : NaN) : mark;
                    const key = `${ri}:${ti}:${mark}`;
                    if (prev < at && at <= pos && !this.fired.has(key)) {
                        this.fired.add(key);
                        this.showRule(ri, t.type);
                    }
                }
            })
        );
    };

    /** Gerçek izleme süresi: interval kuralları (ve canlıda time kuralları) bununla sayılır. */
    private readonly tick = (): void => {
        const now = performance.now();
        const delta = Math.min(2000, Math.max(0, now - this.lastTick));
        this.lastTick = now;
        const v = this.ctx.videoEl;
        const c = this.config;
        if (!c || v.paused || v.ended || document.hidden || this.ctx.isBlocked() || this.showing?.filled) return;
        const before = this.watchedMs / 1000;
        this.watchedMs += delta;
        const after = this.watchedMs / 1000;
        c.rules.forEach((rule, ri) =>
            rule.triggers.forEach((t, ti) => {
                if (t.type === 'interval') {
                    const first = t.startAfter ?? t.every;
                    // Bu adımda geçilen eşik: first, first + every, first + 2·every…
                    const n = Math.floor((after - first) / t.every);
                    if (after >= first && first + n * t.every > before) this.showRule(ri, 'interval');
                } else if (t.type === 'time' && this.isLive()) {
                    for (const at of t.at) {
                        const key = `${ri}:${ti}:${at}:live`;
                        if (before < at && at <= after && !this.fired.has(key)) {
                            this.fired.add(key);
                            this.showRule(ri, 'time');
                        }
                    }
                }
            })
        );
    };

    /** Olay tipindeki tetikleyicisi olan her kural (gecikmeliyse zamanlanır). */
    private trigger(type: TriggerType): void {
        const c = this.config;
        if (!c) return;
        c.rules.forEach((rule, ri) => {
            const t = rule.triggers.find((x) => x.type === type) as { delay?: number } | undefined;
            if (!t) return;
            const delay = (t.delay ?? 0) * 1000;
            if (delay <= 0) {
                this.showRule(ri, type);
                return;
            }
            const timer = setTimeout(() => {
                this.delayed = this.delayed.filter((d) => d.timer !== timer);
                this.showRule(ri, type);
            }, delay);
            this.delayed.push({ type, timer });
        });
    }

    private cancelDelayed(...types: TriggerType[]): void {
        this.delayed = this.delayed.filter((d) => {
            if (types.length && !types.includes(d.type)) return true;
            clearTimeout(d.timer);
            return false;
        });
    }

    // ── gösterim ──

    /** Koşullar uygunsa kuralın reklamını ister. Uygun değilse sessizce atlanır (sebep kayda düşer). */
    private showRule(index: number, trigger: TriggerType): void {
        const rule = this.config?.rules[index];
        if (!rule || this.destroyed) return;
        const v = this.ctx.videoEl;
        const fs = this.ctx.isFullscreen();
        const skip = (why: string): void => this.ctx.log({ message: `Ad trigger skipped (${why})`, details: { rule: rule.id, trigger } });
        // layout 'none' reklamının kapanışı kreatifte — yeni tetikleme onu değiştirir; diğerleri (ya da süren istek) bekletir.
        if (this.showing && !(this.showing.filled && this.showing.rule.layout === 'none')) return skip('another ad is showing');
        if (this.ctx.isBlocked()) return skip('video ad / intro screen');
        if (document.hidden) return skip('tab hidden');
        if (this.ctx.isNativeFullscreen()) return skip('native iOS fullscreen');
        if (rule.mode === 'fullscreen' && !fs) return skip('not fullscreen');
        if (rule.mode === 'normal' && fs) return skip('fullscreen');
        // Olay anındaki durum hâlâ geçerli mi (gecikmeli tetiklemeler için).
        if (trigger === 'pause' && (!v.paused || v.ended)) return;
        if (trigger === 'ended' && !v.ended) return;
        if (['time', 'percent', 'interval', 'start', 'resume'].includes(trigger) && v.paused) return;
        if (rule.minPlayerWidth && this.ctx.overlayEl.getBoundingClientRect().width < rule.minPlayerWidth) return skip('player too narrow');
        const now = Date.now();
        if (rule.maxShows && (this.shows.get(index) ?? 0) >= rule.maxShows) return skip('maxShows');
        if (rule.minGapSeconds && now - (this.lastShownAt.get(index) ?? 0) < rule.minGapSeconds * 1000) return skip('rule minGapSeconds');
        if (now - this.lastAnyAt < (this.config?.minGapSeconds ?? DEFAULT_GLOBAL_GAP_S) * 1000) return skip('minGapSeconds');
        if (this.showing) this.close('replaced');
        // İstek anı aralığa sayılır: boş dönen birim her saniye yeniden istenmesin.
        this.lastAnyAt = now;
        this.lastShownAt.set(index, now);
        void this.request(index, rule, trigger, fs);
    }

    private async request(index: number, rule: AdTriggerRule, trigger: TriggerType, fullscreen: boolean): Promise<void> {
        const id = ++this.seq;
        const slotName = `hp-adtrigger-${this.instance}`;
        const box = this.buildBox(rule, slotName);
        const adHost = document.createElement('div');
        adHost.id = `hp-adtrigger-${this.instance}-${id}`;
        adHost.slot = slotName;
        const s: Showing = { rule, trigger, box, adHost, slot: null, filled: false, pausedContent: false, timers: [] };
        this.showing = s;
        this.ctx.overlayEl.appendChild(box);
        this.ctx.hostEl.appendChild(adHost);
        const detail = { rule: rule.id, trigger, adUnitPath: rule.adUnitPath };
        const empty = (why: string): void => {
            if (this.showing !== s) return;
            this.ctx.log({ message: `Ad trigger: no ad (${why})`, details: { ...detail } });
            fire(rule.tracking?.empty);
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adtriggerempty', { detail }));
            this.teardown(s);
        };
        // GPT hiç yüklenemez / yanıt vermezse (engelleyici, ağ) kutu asılı kalmasın.
        s.timers.push(setTimeout(() => !s.filled && empty('timeout'), this.options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS));
        try {
            this.googletag ??= await loadGpt();
        } catch (err) {
            empty(String(err));
            return;
        }
        if (this.showing !== s) return;
        const gt = this.googletag;
        gt.cmd.push(() => {
            if (this.showing !== s) return;
            const slot = gt.defineOutOfPageSlot(rule.adUnitPath, adHost.id);
            if (!slot) {
                empty('slot could not be defined');
                return;
            }
            s.slot = slot;
            slot.addService(gt.pubads());
            // Öncelik (sonraki ezer): sayfa targeting → sayfa custParams → kural targeting → kural custParams → hp_*.
            const targeting: Record<string, string | string[]> = {
                ...parseCustParams(this.options.targeting),
                ...parseCustParams(this.options.custParams),
                ...rule.targeting,
                ...parseCustParams(rule.custParams),
                hp_trigger: trigger,
                hp_mode: fullscreen ? 'fullscreen' : 'normal',
            };
            if (rule.id) targeting.hp_rule = rule.id;
            for (const [k, val] of Object.entries(targeting)) slot.setTargeting(k, val);
            s.custParams = targeting;
            const onRender = (e: GptSlotRenderEndedEvent): void => {
                if (e.slot !== slot) return;
                gt.pubads().removeEventListener?.('slotRenderEnded', onRender);
                if (e.isEmpty) empty('empty');
                else this.reveal(index, s, fullscreen);
            };
            gt.pubads().addEventListener('slotRenderEnded', onRender);
            gt.enableServices();
            gt.display(adHost.id);
            // Sayfa disableInitialLoad kullanıyorsa display istek atmaz — elle refresh.
            if (gt.pubads().isInitialLoadDisabled()) gt.pubads().refresh([slot]);
        });
    }

    private buildBox(rule: AdTriggerRule, slotName: string): HTMLDivElement {
        const box = document.createElement('div');
        box.className = 'hp-adtrigger';
        box.setAttribute('part', 'ad-trigger');
        const bare = rule.layout === 'none';
        box.setAttribute('data-layout', rule.layout ?? 'none');
        box.toggleAttribute('data-backdrop', !!rule.backdrop);
        const frame = document.createElement('div');
        frame.className = 'hp-adtrigger-frame';
        if (rule.size && rule.layout !== 'full') {
            frame.style.setProperty('--hp-adtrigger-w', `${rule.size[0]}px`);
            frame.style.setProperty('--hp-adtrigger-h', `${rule.size[1]}px`);
            frame.setAttribute('data-sized', '');
        }
        // 'none': player yalnızca isteği atar ve kreatifi yerleştirir — etiket, kapat butonu, boyut kreatifin işi.
        if (rule.label !== false && !bare) {
            const label = document.createElement('span');
            label.className = 'hp-adtrigger-label';
            label.textContent = rule.label || this.ctx.i18n.adTriggerLabel;
            frame.appendChild(label);
        }
        const slot = document.createElement('slot');
        slot.name = slotName;
        frame.appendChild(slot);
        if (rule.closeButton !== false && !bare) {
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'hp-adtrigger-close';
            close.setAttribute('part', 'ad-trigger-close');
            close.setAttribute('aria-label', this.ctx.i18n.pauseAdClose);
            close.hidden = true;
            close.innerHTML =
                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
            close.addEventListener('click', () => this.close('user'));
            frame.appendChild(close);
        }
        box.appendChild(frame);
        // Reklama tıklama / dokunma videoyu oynat-duraklat yapmasın, kontrolleri açmasın.
        for (const t of ['pointerdown', 'click', 'dblclick'] as const) box.addEventListener(t, (e) => e.stopPropagation());
        return box;
    }

    private reveal(index: number, s: Showing, fullscreen: boolean): void {
        if (this.showing !== s) return;
        const { rule } = s;
        s.filled = true;
        this.shows.set(index, (this.shows.get(index) ?? 0) + 1);
        this.lastAnyAt = Date.now();
        // Kutu boyutlu ya da tam alan ise reklam iframe'i kutuyu doldursun (out-of-page kreatifleri kendi boyutunu vermez).
        if (rule.layout === 'full' || (rule.size && rule.layout !== 'none')) {
            const iframe = s.adHost.querySelector('iframe');
            if (iframe) Object.assign(iframe.style, { width: '100%', height: '100%', border: '0' });
            Object.assign(s.adHost.style, { width: '100%', height: '100%' });
        }
        s.box.setAttribute('data-open', '');
        const close = s.box.querySelector<HTMLButtonElement>('.hp-adtrigger-close');
        // closeDelay 0: X kutuyla aynı anda görünsün (setTimeout(0) bir kare butonsuz kutu gösteriyordu).
        if (close && !rule.closeDelay) close.hidden = false;
        else if (close) s.timers.push(setTimeout(() => (close.hidden = false), rule.closeDelay! * 1000));
        if (rule.duration) s.timers.push(setTimeout(() => this.close('timeout'), rule.duration * 1000));
        const v = this.ctx.videoEl;
        if (rule.pauseContent && !v.paused) {
            s.pausedContent = true;
            this.selfPause = true;
            v.pause();
        }
        fire(rule.tracking?.impression);
        this.ctx.hostEl.dispatchEvent(
            new CustomEvent('hp:adtriggershow', { detail: { rule: rule.id, trigger: s.trigger, adUnitPath: rule.adUnitPath, fullscreen, custParams: s.custParams ?? {} } })
        );
    }

    /** Gösterilen reklamı kapat (bekleyen istek varsa iptal). */
    close(reason: CloseReason): void {
        const s = this.showing;
        if (!s) return;
        const wasFilled = s.filled;
        this.teardown(s);
        if (!wasFilled) return;
        fire(s.rule.tracking?.close);
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:adtriggerclose', { detail: { rule: s.rule.id, reason } }));
        // Duraklattığımız içerik kaldığı yerden devam etsin (içerik değişmediyse / video reklamı başlamadıysa).
        if (s.pausedContent && reason !== 'content' && reason !== 'ad') void this.ctx.videoEl.play().catch(() => {});
    }

    private teardown(s: Showing): void {
        if (this.showing === s) this.showing = null;
        for (const t of s.timers) clearTimeout(t);
        if (s.slot && this.googletag) {
            try {
                this.googletag.destroySlots([s.slot]);
            } catch {
                /* zaten yok edildi */
            }
        }
        s.box.remove();
        s.adHost.remove();
    }

    destroy(): void {
        this.destroyed = true;
        this.cancelDelayed();
        this.close('content');
        clearInterval(this.tickTimer);
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        const v = this.ctx.videoEl;
        v.removeEventListener('timeupdate', this.onTimeUpdate);
        v.removeEventListener('seeked', this.onSeeked);
        v.removeEventListener('playing', this.onPlaying);
        v.removeEventListener('pause', this.onPause);
        v.removeEventListener('ended', this.onEnded);
        v.removeEventListener('loadstart', this.onLoadStart);
        v.removeEventListener('webkitbeginfullscreen', this.onFullscreenChange);
        v.removeEventListener('webkitendfullscreen', this.onFullscreenChange);
        document.removeEventListener('fullscreenchange', this.onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
        this.ctx.hostEl.removeEventListener('hp:adstart', this.onVideoAdStart);
    }
}
