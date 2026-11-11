// Eklentileri kurar / kaldırır; eklenenleri izler ve temizler, hataları yakalar.
import { createIcon } from '../icons/Icon';
import { PluginAds } from './PluginAds';
import type { SettingsSubmenuDef, SettingsSubmenuItem } from '../controls/SettingsMenu';
import {
    PLUGIN_API_VERSION,
    type HopePlugin,
    type PlayerApi,
    type PluginButtonHandle,
    type PluginButtonOptions,
    type PluginCleanup,
    type PluginEntry,
    type PluginLabel,
    type PluginLayerHandle,
    type PluginLayerOptions,
    type PluginLoader,
    type PluginSettingsHandle,
} from './types';

/** Player → PluginHost bağlamı (eklentiler görmez). */
export interface PluginHostContext {
    element: HTMLElement;
    video: HTMLVideoElement;
    videoArea: HTMLElement;
    /** Alt katmanlar bunun önüne eklenir. */
    chromeEl: HTMLElement;
    labels: Readonly<Record<string, unknown>>;
    locale(): string;
    currentSrc(): string | null;
    isAdPlaying(): boolean;
    /** Reklam kilidi (`blockChrome('ads')`). */
    blockAds(): void;
    unblockAds(): void;
    isFullscreen(): boolean;
    addControlButton(button: HTMLButtonElement, position: 'left' | 'right'): void;
    settings: {
        registerToggle(row: { key: string; label: string; getValueLabel(): string; onToggle(): void }): void;
        unregisterToggle(key: string): void;
        registerSubmenu(def: SettingsSubmenuDef): void;
        unregisterSubmenu(key: string): void;
    };
    log(message: string, details?: Record<string, string | number | boolean | undefined>): void;
}

interface Instance {
    plugin: HopePlugin<any>;
    optionsKey: string;
    api: PlayerApi;
    disposers: Array<() => void>;
    /** Dil değişince yeniden çizilecekler. */
    relabel: Array<() => void>;
    localeHandlers: Array<(locale: string) => void>;
    cleanup: PluginCleanup | null;
    removed: boolean;
}

/** `Shift+W` gibi kısayol. */
interface KeySpec {
    key: string;
    shift: boolean | null;
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
}

export interface PluginShortcut {
    keys: string[];
    description: string;
}

const resolve = (label: PluginLabel): string => (typeof label === 'function' ? label() : label);

function parseKey(spec: string): KeySpec {
    const parts = spec.split('+');
    // "Shift++" gibi: son parça boşsa tuş "+".
    const key = (parts.pop() || '+').toLowerCase();
    const mods = parts.map((p) => p.toLowerCase());
    const letter = /^[a-z]$/.test(key);
    return { key, shift: mods.includes('shift') ? true : letter ? false : null, alt: mods.includes('alt'), ctrl: mods.includes('ctrl') || mods.includes('control'), meta: mods.includes('meta') || mods.includes('cmd') };
}

function matches(spec: KeySpec, e: KeyboardEvent): boolean {
    return (
        e.key.toLowerCase() === spec.key &&
        e.altKey === spec.alt &&
        e.ctrlKey === spec.ctrl &&
        e.metaKey === spec.meta &&
        (spec.shift === null || e.shiftKey === spec.shift)
    );
}

export class PluginHost {
    private readonly instances = new Map<string, Instance>();
    private readonly shortcutList: Array<{ owner: string; spec: KeySpec; label: string; description: PluginLabel | undefined; handler: (e: KeyboardEvent) => void }> = [];
    private syncSeq = 0;
    private toastEl: HTMLDivElement | null = null;
    private toastTimer: ReturnType<typeof setTimeout> | null = null;
    /** Ayar satırı anahtarları. */
    private keySeq = 0;
    private readonly ads: PluginAds;

    constructor(private readonly ctx: PluginHostContext) {
        ctx.element.addEventListener('keydown', this.onKeyDown);
        this.ads = new PluginAds(ctx);
    }

    /** IMA tag'i eklenti dönüşümlerinden geçirir. */
    transformAdTag(url: string, type: 'preroll' | 'midroll' | 'postroll'): string {
        return this.ads.transformTag(url, type);
    }

    /** Listeye eşitler: kurar, kaldırır, günceller (aynı adlıda sonraki kazanır). */
    async sync(builtin: PluginEntry[], user: PluginEntry[]): Promise<void> {
        const seq = ++this.syncSeq;
        const resolved = await Promise.all([...builtin, ...user].map((e) => this.resolveEntry(e)));
        if (seq !== this.syncSeq) return; // daha yenisi başladı
        const wanted = new Map<string, { plugin: HopePlugin<any>; options: unknown }>();
        for (const r of resolved) if (r) wanted.set(r.plugin.name, r);

        for (const [name, inst] of this.instances) if (!wanted.has(name)) this.dispose(name, inst);
        for (const [name, { plugin, options }] of wanted) {
            const key = optionsKey(options);
            const inst = this.instances.get(name);
            if (inst && inst.plugin === plugin) {
                if (inst.optionsKey === key) continue;
                if (plugin.update) {
                    inst.optionsKey = key;
                    this.guard(name, () => plugin.update!(options))();
                    continue;
                }
            }
            if (inst) this.dispose(name, inst);
            await this.install(plugin, options, key);
        }
    }

    /** Dil değişince. */
    refreshLabels(): void {
        for (const [name, inst] of this.instances) {
            for (const fn of inst.relabel) this.guard(name, fn)();
            for (const fn of inst.localeHandlers) this.guard(name, () => fn(this.ctx.locale()))();
        }
    }

    /** `?` listesi için. */
    shortcuts(): PluginShortcut[] {
        return this.shortcutList.filter((s) => s.description !== undefined).map((s) => ({ keys: [s.label], description: resolve(s.description!) }));
    }

    has(name: string): boolean {
        return this.instances.has(name);
    }

    destroy(): void {
        ++this.syncSeq;
        for (const [name, inst] of this.instances) this.dispose(name, inst);
        this.ctx.element.removeEventListener('keydown', this.onKeyDown);
        this.ads.destroy();
        this.toastEl?.remove();
        if (this.toastTimer) clearTimeout(this.toastTimer);
    }

    // ── Kurulum ──

    private async resolveEntry(entry: PluginEntry): Promise<{ plugin: HopePlugin<any>; options: unknown } | null> {
        const [target, options] = Array.isArray(entry) ? entry : [entry, undefined];
        try {
            if (typeof target === 'function') {
                const mod = await (target as PluginLoader)();
                const plugin = 'setup' in mod ? mod : 'default' in mod ? mod.default : mod.plugin;
                return plugin && typeof plugin.setup === 'function' ? { plugin, options } : null;
            }
            return target && typeof target.setup === 'function' && typeof target.name === 'string' ? { plugin: target, options } : null;
        } catch (err) {
            this.ctx.log(`Plugin could not be loaded: ${(err as Error)?.message ?? err}`, { plugin: typeof target === 'function' ? 'loader' : String((target as HopePlugin)?.name) });
            return null;
        }
    }

    private async install(plugin: HopePlugin<any>, options: unknown, key: string): Promise<void> {
        const name = plugin.name;
        if (plugin.apiVersion && plugin.apiVersion > PLUGIN_API_VERSION) {
            this.ctx.log(`Plugin "${name}" was written for plugin API v${plugin.apiVersion}; this player has v${PLUGIN_API_VERSION}`, { plugin: name });
        }
        const inst: Instance = { plugin, optionsKey: key, api: null as unknown as PlayerApi, disposers: [], relabel: [], localeHandlers: [], cleanup: null, removed: false };
        inst.api = this.createApi(inst);
        this.instances.set(name, inst);
        try {
            const result = await plugin.setup(inst.api, options);
            if (inst.removed) {
                if (typeof result === 'function') this.guard(name, result)();
                return;
            }
            if (typeof result === 'function') inst.cleanup = result;
        } catch (err) {
            this.report(name, err, 'setup');
            this.dispose(name, inst);
        }
    }

    private dispose(name: string, inst: Instance): void {
        if (inst.removed) return;
        inst.removed = true;
        if (this.instances.get(name) === inst) this.instances.delete(name);
        if (inst.cleanup) this.guard(name, inst.cleanup)();
        // Ters sırada kaldır.
        for (const d of inst.disposers.reverse()) {
            try {
                d();
            } catch {
                /* yok say */
            }
        }
        inst.disposers = [];
        this.ads.removeOwner(name);
        for (let i = this.shortcutList.length - 1; i >= 0; i--) if (this.shortcutList[i]!.owner === name) this.shortcutList.splice(i, 1);
    }

    private report(name: string, err: unknown, where: string): void {
        const message = (err as Error)?.message ?? String(err);
        this.ctx.log(`Plugin "${name}" failed in ${where}: ${message}`, { plugin: name });
        console.error(`[hope-player] plugin "${name}" (${where}):`, err);
    }

    /** Eklenti kodu hep bundan çağrılır; hata player'a geçmez. */
    private guard<A extends unknown[]>(name: string, fn: (...args: A) => unknown, where = 'handler'): (...args: A) => void {
        return (...args: A) => {
            try {
                const r = fn(...args);
                if (r instanceof Promise) r.catch((err) => this.report(name, err, where));
            } catch (err) {
                this.report(name, err, where);
            }
        };
    }

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        // Player'ın kendi tuşları önce; işlendiyse karışma.
        if (e.defaultPrevented) return;
        const target = e.composedPath()[0];
        if (target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
        for (const s of this.shortcutList) {
            if (matches(s.spec, e)) {
                e.preventDefault();
                s.handler(e);
                return;
            }
        }
    };

    // ── PlayerApi ──

    private createApi(inst: Instance): PlayerApi {
        const ctx = this.ctx;
        const name = inst.plugin.name;
        const track = (dispose: () => void): void => {
            if (inst.removed) dispose();
            else inst.disposers.push(dispose);
        };
        const guard = <A extends unknown[]>(fn: (...args: A) => unknown, where?: string) => this.guard(name, fn, where);
        const strings: Record<string, Record<string, string>> = {};
        const host = this;

        const on = (event: string, handler: (event: Event) => void, once = false): (() => void) => {
            // `x:y` olayları elementte, diğerleri videoda.
            const target: EventTarget = event.includes(':') ? ctx.element : ctx.video;
            const wrapped = guard((ev: Event) => {
                if (once) off();
                handler(ev);
            }, `on(${event})`);
            target.addEventListener(event, wrapped);
            let done = false;
            const off = (): void => {
                if (done) return;
                done = true;
                target.removeEventListener(event, wrapped);
            };
            track(off);
            return off;
        };

        const api: PlayerApi = {
            plugin: name,
            apiVersion: PLUGIN_API_VERSION,
            element: ctx.element,
            video: ctx.video,
            get locale() {
                return ctx.locale();
            },
            labels: ctx.labels,
            get currentTime() {
                return ctx.video.currentTime;
            },
            get duration() {
                return ctx.video.duration;
            },
            get paused() {
                return ctx.video.paused;
            },
            get isLive() {
                return ctx.video.duration === Infinity;
            },
            get isAdPlaying() {
                return ctx.isAdPlaying();
            },
            get isFullscreen() {
                return ctx.isFullscreen();
            },
            get src() {
                return ctx.currentSrc();
            },
            play: () => ctx.video.play(),
            pause: () => ctx.video.pause(),
            seek: (time: number) => {
                if (Number.isFinite(time)) ctx.video.currentTime = Math.max(0, time);
            },
            on: (event, handler) => on(event, handler),
            once: (event, handler) => on(event, handler, true),
            emit: (event, detail) => {
                ctx.element.dispatchEvent(new CustomEvent(`${name}:${event}`, { detail, bubbles: true, composed: true }));
            },
            onSourceChange: (handler) => on('loadstart', () => handler(ctx.currentSrc())),
            onLocaleChange: (handler) => {
                inst.localeHandlers.push(handler);
                const off = (): void => {
                    const i = inst.localeHandlers.indexOf(handler);
                    if (i >= 0) inst.localeHandlers.splice(i, 1);
                };
                track(off);
                return off;
            },
            onDestroy: (handler) => track(guard(handler, 'onDestroy')),
            setTimeout: (handler, ms) => {
                const id = window.setTimeout(guard(handler, 'setTimeout'), ms);
                track(() => clearTimeout(id));
                return id;
            },
            setInterval: (handler, ms) => {
                const id = window.setInterval(guard(handler, 'setInterval'), ms);
                track(() => clearInterval(id));
                return id;
            },
            ui: {
                addButton: (o) => host.addButton(inst, o, track, guard),
                addLayer: (o) => host.addLayer(inst, o ?? {}, track),
                toast: (message, o) => host.toast(message, o?.durationMs),
            },
            settings: {
                addToggle: (o) => {
                    const key = `plugin:${name}:toggle:${++host.keySeq}`;
                    const register = (): void =>
                        ctx.settings.registerToggle({
                            key,
                            label: resolve(o.label),
                            getValueLabel: () => (o.get() ? onOff(ctx.labels, true) : onOff(ctx.labels, false)),
                            onToggle: guard(() => o.set(!o.get()), 'settings.toggle'),
                        });
                    register();
                    inst.relabel.push(register);
                    track(() => ctx.settings.unregisterToggle(key));
                    return settingsHandle(register, () => ctx.settings.unregisterToggle(key));
                },
                addSelect: (o) => {
                    const key = `plugin:${name}:select:${++host.keySeq}`;
                    const list = () => (typeof o.options === 'function' ? o.options() : o.options);
                    const register = (): void =>
                        ctx.settings.registerSubmenu({
                            key,
                            title: resolve(o.label),
                            getValueLabel: () => {
                                const current = list().find((x) => x.value === o.get());
                                return current ? resolve(current.label) : '';
                            },
                            getItems: () => list().map((x) => ({ label: resolve(x.label), active: x.value === o.get(), onSelect: guard(() => o.set(x.value), 'settings.select') })),
                        });
                    register();
                    inst.relabel.push(register);
                    track(() => ctx.settings.unregisterSubmenu(key));
                    return settingsHandle(register, () => ctx.settings.unregisterSubmenu(key));
                },
                addSubmenu: (o) => {
                    const key = `plugin:${name}:submenu:${++host.keySeq}`;
                    const register = (): void =>
                        ctx.settings.registerSubmenu({
                            key,
                            title: resolve(o.label),
                            getValueLabel: () => (o.value ? o.value() : ''),
                            getItems: (): SettingsSubmenuItem[] =>
                                o.items().map((x) => ({ label: resolve(x.label), active: !!x.active, onSelect: guard(() => x.onSelect(), 'settings.submenu') })),
                        });
                    register();
                    inst.relabel.push(register);
                    track(() => ctx.settings.unregisterSubmenu(key));
                    return settingsHandle(register, () => ctx.settings.unregisterSubmenu(key));
                },
            },
            keys: {
                add: (key, handler, description) => {
                    const entry = { owner: name, spec: parseKey(key), label: key, description, handler: guard(handler, `keys(${key})`) };
                    host.shortcutList.push(entry);
                    const off = (): void => {
                        const i = host.shortcutList.indexOf(entry);
                        if (i >= 0) host.shortcutList.splice(i, 1);
                    };
                    track(off);
                    return off;
                },
            },
            i18n: {
                add: (more) => {
                    for (const [locale, values] of Object.entries(more)) strings[locale] = { ...strings[locale], ...values };
                },
                t: (key, fallback) => strings[ctx.locale()]?.[key] ?? strings.en?.[key] ?? fallback ?? key,
            },
            storage: {
                get: <T>(key: string, fallback?: T): T | undefined => {
                    try {
                        const raw = localStorage.getItem(storageKey(name, key));
                        return raw === null ? fallback : (JSON.parse(raw) as T);
                    } catch {
                        return fallback;
                    }
                },
                set: (key, value) => {
                    try {
                        localStorage.setItem(storageKey(name, key), JSON.stringify(value));
                    } catch {
                        /* yok say */
                    }
                },
                remove: (key) => {
                    try {
                        localStorage.removeItem(storageKey(name, key));
                    } catch {
                        /* yok say */
                    }
                },
            },
            ads: (() => {
                const raw = host.ads.api(name, guard);
                // Dönen kaldırıcılar eklenti kaldırılınca da çağrılır.
                const tracked = <F extends (...a: any[]) => () => void>(fn: F) =>
                    ((...a: Parameters<F>) => {
                        const off = fn(...a);
                        track(off);
                        return off;
                    }) as F;
                return {
                    requestBreak: raw.requestBreak,
                    beforeContent: tracked(raw.beforeContent),
                    atTime: tracked(raw.atTime),
                    onPause: tracked(raw.onPause),
                    onEnded: tracked(raw.onEnded),
                    transformTag: tracked(raw.transformTag),
                };
            })(),
            log: (message, details) => ctx.log(message, { plugin: name, ...details }),
        };
        return api;
    }

    private addButton(
        inst: Instance,
        o: PluginButtonOptions,
        track: (d: () => void) => void,
        guard: <A extends unknown[]>(fn: (...args: A) => unknown, where?: string) => (...args: A) => void
    ): PluginButtonHandle {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'hp-chip hp-plugin-btn hp:flex hp:items-center hp:justify-center hp:w-[var(--hp-ctrl-btn-size)] hp:h-[var(--hp-ctrl-btn-size)] hp:cursor-pointer hp:shrink-0';
        btn.setAttribute('part', `plugin-button plugin-${inst.plugin.name}`);
        btn.dataset.plugin = inst.plugin.name;
        let label: PluginLabel = o.label;
        let active = !!o.active;
        const setIcon = (icon: string): void => {
            btn.textContent = '';
            if (icon.trim().startsWith('<')) {
                btn.insertAdjacentHTML('beforeend', icon);
                btn.querySelector('svg')?.setAttribute('aria-hidden', 'true');
            } else btn.appendChild(createIcon(icon, 'hp:text-[length:var(--hp-ctrl-icon-size)]'));
        };
        const applyLabel = (): void => btn.setAttribute('aria-label', resolve(label));
        const applyActive = (): void => {
            if (o.active !== undefined) btn.setAttribute('aria-pressed', String(active));
        };
        setIcon(o.icon);
        applyLabel();
        applyActive();
        inst.relabel.push(applyLabel);
        const handle: PluginButtonHandle = {
            el: btn,
            get active() {
                return active;
            },
            setLabel: (l) => {
                label = l;
                applyLabel();
            },
            setIcon,
            setActive: (a) => {
                active = a;
                btn.setAttribute('aria-pressed', String(a));
            },
            show: () => {
                btn.style.display = '';
            },
            hide: () => {
                btn.style.display = 'none';
            },
            remove: () => btn.remove(),
        };
        if (o.onClick) {
            const click = guard((e: MouseEvent) => o.onClick!(e, handle), 'button.onClick');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                click(e);
            });
        }
        this.ctx.addControlButton(btn, o.position ?? 'right');
        track(() => btn.remove());
        return handle;
    }

    private addLayer(inst: Instance, o: PluginLayerOptions, track: (d: () => void) => void): PluginLayerHandle {
        const el = document.createElement('div');
        el.className = 'hp-plugin-layer';
        el.setAttribute('part', `plugin-layer plugin-${inst.plugin.name}`);
        el.dataset.plugin = inst.plugin.name;
        el.dataset.position = o.position ?? 'fill';
        el.toggleAttribute('data-autohide', !!o.autoHide);
        el.toggleAttribute('data-interactive', !!o.interactive);
        el.toggleAttribute('data-above', !!o.above);
        let visible = o.visible !== false;
        el.hidden = !visible;

        if (o.above) this.ctx.videoArea.appendChild(el);
        else this.ctx.videoArea.insertBefore(el, this.ctx.chromeEl);
        // Stil katmanın dışında: `el.innerHTML` silmesin.
        let style: HTMLStyleElement | null = null;
        if (o.css) {
            style = document.createElement('style');
            style.textContent = o.css;
            el.before(style);
        }
        const removeAll = (): void => {
            el.remove();
            style?.remove();
        };
        if (o.interactive) {
            // Tıklama videoya geçmesin.
            for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
        }
        track(removeAll);
        const set = (v: boolean): void => {
            visible = v;
            el.hidden = !v;
        };
        return {
            el,
            get visible() {
                return visible;
            },
            show: () => set(true),
            hide: () => set(false),
            toggle: (force) => set(force ?? !visible),
            remove: removeAll,
        };
    }

    private toast(message: string, durationMs = 2500): void {
        if (!this.toastEl) {
            this.toastEl = document.createElement('div');
            this.toastEl.className = 'hp-plugin-toast';
            this.toastEl.setAttribute('part', 'plugin-toast');
            this.toastEl.setAttribute('role', 'status');
            this.toastEl.setAttribute('aria-live', 'polite');
            this.ctx.videoArea.appendChild(this.toastEl);
        }
        this.toastEl.textContent = message;
        this.toastEl.setAttribute('data-visible', '');
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.toastEl?.removeAttribute('data-visible'), Math.max(500, durationMs));
    }
}

function settingsHandle(register: () => void, remove: () => void): PluginSettingsHandle {
    return { refresh: register, remove };
}

function onOff(labels: Readonly<Record<string, unknown>>, on: boolean): string {
    const value = on ? labels.a11yOn : labels.a11yOff;
    return typeof value === 'string' ? value : on ? 'On' : 'Off';
}

function storageKey(plugin: string, key: string): string {
    return `hp-plugin:${plugin}:${key}`;
}

/** Seçenek karşılaştırma anahtarı. */
function optionsKey(options: unknown): string {
    try {
        return JSON.stringify(options ?? null, (_k, v: unknown) => (typeof v === 'function' ? `fn:${(v as { name?: string }).name ?? ''}` : v));
    } catch {
        return String(Math.random());
    }
}

export { PLUGIN_API_VERSION };
export type { PluginShortcut as Shortcut };
