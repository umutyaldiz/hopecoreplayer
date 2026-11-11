// Herkese açık eklenti API'si — semver altında; eklentiler yalnızca bu tiplere dayanır.

/** API sürümü; eklenti daha yenisini isterse uyarı yazılır. */
export const PLUGIN_API_VERSION = 1;

/** Metin ya da güncel metni döndüren fonksiyon (dil değişince yeniden okunur). */
export type PluginLabel = string | (() => string);

export type PluginCleanup = () => void;

export interface HopePlugin<O = unknown> {
    /** Benzersiz ad; olay öneki de budur. */
    name: string;
    apiVersion?: number;
    /** API ile eklenen her şey eklenti kaldırılınca kendiliğinden temizlenir. */
    setup(player: PlayerApi, options: O): void | PluginCleanup | Promise<void | PluginCleanup>;
    /** Seçenekler değişince; yoksa eklenti yeniden kurulur. */
    update?(options: O): void;
}

/** Tembel yükleme: `() => import('./my-plugin')` (default ya da `plugin` export'u). */
export type PluginLoader = () => Promise<HopePlugin<any> | { default: HopePlugin<any> } | { plugin: HopePlugin<any> }>;

/** Eklenti, yükleyici ya da `[eklenti | yükleyici, seçenekler]`. */
export type PluginEntry = HopePlugin<any> | PluginLoader | [HopePlugin<any> | PluginLoader, unknown?];

// ── Arayüz ──

export interface PluginButtonOptions {
    label: PluginLabel;
    /** Satır içi SVG ya da player ikon adı (`play`, `settings`, `loop`…). */
    icon: string;
    /** Varsayılan `'right'`. */
    position?: 'left' | 'right';
    /** Verilirse aç / kapa butonu (`aria-pressed`). */
    active?: boolean;
    onClick?(event: MouseEvent, button: PluginButtonHandle): void;
}

export interface PluginButtonHandle {
    readonly el: HTMLButtonElement;
    readonly active: boolean;
    setLabel(label: PluginLabel): void;
    setIcon(icon: string): void;
    setActive(active: boolean): void;
    show(): void;
    hide(): void;
    remove(): void;
}

export type PluginLayerPosition = 'fill' | 'top' | 'bottom' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface PluginLayerOptions {
    /** Varsayılan `'fill'`. */
    position?: PluginLayerPosition;
    /** Kontrollerin üstünde (varsayılan altında). */
    above?: boolean;
    /** Kontrollerle birlikte gizlenir. */
    autoHide?: boolean;
    /** Tüm katman tıklanabilir; varsayılan yalnızca içindeki butonlar / linkler. */
    interactive?: boolean;
    /** Katmana CSS (shadow DOM içinde). */
    css?: string;
    /** Varsayılan true. */
    visible?: boolean;
}

export interface PluginLayerHandle {
    readonly el: HTMLDivElement;
    readonly visible: boolean;
    show(): void;
    hide(): void;
    toggle(force?: boolean): void;
    remove(): void;
}

export interface PluginUiApi {
    addButton(options: PluginButtonOptions): PluginButtonHandle;
    addLayer(options?: PluginLayerOptions): PluginLayerHandle;
    toast(message: string, options?: { durationMs?: number }): void;
}

// ── Ayarlar menüsü ──

export interface PluginSettingsItem {
    label: PluginLabel;
    active?: boolean;
    onSelect(): void;
}

export interface PluginSettingsHandle {
    /** Satırı güncel değerle yeniden çizer. */
    refresh(): void;
    remove(): void;
}

export interface PluginSettingsApi {
    /** Ana menüde aç / kapa satırı. */
    addToggle(options: { label: PluginLabel; get(): boolean; set(value: boolean): void }): PluginSettingsHandle;
    /** Alt menüde seçenek listesi. */
    addSelect<V extends string | number>(options: {
        label: PluginLabel;
        options: Array<{ value: V; label: PluginLabel }> | (() => Array<{ value: V; label: PluginLabel }>);
        get(): V;
        set(value: V): void;
    }): PluginSettingsHandle;
    /** Serbest alt menü; satırlar her açılışta `items()` ile üretilir. */
    addSubmenu(options: { label: PluginLabel; value?: () => string; items(): PluginSettingsItem[] }): PluginSettingsHandle;
}

// ── Klavye, dil, depolama ──

export interface PluginKeysApi {
    /** `'w'`, `'Shift+W'`, `'Alt+l'`; player'ın kendi tuşlarını ezmez, `?` listesinde görünür. */
    add(key: string, handler: (event: KeyboardEvent) => void, description?: PluginLabel): () => void;
}

export interface PluginI18nApi {
    /** `{ tr: { key: '…' }, en: { key: '…' } }` */
    add(strings: Record<string, Record<string, string>>): void;
    /** Player dili → İngilizce → `fallback` → anahtar. */
    t(key: string, fallback?: string): string;
}

export interface PluginStorageApi {
    /** Eklentiye ayrılmış localStorage alanı. */
    get<T>(key: string, fallback?: T): T | undefined;
    set(key: string, value: unknown): void;
    remove(key: string): void;
}

// ── Reklam ──

export type PluginAdBreakType = 'preroll' | 'midroll' | 'postroll';

/** `requestBreak` içinde reklamın çizildiği ve bittiğinin bildirildiği nesne. */
export interface PluginAdBreak {
    readonly type: PluginAdBreakType;
    /** Video alanını kaplayan, kontrollerin üstündeki tıklanabilir katman. */
    readonly layer: HTMLDivElement;
    /** Arayı player bitirince (zaman aşımı, eklenti kaldırıldı) iptal olur. */
    readonly signal: AbortSignal;
    /** Arayı hemen bitirir (ör. "Reklamı geç"). */
    end(): void;
}

export interface PluginAdBreakOptions {
    /** Verilmezse durumdan çıkarılır (başta preroll, bitişte postroll, arada midroll). */
    type?: PluginAdBreakType;
    /** Ara en fazla bu kadar sürer. Varsayılan 60000 ms. */
    timeoutMs?: number;
}

export interface PluginAdsApi {
    /**
     * Reklam arası: içerik durur, kontroller ve sarma kilitlenir, `isAdPlaying` true, `hp:adstart` / `hp:adend`.
     * `run` bitince içerik kaldığı yerden sürer. Başka bir reklam oynuyorsa başlamaz (`false`).
     */
    requestBreak(run: (ad: PluginAdBreak) => void | Promise<void>, options?: PluginAdBreakOptions): Promise<boolean>;
    /** Preroll: içerik ilk oynatmada bu bitene kadar bekler (kaynak başına bir kez). */
    beforeContent(handler: () => void | Promise<unknown>): () => void;
    /** Midroll: oynatma bu saniyelere doğal yoldan gelince. İleri sarılırsa varsayılan: geçilen son nokta bir kez. */
    atTime(seconds: number | number[], handler: (seconds: number) => void | Promise<unknown>, options?: { seekPast?: 'last' | 'skip' }): () => void;
    /** İzleyici duraklatınca (`delayMs` sonra hâlâ duraklatılmışsa). Dönen fonksiyon oynatılınca çağrılır. */
    onPause(handler: () => void | PluginCleanup, options?: { delayMs?: number }): () => void;
    /** Postroll: video bitince; playlist ve yönlendirme reklam arası bitene kadar bekler. */
    onEnded(handler: () => void | Promise<unknown>): () => void;
    /** IMA tag adresini istek öncesi değiştirir (ör. hedefleme parametresi eklemek). */
    transformTag(transform: (url: string, type: PluginAdBreakType) => string): () => void;
}

// ── Player ──

export interface PlayerApi {
    readonly plugin: string;
    readonly apiVersion: number;
    /** `<hope-player>` elementi. */
    readonly element: HTMLElement;
    /** İçerik videosu (reklamlar ayrı öğede). */
    readonly video: HTMLVideoElement;
    readonly locale: string;
    /** Player'ın kendi metinleri (salt okunur). */
    readonly labels: Readonly<Record<string, unknown>>;

    readonly currentTime: number;
    readonly duration: number;
    readonly paused: boolean;
    readonly isLive: boolean;
    readonly isAdPlaying: boolean;
    readonly isFullscreen: boolean;
    readonly src: string | null;

    play(): Promise<void>;
    pause(): void;
    seek(time: number): void;

    /** Video olayları ve `hp:*` olayları; dönen fonksiyon dinlemeyi bırakır. */
    on(event: string, handler: (event: Event) => void): () => void;
    once(event: string, handler: (event: Event) => void): () => void;
    /** Elementte `<eklenti>:<olay>` CustomEvent'i yayar. */
    emit(event: string, detail?: unknown): void;
    onSourceChange(handler: (src: string | null) => void): () => void;
    onLocaleChange(handler: (locale: string) => void): () => void;
    onDestroy(handler: () => void): void;

    /** Eklenti kaldırılınca iptal edilen zamanlayıcılar. */
    setTimeout(handler: () => void, ms: number): number;
    setInterval(handler: () => void, ms: number): number;

    readonly ui: PluginUiApi;
    readonly settings: PluginSettingsApi;
    readonly keys: PluginKeysApi;
    readonly i18n: PluginI18nApi;
    readonly storage: PluginStorageApi;
    readonly ads: PluginAdsApi;
    /** Player'ın hata kaydına yazar. */
    log(message: string, details?: Record<string, string | number | boolean | undefined>): void;
}

/** `player.use()` tutamacı. */
export interface PluginInstanceHandle {
    readonly name: string;
    remove(): void;
}
