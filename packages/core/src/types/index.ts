import type { HopeLocale, HopeLocaleStrings } from '../i18n/types';
export type { HopeLocale, HopeLocaleStrings };

/** Hazır tema preset'leri — bkz. theme/tailwind.css ve docs/THEMING.md. */
export type HopeThemePreset =
    | 'glass-light'
    | 'glass-dark'
    | 'neo-dark'
    | 'mono';

export interface HopeSourceOption {
    src: string;
    type?: string;
    /** Kalite menüsünde gösterilecek etiket, ör. "1080p", "Oto". */
    label: string;
    /** Varsayılan seçili kalite. Birden fazlası true ise ilki kullanılır. */
    selected?: boolean;
}

export interface HopeSubtitleOption {
    src: string;
    label: string;
    srclang: string;
    default?: boolean;
}

/** [upTo, delayMs] ya da { upTo, delay }. */
export type RetryDelayEntry = [number, number] | { upTo: number; delay: number };

export interface AdsRetryOptions {
    enabled?: boolean;
    maxRetry?: number;
    retryDelay?: number;
    retryDelayPattern?: RetryDelayEntry[];
    /** Aynı fallback tag'i kaç kez dene, sonra zincirdeki bir sonrakine geç. */
    maxAttemptsPerTag?: number;
    /** 0–1, hesaplanan delay'e ± rastgelelik ekler (thundering herd önleme). */
    jitter?: number;
    /** 'preroll' (vars.) yalnızca preroll'u retry eder, 'all' hepsini. */
    retryScope?: 'preroll' | 'all';
}

export interface PrebidBidderConfig {
    bidder: string;
    params: Record<string, unknown>;
}

/** Tek bir break (preroll ya da midroll) için Prebid auction ayarları — VideoPrebid constructor'ına birebir aktarılır. */
export interface PrebidBreakOptions {
    enabled?: boolean;
    adUnitCode?: string;
    gamAdUnit?: string | null;
    gpid?: string | null;
    sizes?: Array<[number, number]>;
    bidders?: PrebidBidderConfig[];
    timeout?: number;
    playbackMethod?: number;
    skip?: 0 | 1;
    skipafter?: number;
    maxduration?: number;
    minduration?: number;
    api?: number[];
    protocols?: number[];
    mimes?: string[];
    /** true ise kazanan bid ham CPM yerine cpm * lossFactors[bidder] (yoksa 1) ile seçilir — yalnızca gamAdUnit boşken (direkt VAST modu) etkilidir. */
    applyLossFactor?: boolean;
    lossFactors?: Record<string, number>;
}

export interface PrebidOptions extends PrebidBreakOptions {
    /** pbjs.setConfig({consentManagement}) içine birebir aktarılır — auction'dan önce, en fazla bir kez. */
    consentManagement?: {
        gdpr?: Record<string, unknown>;
        usp?: Record<string, unknown>;
        gpp?: Record<string, unknown>;
    } | null;
    /** Ayrıca verilmezse midroll hiçbir zaman auction'a girmez, doğrudan adTagMidroll fallback kullanılır. */
    midroll?: PrebidBreakOptions;
}

export interface AdsOptions {
    /** Tek VAST URL ya da sıralı fallback zinciri. */
    adTagPreroll?: string | string[];
    adTagMidroll?: string | string[];
    adTagPostroll?: string | string[];
    /**
     * VMAP: adTagPreroll ile birlikte verilirse preroll ayrı istenir, ardından VMAP değiştirilmeden (midroll/postroll için) istenir.
     * GAM Ad Rule'da bu VMAP'in preroll pod'u 0 olmalı. Tek başına verilirse doğrudan preroll gibi istenir.
     */
    adTagVmap?: string;
    /** Saniye — ilk midrollden önce bekleme + midroll'ler arası aralık. */
    midrollIntervalSeconds?: number;
    /** false (varsayılan): reklam options.ads set edilir edilmez istenir. true: kullanıcı oynatana kadar ertelenir. */
    requestOnPlay?: boolean;
    retry?: AdsRetryOptions;
    /**
     * Opt-in — varsayılan kapalı. true olduğunda sayfadaki CMP (varsa)
     * window.__uspapi (USP/CCPA opt-out) ve window.__tcfapi (TCF2, Google
     * vendor 755 / purpose 1) üzerinden sorgulanır; yetersiz onay/opt-out
     * durumunda google.ima.settings.setPrivacySettings({nonPersonalizedAds:true})
     * zorlanır. IMA SDK zaten TC/GPP string'ini otomatik okuyup ekliyor —
     * bu yalnızca EK bir "Limited Ads" zorlaması.
     */
    consentAware?: boolean;
    /** VideoPrebid header bidding entegrasyonu — preroll + (opsiyonel) midroll. */
    prebid?: PrebidOptions;
    /**
     * Canlı yayında SCTE-35 tetiklemeli reklam — normal preroll/midroll
     * zamanlayıcısı yerine yayın içindeki SCTE-35 OUT/IN sinyalleri reklamı
     * tetikler/bitirir (`video.textTracks` metadata cue'ları üzerinden,
     * hem hls.js hem Safari native HLS için). `adTagLive`, OUT sinyali
     * geldiğinde `generateVastUrl` ile işlenip istenir — VMAP/preroll
     * mekanizmasından bağımsız, kendi retry/fallback zincirini kullanmaz
     * (bkz. `breakTimeoutMs` — IMA bu sürede cevap vermezse içerik devam eder).
     */
    live?: LiveAdsOptions;
    /** Takip edilecek maksimum VAST wrapper (redirect) sayısı — setNumRedirects. Varsayılan 15 (SDK varsayılanı 4). */
    numRedirects?: number;
    /** VAST/wrapper zincirinin çözülmesi için üst sınır (ms) — AdsRequest.vastLoadTimeout. Varsayılan 10000. */
    vastLoadTimeoutMs?: number;
    /** Reklam creative'inin yüklenmesi için üst sınır (ms) — AdsRenderingSettings.loadVideoTimeout. Varsayılan 10000. */
    loadVideoTimeoutMs?: number;
}

export interface LiveAdsOptions {
    scte35?: boolean;
    adTagLive?: string;
    /** IMA bu sürede reklamla cevap vermezse (ms) break'ten vazgeçilir, içerik devam eder. Varsayılan 10000. */
    breakTimeoutMs?: number;
}

/** Basılı tutma: mobilde ileri sarma (step), masaüstünde playbackRate. */
export interface GestureOptions {
    /** Masaüstünde hedef playbackRate, mobilde sarma hızı çarpanı. */
    holdRate?: number;
    /** Mobil: kaç ms'de bir ileri sarılacak. */
    holdIntervalMs?: number;
    /** Basılı tutmanın "hold" sayılması için gereken gecikme. */
    holdDelayMs?: number;
}

export interface LoopSectionOptions {
    /** "Son N saniye" döngüsü için varsayılan uzunluk. */
    seconds?: number;
}

export interface InViewAutoplayOptions {
    /** 0–1, bu orandan az görünürse otomatik duraklatılır. */
    threshold?: number;
    /** true ise yalnızca sessizken (autoplay politikası) viewport'a girince otomatik oynatmayı dener. */
    onlyIfMuted?: boolean;
}

export type StickyCorner = 'br' | 'bl' | 'tr' | 'tl';

export interface StickyOptions {
    enabled?: boolean;
    corner?: StickyCorner;
    /** Yalnızca oynatma aktifken (içerik ya da reklam) sticky'ye izin ver. */
    requirePlaying?: boolean;
    /** Sticky'ye geçmeden önce viewport'ta en az bu kadar ms oynatılmış olmalı. */
    minPlayMs?: number;
    /** Sayfada aynı anda yalnızca bir sticky player. */
    onlyOneSticky?: boolean;
    /** Başka bir player kullanıcı etkileşimiyle play olunca aktif sticky'yi kapat. */
    closeActiveStickyOnAnotherPlay?: boolean;
    userGestureWindowMs?: number;
    /** 'preroll-only' (vars.) yalnızca içerik hiç başlamamışken reklam sticky tetikleyebilir. */
    adCanTriggerSticky?: 'preroll-only' | 'always' | 'never';
    dismissMode?: 'cooldown' | 'never' | 'none';
    cooldownMinutes?: number;
    storage?: 'local' | 'session' | 'memory';
    closeButton?: boolean;
    /** Sticky dock'un yerleştirileceği üst kapsayıcı — verilmezse player'ın parentElement'i kullanılır. */
    wrapperSelector?: string;
}

/** playlist-runner ve story ortak kaynak şeması. */
export interface PlayableItem {
    title?: string;
    spot?: string;
    image?: string;
    date?: string;
    time?: string;
    category?: string;
    duration?: string;
    mp4?: HopeSourceOption[];
    hls?: HopeSourceOption[];
    /** Item bazlı reklam etiketi — verilmezse player/playlist genel adTagPreroll kullanılır. */
    adTagPreroll?: string;
}

export interface PlaylistUiOptions {
    title?: string;
    showCount?: boolean;
    showMeta?: boolean;
}

export interface PlaylistOptions {
    items: PlayableItem[];
    /** 'after_current' (vars.) mevcut video bitene kadar playlist'i başlatmaz. */
    startMode?: 'immediate' | 'after_current';
    startIndex?: number;
    loop?: boolean;
    autoplayNext?: boolean;
    preferHls?: boolean;
    /** item değişiminde AdsController'ın retry/VMAP durumunu sıfırlayıp yeniden reklam iste. */
    adsOnItemChange?: boolean;
    adTagPreroll?: string;
    ui?: PlaylistUiOptions;
}

export interface StoryUiOptions {
    counter?: boolean;
    title?: boolean;
    spot?: boolean;
    dots?: boolean;
    progress?: boolean;
}

export interface StoryGestureOptions {
    swipe?: boolean;
    swipeThreshold?: number;
    wheel?: boolean;
    wheelThreshold?: number;
    wheelCooldownMs?: number;
    keyboard?: boolean;
}

export interface StoryOptions {
    items: PlayableItem[];
    startIndex?: number;
    loop?: boolean;
    autoplayNext?: boolean;
    preferHls?: boolean;
    transitionMs?: number;
    adsOnItemChange?: boolean;
    adTagPreroll?: string;
    gestures?: StoryGestureOptions;
    ui?: StoryUiOptions;
}

export interface MarkerPopupOptions {
    enabled?: boolean;
    mode?: 'rich' | 'text';
    text?: string;
    imageUrl?: string;
    imageAlt?: string;
    linkUrl?: string;
    linkText?: string;
    continueText?: string;
    showContinue?: boolean;
    showClose?: boolean;
    autoplayOnClose?: boolean;
    autoplayOnContinue?: boolean;
}

export interface MarkerPingOptions {
    enabled?: boolean;
    url?: string;
    method?: 'GET' | 'POST';
    includeMarker?: boolean;
}

export interface MarkerAction {
    type: 'log' | 'datalayer' | 'custom';
    name?: string;
    payload?: unknown;
}

export interface MarkerItem {
    time: number;
    color?: string;
    label?: string;
    /** true (vars.) ise marker'a ulaşınca oynatma duraklatılır. */
    pauseOnHit?: boolean;
    /** true (vars.) ise marker yalnızca bir kez tetiklenir; false ise cooldownMs ile tekrar tetiklenebilir. */
    once?: boolean;
    tolerance?: number;
    cooldownMs?: number;
    action?: MarkerAction;
    /** Marker-bazlı popup override — verilmezse options.markerPopup kullanılır. */
    popup?: MarkerPopupOptions;
    pingUrl?: string;
}

export interface MarkersOptions {
    items: MarkerItem[];
    /** true ise seek sırasında da marker tetiklenebilir — vars. false (yalnızca normal oynatma ilerlemesi tetikler). */
    triggerOnSeek?: boolean;
    seekJumpThresholdSec?: number;
    seekIgnoreWindowMs?: number;
    popup?: MarkerPopupOptions;
    ping?: MarkerPingOptions;
}

export interface SegmentItem {
    start: number;
    end: number;
    text?: string;
    color?: string;
}

export interface SpriteThumbnailsOptions {
    /**
     * Sprite sheet URL'i. Tek görsel → tüm videoyu kapsar. Çok parçalı setlerde
     * sheet numarası için şablon: `%d` (1, 2, 3…) ya da sıfır dolgulu `%03d`
     * (001, 002…) — numaralandırma `firstSheetIndex`'ten başlar.
     */
    url?: string;
    /** `url` şablonu yerine sheet URL'lerinin sıralı, açık listesi (her biri `sheetDuration` saniye). */
    sheets?: string[];
    /** WebVTT thumbnail dosyası (`sprite.jpg#xywh=x,y,w,h` cue'ları) — verilirse `url`/`sheets`/kare boyutu/`interval` kullanılmaz. */
    vtt?: string;
    /** Bir karenin piksel boyutu (`url`/`sheets` modunda zorunlu). */
    width?: number;
    height?: number;
    /** Kareler arası saniye. */
    interval?: number;
    /** Bir sheet'in kapsadığı saniye. Verilmezse ilk sheet'in ızgara kapasitesinden hesaplanır: sütun × satır × `interval`. */
    sheetDuration?: number;
    /** Şablondaki ilk sheet numarası (`%d`). */
    firstSheetIndex?: number;
    /** İmlecin altındaki sheet'in iki yanından kaçar sheet önceden yüklensin. */
    preloadSheets?: number;
    /** Player bu genişlikten (px) darsa tooltip boyutu orantılı küçülür. */
    responsive?: number;
    /** navigator.connection.downlink bu değerin altındaysa (ve sheet daha önce cache'lenmediyse) sprite atlanır. */
    downlink?: number;
}

export interface CountdownScreenOptions {
    /** Hedef tarih/saat — Date() ile parse edilebilir herhangi bir string. */
    time: string;
    title?: string;
    spot?: string;
    description?: string;
    coverImage?: string | string[];
    imageChangeInterval?: number;
}

export interface GeoCheckerOptions {
    allowedCountries?: string[];
    region?: 'EU' | 'MENA';
    warningMessages?: string[];
    /** Ülkeyi döndüren JSON API'si (GET). Varsayılan: ücretsiz, anahtarsız geojs — `https://get.geojs.io/v1/ip/geo.json`. */
    apiUrl?: string;
    parameter?: string;
    /** Kendi tespitiniz: ülke kodunu döndüren fonksiyon (ör. header/token gerektiren bir API, sunucu tarafı tespit). Verilirse `apiUrl`/`parameter` kullanılmaz. */
    getCountry?: () => string | Promise<string>;
}

export interface RedirectScreenSuggestion {
    url: string;
    title: string;
    image: string;
}

export interface RedirectScreenOptions {
    enabled?: boolean;
    time: number;
    title?: string;
    image?: string;
    url: string;
    suggestions?: RedirectScreenSuggestion[];
}

export interface SkipButtonsOptions {
    /** Geri sarma süresi (sn); `false` geri butonunu gizler. Varsayılan 10. */
    back?: number | false;
    /** İleri sarma süresi (sn); `false` ileri butonunu gizler. Varsayılan 10. */
    forward?: number | false;
}

export interface PauseAdOptions {
    /** GAM reklam birimi yolu, ör. '/6355419/Travel/Europe/France/Paris'. */
    adUnitPath: string;
    /** İstenecek display boyutları — yalnızca alana sığanlar istenir. Varsayılan [[300,250],[336,280],[250,250],[200,200]]. */
    sizes?: Array<[number, number]>;
    /** Slot düzeyinde key-value hedefleme. */
    targeting?: Record<string, string | string[]>;
    /** Duraklatmadan kaç ms sonra istek atılsın (seek/kısa duraklatmalarda boşuna istek atmamak için). Varsayılan 300. */
    delayMs?: number;
    /** Aynı reklam bu süre (sn) içinde tekrar duraklatılırsa yeni istek atmadan yeniden gösterilir. Varsayılan 30. */
    refreshIntervalSec?: number;
    /** Video alanı bu genişlikten (px) darsa reklam istenmez. Varsayılan 640. */
    minPlayerWidth?: number;
    /** Reklam paneli video alanının en fazla bu oranını kaplar. Varsayılan 0.5. */
    maxWidthRatio?: number;
    /** Panel başlığı — verilmezse dil dosyasındaki "Sponsorlu". */
    label?: string;
    /** Panelin altındaki "Videoya devam et" butonu. Varsayılan true. */
    showResumeButton?: boolean;
}

export interface QrResumeOptions {
    /** QR'nin ortasına yerleştirilecek logo görseli (PNG/SVG URL) — verilmezse düz QR kod. */
    logo?: string;
    /** Logo, QR'nin genişliğinin kaçı kadar alan kaplasın (0-0.3 arası mantıklı) — varsayılan 0.22. Çok büyük değerler taranabilirliği bozabilir (H seviyesi hata düzeltme bile ~%30'u aşan kapatmaları tolere edemez). */
    logoScale?: number;
    /** Devam-URL'ine eklenen query parametresinin adı. Varsayılan 'vtime'. */
    paramName?: string;
    /** Bu süreden (sn) ERKEN duraklatmalarda QR gösterilmez (ör. video daha yeni başlamışken). Varsayılan 60. */
    minElapsed?: number;
    /** Videonun bitişine bu süreden (sn) AZ kalmışsa QR gösterilmez. Varsayılan 60. */
    minRemaining?: number;
    /** QR karekodun piksel boyutu (kare). Varsayılan 220. */
    size?: number;
    /** "Bir daha gösterme" tercihi SİTE GENELİNDE (sabit bir localStorage anahtarıyla, bkz. CaptionRenderer/StickyManager'daki aynı desen) kalıcı olsun mu. Varsayılan true. */
    rememberDismiss?: boolean;
}

export interface DubbingTrack {
    src: string;
    type?: string;
    label: string;
    srclang?: string;
    default?: boolean;
}

export interface DubbingOptions {
    tracks: DubbingTrack[];
}

export interface HopePlayerOptions {
    id?: string;
    /** Tek kaynak — sources verilmemişse kullanılır. .m3u8 ise otomatik HLS. */
    src?: string;
    /** Birden fazla kalite/kaynak — doluysa kalite menüsü gösterilir. */
    sources?: HopeSourceOption[];
    poster?: string;
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    /**
     * Hazır tema preset'i — `data-theme` attribute'u olarak uygulanır (bkz.
     * `theme/tailwind.css`, docs/THEMING.md). Bilinen preset'ler için
     * otomatik tamamlama sağlanıyor, ama herhangi bir string verilebilir
     * (geliştirici kendi `[data-theme='...']` CSS kuralını yazabilir) —
     * bu yüzden union bir literal tip değil, `HopeThemePreset | (string & {})`.
     */
    theme?: HopeThemePreset | (string & {});
    subtitles?: HopeSubtitleOption[];
    playbackRates?: number[];
    /** Fare video üzerinden ayrılınca kontrol çubuğunun/merkez play butonunun kaybolmadan önce beklediği süre (ms). Varsayılan 1200. */
    autoHideDelayMs?: number;
    /**
     * Sayfa açılınca ne kadarının önceden yükleneceği (HTML `preload`). Varsayılan `'metadata'`:
     * yalnızca süre/boyut bilgisi — veri harcamaz, süre ve ilk kare hazır olur.
     */
    preload?: 'none' | 'metadata' | 'auto';
    /** Kontroller gizliyken videonun en altında kenardan kenara 1px ilerleme çizgisi. Varsayılan false. */
    miniProgress?: boolean;
    /** Süre göstergesinde kalan süreyi (-0:10 / 0:15) gösterme. Varsayılan false (geçen süre). */
    showRemainingTime?: boolean;
    /** Oynat butonunun yanında geri/ileri sarma butonları. `true` = 10 sn geri + 10 sn ileri. Varsayılan kapalı. */
    skipButtons?: boolean | SkipButtonsOptions;
    /** ←/→ ve J/L klavye kısayollarıyla kaç saniye sarılır. Varsayılan 5. */
    keyboardSeekStep?: number;
    /**
     * UI dili — hazır gelen `'tr'` (varsayılan) / `'en'`, ya da herhangi bir
     * string (yalnızca `labels` ile TAM override veriliyorsa). Kontrol
     * çubuğu/menüler/ekranlar/plugin UI'larının TÜM sabit metinlerini
     * (reklam dahil — IMA SDK'nın kendi ad-UI dili de bunu takip eder,
     * bkz. `AdsPlayerContext.locale`) etkiler; marker/playlist/segment gibi
     * entegratörün kendi İÇERİK verisini DEĞİŞTİRMEZ (bkz. docs/THEMING.md).
     * HTML attribute olarak da verilebilir (`<hope-player locale="en">`).
     */
    locale?: HopeLocale;
    /** `locale`'in üstüne, yalnızca belirtilen anahtarları override eden kısmi bir sözlük — kendi dilini eklemek ya da birkaç metni özelleştirmek için. */
    labels?: Partial<HopeLocaleStrings>;
    /** true ya da bir AdsOptions objesi — plugin yalnızca bu alan varsa dinamik yüklenir. */
    ads?: boolean | AdsOptions;
    /** Basılı tut → ileri sar/hızlandır. */
    gesture?: boolean | GestureOptions;
    /** A/B döngü — "son N saniye" veya manuel iki nokta. */
    loopSection?: boolean | LoopSectionOptions;
    /** Viewport dışına çıkınca otomatik duraklat, girince devam ettir. */
    inViewAutoplay?: boolean | InViewAutoplayOptions;
    /** Viewport dışına çıkınca köşede küçük (sticky) oynatmaya devam et. */
    sticky?: boolean | StickyOptions;
    /** Tek player üzerinde sıralı oynatma listesi + liste UI. */
    playlist?: PlaylistOptions;
    /** Dikey video akışı (Shorts/Story modu). */
    story?: StoryOptions;
    /** Zaman tabanlı seekbar işaretçileri (popup/ping/custom action destekli). */
    markers?: MarkersOptions;
    /** Seekbar üzerinde bölüm/segment bantları. */
    segments?: SegmentItem[];
    /** Seekbar üzerinde hover-scrub sprite sheet önizlemesi. */
    spriteThumbnails?: SpriteThumbnailsOptions;
    /** Oynatıcı yüklenmeden önce hedef tarihe kadar geri sayım ekranı. */
    countdownScreen?: CountdownScreenOptions;
    /** Oynatıcı yüklenmeden önce IP-coğrafya tabanlı erişim kontrolü. */
    geoChecker?: GeoCheckerOptions;
    /** İçerik bitince "N saniye içinde sıradaki video" ekranı. */
    redirectScreen?: RedirectScreenOptions;
    /** Yeterince izlenmiş bir noktada duraklatılınca "telefonundan devam et" QR kodu. */
    qrResume?: QrResumeOptions;
    /** Duraklatınca video sola sıkışır, sağda Google display (GPT) reklamı gösterilir. */
    pauseAd?: PauseAdOptions;
    /** Ayarlar menüsüne "Ses/Dil" alt menüsü ekler — seçim TÜM kaynağı değiştirir (ayrı dublaj dosyaları). */
    dubbing?: DubbingOptions;
    /** Canlı yayında kontrol çubuğunda duvar saati + seekbar hover tooltip'inde "ne zaman izleniyor / canlıdan ne kadar geride". */
    liveWallClock?: boolean | LiveWallClockOptions;
    /** Google IMA DAI (sunucu taraflı reklam ekleme) — canlı stream manifest'i StreamManager üzerinden istenir. */
    dai?: DaiOptions;
}

export interface LiveWallClockOptions {
    locale?: string;
    timeZone?: string;
    showSeconds?: boolean;
    /** Seekbar hover tooltip'i: 'clock' (duvar saati) | 'behind' (canlıdan -N sn) | 'both'. */
    tooltipMode?: 'clock' | 'behind' | 'both';
}

export interface DaiOptions {
    /** GAM DAI canlı yayın asset key'i. */
    assetKey: string;
    apiKey?: string;
    /** Stream isteği başarısız olursa yüklenecek normal (reklamsız) HLS URL'i. */
    fallbackStreamUrl?: string;
    adTagParameters?: Record<string, string>;
}

export type HopePlayerEventMap = {
    'hp:ready': CustomEvent<void>;
    'hp:play': CustomEvent<void>;
    'hp:pause': CustomEvent<void>;
    'hp:ended': CustomEvent<void>;
    'hp:error': CustomEvent<{ message: string }>;
    'hp:qualitychange': CustomEvent<{ label: string }>;
    'hp:ratechange': CustomEvent<{ rate: number }>;
    'hp:adstart': CustomEvent<{ type: 'preroll' | 'midroll' | 'postroll' }>;
    'hp:adend': CustomEvent<{ type: 'preroll' | 'midroll' | 'postroll' }>;
    'hp:aderror': CustomEvent<{ message: string }>;
    'hp:itemchange': CustomEvent<{ index: number; source: 'playlist' | 'story' }>;
    'hp:sticky': CustomEvent<{ sticky: boolean; corner?: StickyCorner }>;
    'hp:pausead': CustomEvent<{ state: 'shown' | 'hidden' | 'empty'; size?: [number, number]; reason?: 'closed' | 'resumed' }>;
};
