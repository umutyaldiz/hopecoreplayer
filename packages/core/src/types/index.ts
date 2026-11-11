import type { PluginEntry } from '../plugin-api/types';
import type { HlsConfig } from 'hls.js';
import type { MediaPlayerSettingClass } from 'dashjs';
import type { HopeLocale, HopeLocaleStrings } from '../i18n/types';
export type { HopeLocale, HopeLocaleStrings };

/** Hazır tema preset'leri — bkz. theme/tailwind.css ve docs/THEMING.md. */
export type HopeThemePreset =
    | 'glass-light'
    | 'glass-dark'
    | 'neo-dark'
    | 'mono';

/** Kaynak biçimi: `hls` (.m3u8), `dash` (.mpd), `mp4` ya da dosya uzantısı (`webm`, `mov`, `mp3`…) — bkz. `sourcePriority`. */
export type HopeSourceFormat = 'hls' | 'dash' | 'mp4' | 'webm' | (string & {});

export interface HopeSourceOption {
    src: string;
    type?: string;
    /** Kalite menüsünde gösterilecek etiket, ör. "1080p", "Oto". */
    label: string;
    /** Varsayılan seçili kalite. Birden fazlası true ise ilki kullanılır. */
    selected?: boolean;
    /** Görüntü yüksekliği (px). Verilmezse etiketten okunur ("1080p" → 1080) — kalite kilidi (rewardedUnlock) bunu kullanır. */
    height?: number;
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
    /**
     * GAM isteğine eklenecek ek `cust_params` (key-value) — auction kazanılsa da kazanılmasa da (ya da Prebid yüklenemese,
     * retry'da) GAM reklam birimine gider. JSON: `{ "kategori": "spor", "etiket": ["mac", "ozet"], "sezon": 2026 }` ya da
     * metin: `"kategori=spor&etiket=mac,ozet"`. Aynı anahtar tag'de varsa bu kazanır; `hb_*` anahtarları (Prebid
     * hedeflemesi) ezilemez. `midroll.custParams` genel değerlerle birleşir.
     */
    custParams?: CustParams;
}

/** Ad Manager key-value'ları (`cust_params`): JSON nesnesi (değer metin, sayı, boolean ya da dizi) veya `"k=v&k2=a,b"` metni. */
export type CustParams = Record<string, string | number | boolean | Array<string | number>> | string;

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

export type OmidAccessMode = 'full' | 'domain' | 'limited';
export type OmidVendor =
    | 'COMSCORE' | 'DOUBLEVERIFY' | 'GOOGLE' | 'INTEGRAL_AD_SCIENCE' | 'MEETRICS' | 'MOAT'
    | 'NIELSEN' | 'PIXELATE' | 'OTHER';

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
    /**
     * İlk preroll/VMAP isteğinin zamanı. 'visible' (varsayılan): player ekrana yaklaşınca (bir ekran boyu kala) —
     * sayfanın altındaki player için boşa istek atılmaz, kullanıcı oraya ulaştığında reklam çoğunlukla hazırdır.
     * 'load': hemen. 'play': oynatma isteğinde (bekleme istek süresi kadar uzar). Hazırda bekleyen preroll 5 dakikadan
     * eskiyse oynatılırken yeniden istenir.
     */
    requestWhen?: 'visible' | 'load' | 'play';
    /** Eski ad: `true` = `requestWhen: 'play'`. */
    requestOnPlay?: boolean;
    /**
     * Preroll beklenirken içeriğin en fazla bekletileceği süre (ms). İçerik preroll sonuçlanmadan (reklam başladı /
     * gelmedi / hata) oynamaz; bu süre dolarsa reklamsız başlar ve geç gelen preroll gösterilmez. Varsayılan 8000.
     */
    prerollTimeoutMs?: number;
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
    /**
     * iPhone'un yerleşik (native) tam ekranında ve Picture-in-Picture'da reklam görünmez (yalnızca içerik videosu görünür).
     * 'exit' (varsayılan): lineer reklam arası başlarken bu yüzeyden çıkılır, reklam sayfada (görünür, tıklanabilir) oynar;
     * bitince bir dokunuşla geri dönmek için "Tam ekrana dön" butonu gösterilir.
     * 'defer': `midrollIntervalSeconds` midroll'ları kullanıcı yüzeyden çıkana kadar ertelenir. VMAP / SCTE-35 araları
     * zamanını IMA / yayın belirlediği için ertelenemez — bunlarda 'exit' davranışı uygulanır.
     */
    iosFullscreen?: 'exit' | 'defer';
    /**
     * Open Measurement (OM SDK) — reklamın içindeki ölçüm kodlarına (IAS, DoubleVerify, Moat, Google...) verilen erişim.
     * 'full' (varsayılan): ölçüm kodu sayfaya doğrudan erişir, görünürlüğü en doğru ölçer — premium alıcılar bunu ister.
     * 'domain': sayfayla aynı origin'de ama ayrı bir iframe'de. 'limited': izole iframe, yalnızca IMA'nın verdiği sinyaller.
     * Firma bazında: `{ default: 'limited', GOOGLE: 'full', DOUBLEVERIFY: 'full' }` (anahtarlar
     * `google.ima.OmidVerificationVendor` adları; `default` geri kalanlar için).
     */
    omidAccessMode?: OmidAccessMode | ({ default?: OmidAccessMode } & Partial<Record<OmidVendor, OmidAccessMode>>);
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

/** Ses modundaki plak. */
export interface VinylOptions {
    /**
     * Plağın yeri. 'right' (varsayılan): kapaktan sağa doğru yarısı çıkmış plak. 'left': sola doğru.
     * 'center': kapak gösterilmez, plak ortada; kapak plağın etiketinde.
     */
    position?: 'center' | 'left' | 'right';
    /** Plak (ve kapak) yüksekliği, player yüksekliğine oranla — 0.3 ile 1 arası. Varsayılan 0.78. */
    size?: number;
    /**
     * Dakikadaki devir: 33.3 (varsayılan), 45, 78. Plak çalarken bu hızda döner; elle çevrilen her tur
     * (60 / rpm) saniye ileri/geri sarar — 33⅓'te bir tur ≈ 1,8 sn, gerçek bir plak gibi.
     */
    rpm?: number;
    /** Plağı tutup çevirerek ileri/geri sarma (fare ve dokunma). Varsayılan true. */
    scratch?: boolean;
    /**
     * Scratch sırasında gerçek plak sesi (ileri / geri, hıza göre) — Web Audio ile. Varsayılan false.
     * Ses dosyası bir kez indirilip çözülür; 15 dakikadan uzun dosyalarda, HLS'te, CORS izni olmayan başka sunucudaki
     * dosyalarda ya da AudioWorklet olmayan tarayıcıda scratch sessiz çalışır. iPhone sessiz modda bu sesi kısar.
     */
    scratchSound?: boolean;
    /** Çalarken plağın üzerine inen pikap kolu. Varsayılan true. */
    tonearm?: boolean;
}

/** Ses modu: kapaklı, yalnızca ses oynatan player. */
/** Ödüllü reklamın sonucu: ödül verildi, kullanıcı kapattı ya da gösterilecek reklam yok. */
export type RewardedResult = 'granted' | 'closed' | 'nofill';

/** Ödüllü reklam kaynağı. */
export type RewardedProvider =
    /**
     * Google Publisher Tag (GPT) web rewarded — Ad Manager'da ödüllü reklam birimi gerekir. Yalnızca mobil uyumlu
     * sayfalarda (`<meta name="viewport" content="width=device-width, initial-scale=1">`) istenir.
     */
    | { type: 'gpt'; adUnitPath: string; /** Reklam hazır olmazsa vazgeçme süresi (ms). Varsayılan 8000. */ timeoutMs?: number }
    /** Kendi reklam sisteminiz: reklamı gösterip sonucu döndürün. */
    | {
          type: 'custom';
          /** `signal`: kullanıcı reklam hazırlanırken "Vazgeç" derse iptal edilir — reklamınızı durdurabilirsiniz. */
          show: (ctx: { signal: AbortSignal }) => Promise<RewardedResult | boolean>;
      };

/**
 * Ödüllü reklamla kalite kilidi: video düşük kalitede başlar; kullanıcı açıkça kabul edip bir reklam izlerse yüksek
 * kaliteler açılır. Google politikası: reklam yalnızca kullanıcının onayından sonra gösterilir, ödül önceden açıkça
 * yazılır, kullanıcı reklamı kapatabilir ve vazgeçmek videoyu izlemeyi engellemez.
 */
export interface RewardedUnlockOptions {
    provider: RewardedProvider;
    /** Bu yüksekliğe (px) kadar kaliteler serbest; üstü kilitli. Varsayılan 480. */
    maxFreeHeight?: number;
    /**
     * Kilit ne kadar açık kalır: 'video' (kaynak değişene kadar), 'session' (sekme kapanana kadar, varsayılan) ya da
     * dakika (ör. 30 — tarayıcıda saklanır).
     */
    unlockFor?: 'video' | 'session' | number;
    /** Video üzerinde "Yüksek kaliteyi aç" butonu. Varsayılan true. Kapalıysa kilit yalnızca ayarlar menüsünden açılır. */
    button?: boolean;
    /**
     * Reklam gelmezse (boş yanıt, hata, engelleyici, zaman aşımı) kilidi yine de aç — "şu an reklam yoktu" bildirimiyle.
     * Varsayılan true: reklam sistemindeki bir sorun kullanıcıyı düşük kaliteye mahkûm etmesin. `false`: "reklam yok"
     * bilgisi gösterilir, kilit kapalı kalır. Kullanıcı kendisi vazgeçerse kilit hiçbir durumda açılmaz.
     */
    grantOnNoFill?: boolean;
    /** Tarayıcı deposundaki anahtar (birden fazla site / kanal için ayırmak isterseniz). Varsayılan 'hope-rewarded-unlock'. */
    storageKey?: string;
}

/** Sponsorluk API'sinin döndürdüğü yapı. */
export interface SponsorshipConfig {
    /** false ya da yoksa katman kapalı. */
    active: boolean;
    /** Kampanya kimliği — giriş animasyonunun bir kampanya için bir kez gösterilmesi gibi durumlarda kullanılır. */
    id?: string;
    sponsor: {
        name: string;
        /** Logo görseli (PNG / SVG / WebP). */
        logo?: string;
        /** Logoya tıklanınca açılacak adres (yeni sekmede). */
        url?: string;
    };
    /** Player renkleri — CSS renk değerleri. */
    theme?: { accent?: string; onAccent?: string; surface?: string; onSurface?: string };
    /** Köşedeki logo. */
    logo?: {
        position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
        /** Genişlik (px). Varsayılan 96. */
        width?: number;
        /** 0–1. Varsayılan 0.9. */
        opacity?: number;
        /** Logonun yanındaki küçük yazı, ör. "Sunar". */
        label?: string;
    };
    /** Oynatma başlarken bir kez gösterilen "X sunar" kartı. */
    intro?: {
        text?: string;
        durationMs?: number;
        /**
         * Girişi her N dakikada bir tekrar göster (1–240). Gerçek izleme süresi sayılır: duraklatılmışken, sekme arka
         * plandayken ve reklam sırasında sayaç işlemez. Verilmezse yalnızca oynatma başında bir kez.
         */
        repeatMinutes?: number;
        /** Kampanya başına en fazla kaç kez gösterilsin (ilk gösterim dahil). Verilmezse sınır yok. */
        maxShows?: number;
    };
    /** Geçerlilik aralığı (ISO 8601). Dışındaysa katman uygulanmaz. */
    validFrom?: string;
    validUntil?: string;
    /** Takip pikselleri: gösterimde ve tıklamada GET ile çağrılır. */
    tracking?: {
        /** Kampanya başına bir kez (ilk oynatmada). */
        impression?: string[];
        click?: string[];
        /** Giriş kartı her gösterildiğinde (tekrarlar dahil). */
        intro?: string[];
    };
}

/**
 * Sponsorluk katmanı: player açılışta (ve istenirse periyodik) sizin API'nize istek atar; dönen ayarlarla renkler,
 * köşe logosu ve "X sunar" girişi uygulanır. API'yi kendi sisteminizde siz sağlarsınız (bkz. SponsorshipConfig).
 */
export interface SponsorshipOptions {
    /** JSON döndüren adres (GET). */
    endpoint: string;
    /** Adrese eklenecek sorgu parametreleri (ör. kanal, kategori). */
    params?: Record<string, string>;
    /** fetch ayarları (ör. credentials, headers). */
    fetchInit?: RequestInit;
    /** Canlı yayında kampanya değişimi için yenileme aralığı (sn). Verilmezse bir kez istenir. */
    refreshSeconds?: number;
    /** İstek zaman aşımı (ms). Varsayılan 5000. */
    timeoutMs?: number;
}

/**
 * Reklam tetikleyicisi: ne zaman bir Ad Manager (DFP) out-of-page reklamının isteneceği. `delay` (sn): olaydan bu kadar
 * sonra — o ana kadar koşul bozulursa (ör. tam ekrandan çıkıldı, oynatma devam etti) iptal.
 */
export type AdTrigger =
    /** İçerikte belirli saniyeler (VOD); canlıda gerçek izleme süresi. Doğal ilerlemede tetiklenir — ileri sarınca atlanır. */
    | { type: 'time'; at: number[] }
    /** Her N sn gerçek izlemede (duraklatma, arka plan sekme ve reklam sayılmaz). İlki `startAfter` sn sonra (varsayılan `every`). */
    | { type: 'interval'; every: number; startAfter?: number }
    /** İçeriğin yüzdesi (1–99), yalnızca VOD. */
    | { type: 'percent'; at: number[] }
    /** Tam ekrana her girişte. */
    | { type: 'fullscreen'; delay?: number }
    /** Tam ekrandan her çıkışta. */
    | { type: 'fullscreenExit'; delay?: number }
    /** İçerik ilk kez oynamaya başlayınca. */
    | { type: 'start'; delay?: number }
    /** Kullanıcı duraklatınca (hâlâ duraklatılmışsa). */
    | { type: 'pause'; delay?: number }
    /** Duraklatmadan sonra devam edince. */
    | { type: 'resume'; delay?: number }
    /** İçerik bitince. */
    | { type: 'ended'; delay?: number };

/** Ad Manager key-value'ları: JSON nesnesi (değer metin, sayı, boolean ya da dizi) veya `"k=v&k2=a,b"` metni. */
export type AdTriggerCustParams = CustParams;

export type AdTriggerLayout = 'none' | 'full' | 'center' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Tek bir reklam kuralı: hangi reklam birimi, hangi olaylarda, nasıl gösterilsin. */
export interface AdTriggerRule {
    /** Kural kimliği — olaylarda ve `hp_rule` hedeflemesinde. */
    id?: string;
    /** Ad Manager reklam birimi yolu, ör. '/1234567/video_oop'. Out-of-page slot olarak istenir; içeriği Ad Manager'da ne doldurulursa o. */
    adUnitPath: string;
    /** 'any' (varsayılan): her durumda. 'fullscreen': yalnızca tam ekrandayken. 'normal': yalnızca tam ekran değilken. */
    mode?: 'any' | 'normal' | 'fullscreen';
    triggers: AdTrigger[];
    /** Slot hedeflemesi (key-value). Player ayrıca `hp_trigger`, `hp_mode`, `hp_rule` ekler. */
    targeting?: Record<string, string | string[]>;
    /**
     * DFP isteğinin `cust_params` (key-value) değerleri — JSON: `{ "kategori": "spor", "etiket": ["mac", "ozet"], "sezon": 2026 }`
     * ya da metin: `"kategori=spor&etiket=mac,ozet"`. API yanıtında `cust_params` adıyla da yazılabilir. `targeting`'i ezer.
     */
    custParams?: AdTriggerCustParams;
    /**
     * Reklam kutusunun player içindeki yeri. 'none' (varsayılan): player yalnızca out-of-page isteğini atar ve kreatifi
     * player içine yerleştirir — kutu, etiket, kapat butonu, karartma yok; görünüm ve kapanış kreatifin kendi kodunda
     * (kapatmak için `player.closeAdTrigger()`). 'full': tüm video alanı; diğerleri o köşede/kenarda bir kutu.
     */
    layout?: AdTriggerLayout;
    /** Kutu boyutu [genişlik, yükseklik] px ('full' dışı) — sığmazsa oranı korunarak küçülür. Verilmezse reklamın kendi boyutu. */
    size?: [number, number];
    /** Arkayı karart ('none' dışı). Varsayılan false ('full' düzende true). */
    backdrop?: boolean;
    /** Reklam görünürken içeriği duraklat, kapanınca devam et. Varsayılan false. */
    pauseContent?: boolean;
    /** Kapat (X) butonu ('none' dışı). Varsayılan true. */
    closeButton?: boolean;
    /** Kapat butonu kaç sn sonra görünsün. Varsayılan 0. */
    closeDelay?: number;
    /** Kaç sn sonra kendiliğinden kapansın. Verilmezse kullanıcı kapatana / koşul bozulana kadar. */
    duration?: number;
    /** Kutunun üstündeki "Reklam" etiketi ('none' dışı) — metin ya da `false` (gizle). */
    label?: string | false;
    /** Video başına en fazla kaç gösterim (dolu gelenler). */
    maxShows?: number;
    /** Bu kuralın iki gösterimi arasındaki en az süre (sn). */
    minGapSeconds?: number;
    /** Player bu genişlikten (px) darsa istenmez. */
    minPlayerWidth?: number;
    /** Takip pikselleri (GET). */
    tracking?: { impression?: string[]; close?: string[]; empty?: string[] };
}

/** Reklam tetikleyici API'sinin döndürdüğü yapı. */
export interface AdTriggersConfig {
    /** false ya da yoksa modül kapalı. */
    active: boolean;
    id?: string;
    /** Geçerlilik aralığı (ISO 8601). */
    validFrom?: string;
    validUntil?: string;
    /** Herhangi iki reklam arasındaki en az süre (sn), tüm kurallar için. Varsayılan 30. */
    minGapSeconds?: number;
    rules: AdTriggerRule[];
}

/**
 * Reklam tetikleyici: kurallar sizin API'nizden (`endpoint` + `params`) ya da doğrudan `config` ile gelir; belirlenen
 * anlarda (saniye, aralık, yüzde, tam ekrana giriş, duraklatma…) Ad Manager out-of-page reklamı istenip player içinde
 * gösterilir — tam ekranda da.
 */
export interface AdTriggersOptions {
    /** JSON (AdTriggersConfig) döndüren adres (GET). */
    endpoint?: string;
    /** Adrese eklenecek sorgu parametreleri. */
    params?: Record<string, string>;
    fetchInit?: RequestInit;
    /** API yerine doğrudan kurallar (ya da endpoint'e ulaşılamazsa kullanılacak varsayılan). */
    config?: AdTriggersConfig;
    /** Kuralları periyodik yeniden çek (sn, en az 10). */
    refreshSeconds?: number;
    /** API isteği zaman aşımı (ms). Varsayılan 5000. */
    timeoutMs?: number;
    /** GPT yükleme + reklam yanıtı için en fazla bekleme (ms) — aşılırsa boş sayılır. Varsayılan 8000. */
    renderTimeoutMs?: number;
    /** Tüm slotlara eklenecek hedefleme (ör. içerik kimliği, kategori). */
    targeting?: Record<string, string | string[]>;
    /** Tüm isteklere eklenecek `cust_params` (sayfa / içerik bilgisi) — kuralın kendi `custParams`'ı aynı anahtarı ezer. */
    custParams?: AdTriggerCustParams;
}

/** TV'ye gönderilecek kaynak: adres ya da adres + MIME türü. */
export type CastSource = string | { src: string; type?: string };

/**
 * TV'ye yayın (Google Cast / AirPlay). Hepsi varsayılan olarak kapalı — açtığınız yollar kontrol çubuğuna buton
 * olarak gelir; buton yalnızca yakında uygun bir cihaz varken görünür.
 */
export interface CastOptions {
    /**
     * Google Cast: Chromecast, Google TV, Android TV ve Cast destekli TV'ler. Chrome / Edge (masaüstü ve Android),
     * yalnızca HTTPS. Cast SDK yalnızca bu açıksa ve tarayıcı destekliyorsa yüklenir. Varsayılan false.
     */
    chromecast?: boolean;
    /** AirPlay: Safari (iPhone, iPad, Mac) → Apple TV / AirPlay destekli TV. Varsayılan false. */
    airplay?: boolean;
    /**
     * Tarayıcının kendi "cihaza yayınla" seçicisi (Remote Playback API) — Cast SDK'sız Android Chrome gibi durumlar için.
     * Yalnızca doğrudan adresli kaynaklarda (MP4 vb., hls.js değil). Varsayılan false.
     */
    remotePlayback?: boolean;
    /** Cast receiver uygulama kimliği. Varsayılan Google'ın Default Media Receiver'ı ('CC1AD845'). */
    receiverAppId?: string;
    /**
     * TV'ye gönderilecek ayrı kaynak (ör. TV'ye özel imzalı adres). Fonksiyon o an çalan kaynağı alır.
     * Verilmezse çalan kaynak gönderilir (TV adrese erişebilmeli; HLS için CORS gerekir).
     */
    source?: CastSource | ((current: { src: string; type?: string }) => CastSource);
    /** TV ekranında gösterilecek bilgiler. Verilmezse ses modunun başlık / sanatçı / kapağı ya da `poster`. */
    metadata?: { title?: string; subtitle?: string; image?: string };
    /**
     * TV'de reklam (Google Cast). true (varsayılan): `ads` seçeneğindeki VMAP ya da preroll / midroll / postroll
     * VAST tag'leri receiver'a gönderilir, reklamları TV oynatır. false: reklamsız. Nesne: TV'ye özel tag'ler.
     */
    ads?: boolean | { vmap?: string; preroll?: string; midroll?: string; midrollIntervalSeconds?: number; postroll?: string };
    /** HLS segment biçimi (receiver bunu tahmin edemez): 'ts' (varsayılan) ya da 'fmp4'. */
    hlsSegmentFormat?: 'ts' | 'fmp4';
}

export interface AudioOptions {
    /** Kapak görseli. Verilmezse `poster` kullanılır; o da yoksa temanın renkleriyle düz bir zemin. */
    cover?: string;
    title?: string;
    artist?: string;
    album?: string;
    /**
     * 'full' (varsayılan): kapak, plak, başlık. 'compact': yalnızca kontrol çubuğu kadar ince bir player — başlık ve
     * sanatçı çubuğun içinde; kapak / plak gösterilmez. Yükseklik CSS'ten: `--hp-audio-bar-height` (varsayılan 84px).
     */
    layout?: 'full' | 'compact';
    /** Plak. `false`: yalnızca kapak. Varsayılan açık. */
    vinyl?: boolean | VinylOptions;
    /**
     * İşletim sisteminin medya kontrolleri (kilit ekranı, bildirim, klavye medya tuşları): başlık, sanatçı, kapak ve
     * oynat / duraklat / ileri-geri sar. Varsayılan true.
     */
    mediaSession?: boolean;
    /**
     * Ses reklamı sırasında gösterilecek görsel. Verilmezse reklam boyunca player'ın kendi kapak / plak sahnesi görünür.
     * Verilirse IMA bunu (reklamın kendi görseli yoksa) çizer — IMA görseli ölçeklemez: genişliği player'dan,
     * yüksekliği player'dan 75 px az olmalı. Ses reklamı için reklam tag'inde `ad_type=audio` ya da
     * `ad_type=audio_video` (ve `vpmute=0`) olmalıdır.
     */
    adPoster?: string;
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

/** Erişilebilirlik görüntü filtresi. `none` = doğal (filtre yok). */
export type AccessibilityFilter = 'none' | 'grayscale' | 'daylight' | 'night' | 'contrast' | 'protanopia' | 'deuteranopia' | 'tritanopia';

/** İzleyicinin erişilebilirlik tercihleri (`hp:accessibility` olayının detayı). */
export interface AccessibilityState {
    /** Yakınlaştırma çarpanı (1 = yok). */
    zoom: number;
    filter: AccessibilityFilter;
    /** İki kanal tek kanala karıştırılır (tek kulakla duyanlar için). */
    mono: boolean;
    /** Ses güçlendirme çarpanı (1 = yok). */
    boost: number;
    largeControls: boolean;
}

/**
 * `options.accessibility` — ayarlar menüsünde "Erişilebilirlik" alt menüsü. `true` hepsini açar; nesneyle tek tek
 * kapatılabilir / listeler değiştirilebilir. İzleyicinin seçimleri bu sitede hatırlanır (`remember`).
 */
export interface AccessibilityOptions {
    /** Yakınlaştırma seviyeleri ya da false. Varsayılan [1, 1.25, 1.5, 2, 3]. Sürükle / Shift+ok ile kaydır, iki parmakla büyüt. */
    zoom?: boolean | number[];
    /** Sunulan filtreler ya da false. Varsayılan hepsi. */
    filters?: boolean | AccessibilityFilter[];
    /**
     * Mono ses ve ses güçlendirme (Web Audio). Varsayılan true. Başka alan adından gelen ve CORS izni olmayan kaynakta
     * Web Audio sesi kısardı — orada satırlar "kullanılamaz" görünür.
     */
    audio?: boolean;
    /** Ses güçlendirme seviyeleri. Varsayılan [1, 1.5, 2, 3]. */
    boostLevels?: number[];
    /** "Büyük kontroller". Varsayılan true. */
    largeControls?: boolean;
    /** "Klavye kısayolları" paneli (menü satırı ve `?` tuşu). Varsayılan true. */
    shortcuts?: boolean;
    /** Seçimler tarayıcıda (localStorage) hatırlansın. Varsayılan true. */
    remember?: boolean;
}

/** `options.history` — zaman ve ses geçmişi (tarayıcıda, localStorage). */
export interface HistoryOptions {
    /** Kaldığı yerden devam. Varsayılan true. */
    position?: boolean;
    /** Ses seviyesi ve sessiz durumu sitede hatırlanır. Varsayılan true. `muted: true` (sessiz otomatik oynatma) her zaman kazanır. */
    volume?: boolean;
    /** Videonun kimliği — verilmezse kaynak adresi. Aynı video farklı adreslerden (imzalı URL, CDN) geliyorsa verin. */
    id?: string;
    /** "Kaldığınız yerden devam: 0:42 · Baştan başla" bildirimi. Varsayılan true. */
    notice?: boolean;
    /** Bu kadar saniye izlenmeden konum kaydedilmez. Varsayılan 10. */
    minWatched?: number;
    /** Sona bu kadar saniye kala izlenmiş sayılır, kayıt silinir. Varsayılan 15. */
    endMargin?: number;
    /** En fazla kaç videonun konumu tutulsun (en yeniler). Varsayılan 50. */
    maxEntries?: number;
    /** Bu kadar gün açılmayan videonun kaydı silinir. Varsayılan 30. */
    ttlDays?: number;
}

/** Atlanabilir bölüm türü — butonun varsayılan metnini belirler ("İntroyu atla", "Özeti atla", "Jeneriği atla", "Atla"). */
export type SkipSegmentType = 'intro' | 'recap' | 'credits' | 'custom';

/** "İntroyu atla" gibi bir buton: bölüm oynarken görünür, basınca bölümün sonuna atlar. */
export interface SkipSegment {
    /** Bölümün başlangıcı (sn). Buton bu andan itibaren görünür (bkz. `showFrom`). */
    start: number;
    /** Bölümün sonu (sn) — buton buraya atlar. Verilmezse videonun sonu (jenerik: playlist'te sıradakine geçer). */
    end?: number;
    /** Varsayılan `'intro'`. */
    type?: SkipSegmentType;
    /** Buton metni — verilmezse türe göre dil dosyasından. */
    label?: string;
    /** Varsayılan `'bottom-right'`. */
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    /**
     * Butonun ekranda görünmeye başladığı an (sn, videonun zamanı) — varsayılan `start`. Ör. intro 0–90 sn ama buton
     * 5. sn'de çıksın: `{ start: 0, end: 90, showFrom: 5 }`. `start`'tan önce olamaz.
     */
    showFrom?: number;
    /** Butonun kalktığı an (sn) — varsayılan `end`. Bölüm sürse de buton daha erken kalksın diye. Atlama yine `end`'e. */
    showUntil?: number;
    /**
     * Buton ilk göründükten bu kadar sn sonra kendiliğinden gizlenir; kontroller açıldığında (fare / dokunuş) bölüm
     * bitene kadar yeniden görünür. Varsayılan 0 = bölüm boyunca hep görünür.
     */
    hideAfter?: number;
    /**
     * Basılmasa da atla. `true`: hemen; sayı: o kadar sn geri sayımla (buton dolar, basınca hemen atlar).
     * Kullanıcı bölüm içinde geri sararsa otomatik atlama o gösterim için iptal olur. Varsayılan false.
     */
    autoSkip?: boolean | number;
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
    /** Önizlemenin ekrandaki genişliği (CSS px). Kare daha büyükse (ör. 320×180 → 160) retina'da keskin görünür. */
    displayWidth?: number;
    /** Tüm videoyu kapsayan küçük sheet: asıl sheet inene kadar anında (bulanık) önizleme. */
    lowRes?: SpriteLowResOptions;
}

/** `spriteThumbnails.lowRes` — ör. 48×27 karelerden tek görsel. */
export interface SpriteLowResOptions {
    url: string;
    width: number;
    height: number;
    /** Kareler arası saniye; verilmezse `süre / kare sayısı`. */
    interval?: number;
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
    /** Görselin üstündeki süre rozeti, ör. "12:34". */
    duration?: string;
}

export type RedirectCardPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface RedirectScreenOptions {
    enabled?: boolean;
    /** 'screen' modunda video bittikten sonraki geri sayım (sn). */
    time: number;
    /** Sıradaki videonun başlığı. */
    title?: string;
    /** Sıradaki videonun görseli (16:9 önerilir). */
    image?: string;
    /** Yönlendirilecek adres. */
    url: string;
    /** İptal edilince (ya da 'card' modunda iptalden sonra video bitince) gösterilecek öneriler. */
    suggestions?: RedirectScreenSuggestion[];
    /**
     * 'screen' (varsayılan): video bitince tam alan "Sıradaki video" ekranı + `time` sn geri sayım.
     * 'card': video bitmeden `showBefore` sn kala köşede küçük "Sıradaki" kartı; geri sayım videoyla birlikte işler,
     * video bitince yönlendirilir. Karta tıklayınca hemen gidilir, X ile iptal edilir.
     */
    mode?: 'screen' | 'card';
    /** 'card' modunda bitişe kaç sn kala kart görünsün. Varsayılan 10. */
    showBefore?: number;
    /** 'card' modunda kartın köşesi. Varsayılan 'bottom-right'. */
    position?: RedirectCardPosition;
    /** Üst etiket, ör. "Sıradaki" / "Şimdi izle". Verilmezse dil dosyasından. */
    label?: string;
    /** Başlığın altındaki kısa metin (kanal, kategori…). */
    subtitle?: string;
    /** Görselin üstündeki süre rozeti, ör. "12:34". */
    duration?: string;
    /** Yeni sekmede aç. Varsayılan false (aynı sekmede). */
    newTab?: boolean;
}

/** `options.hls` — HLS (.m3u8) oynatma ayarları. */
export interface HopeHlsOptions {
    /**
     * `'auto'` (varsayılan): Safari/iOS'ta tarayıcının kendi HLS oynatıcısı, diğerlerinde hls.js.
     * `'hls.js'`: MSE/ManagedMediaSource varsa her yerde hls.js — Safari'de de kalite/ses menüsü ve buffer ayarları.
     * `'native'`: tarayıcı destekliyorsa her zaman kendi HLS oynatıcısı.
     */
    engine?: 'auto' | 'hls.js' | 'native';
    /**
     * Hangi hls.js paketi indirilsin (yalnızca hls.js ile oynarken). `'full'` (varsayılan): tümü.
     * `'light'`: hls.js'in hafif paketi (~%40 küçük) — kalite menüsü, ABR, canlı / DVR, SCTE-35 ve
     * EXT-X-PROGRAM-DATE-TIME çalışır; yayının kendi altyazıları (WebVTT / IMSC1 / CEA-608), alternatif ses izleri
     * (EXT-X-MEDIA AUDIO), DRM (EME), CMCD ve interstitials yoktur. `options.subtitles` ile verilen altyazılar etkilenmez.
     */
    build?: 'full' | 'light';
    /** hls.js ayarları — olduğu gibi `new Hls(config)`'e geçer (buffer, ABR, düşük gecikme, ağ...). Yalnızca hls.js ile oynarken etkili. */
    config?: Partial<HlsConfig>;
    /** Manifest/segment isteklerinde cookie ve kimlik bilgisi gönder (CORS `credentials: include`). */
    withCredentials?: boolean;
}

/** DASH (.mpd) oynatma ayarları — dash.js yalnızca DASH kaynağı gelince indirilir. */
export interface HopeDashOptions {
    /** dash.js ayarları — olduğu gibi `player.updateSettings()`'e geçer (buffer, ABR, düşük gecikme...). */
    settings?: MediaPlayerSettingClass;
    /** Manifest / segment isteklerinde cookie ve kimlik bilgisi gönder. */
    withCredentials?: boolean;
}

/** Bir DRM sisteminin lisans sunucusu. */
export interface HopeDrmLicense {
    licenseUrl: string;
    /** Lisans isteğine eklenecek başlıklar (ör. yetki token'ı). */
    headers?: Record<string, string>;
    /** Lisans isteğinde cookie gönder. */
    withCredentials?: boolean;
}

export interface HopeFairPlayOptions extends HopeDrmLicense {
    /** FairPlay sertifikası (ikili `.cer`) adresi. */
    certificateUrl: string;
    /** SPC'den istek gövdesi üretir (sunucu base64 / JSON istiyorsa). Varsayılan: ham ikili SPC. */
    prepareLicenseRequest?(spc: Uint8Array, initData: Uint8Array): BodyInit | Promise<BodyInit>;
    /** Sunucu yanıtından CKC'yi çıkarır. Varsayılan: yanıtın kendisi. */
    parseLicenseResponse?(response: ArrayBuffer): BufferSource | Promise<BufferSource>;
}

/**
 * Şifreli içerik (EME). Yalnızca verilen sistemler denenir; tarayıcı desteklediği ilkini kullanır:
 * Chrome / Firefox / Android → Widevine, Edge → Widevine / PlayReady, Safari → FairPlay. ClearKey test içindir.
 */
export interface HopeDrmOptions {
    widevine?: HopeDrmLicense & { /** Ör. `'SW_SECURE_CRYPTO'`, `'HW_SECURE_ALL'`. */ robustness?: string };
    playready?: HopeDrmLicense;
    fairplay?: HopeFairPlayOptions;
    clearkey?: HopeDrmLicense;
}

export type HopeAnalyticsEventType =
    | 'session_start'
    | 'start'
    | 'pause'
    | 'resume'
    | 'seek'
    | 'rebuffer'
    | 'quality'
    | 'progress'
    | 'ended'
    | 'error'
    | 'ad_start'
    | 'ad_end'
    | 'volume'
    | 'fullscreen'
    | 'pip'
    | 'heartbeat'
    | 'session_end';

/** Oturumun deneyim (QoE) ölçümleri — `player.qoe` ve her gönderimde. */
export interface HopeQoeMetrics {
    /** Oynatma isteğinden ilk kareye (ms, reklam hariç); başlamadıysa null. */
    startupMs: number | null;
    /** İzlenen içerik süresi (sn) — sarılan kısımlar sayılmaz. */
    watchedSeconds: number;
    rebufferCount: number;
    rebufferMs: number;
    /** Takılma süresi / (izleme + takılma). */
    rebufferRatio: number;
    seekCount: number;
    qualitySwitches: number;
    /** İzleme süresine göre ağırlıklı ortalama video bit hızı (bps); bilinmiyorsa null. */
    avgBitrate: number | null;
    /** O anki video yüksekliği ve bit hızı. */
    height: number | null;
    bitrate: number | null;
    /** Ulaşılan en ileri konum (%, canlıda 0). */
    maxProgress: number;
    errors: number;
    adCount: number;
    adMs: number;
    droppedFrames: number;
}

export interface HopeAnalyticsEvent {
    type: HopeAnalyticsEventType;
    /** Oturum başından beri (ms). */
    at: number;
    /** Video konumu (sn). */
    position: number;
    data?: Record<string, string | number | boolean | null>;
}

/** Uç noktaya gönderilen paket. */
export interface HopeAnalyticsPayload {
    v: 1;
    sessionId: string;
    videoId: string;
    src: string | null;
    /** `interval` | `end` | `pagehide` | `source` | `destroy`. */
    reason: string;
    sentAt: number;
    events: HopeAnalyticsEvent[];
    metrics: HopeQoeMetrics;
    custom?: Record<string, string | number | boolean>;
    engine: string;
    live: boolean;
    duration: number | null;
}

export interface HopeAnalyticsOptions {
    /** Paketlerin POST edileceği adres (JSON). Verilmezse yalnızca olaylar / `onEvent` / GA4. */
    endpoint?: string;
    /** Toplu gönderim aralığı (ms). Varsayılan 15000. */
    intervalMs?: number;
    /** Video kimliği. Varsayılan `options.id`, yoksa kaynak adresi. */
    videoId?: string;
    /** Her pakete eklenen alanlar (ör. kullanıcı segmenti, sayfa türü). */
    custom?: Record<string, string | number | boolean>;
    /** Verilirse `sendBeacon` yerine `fetch` (keepalive) kullanılır. */
    headers?: Record<string, string>;
    /**
     * GA4 video olayları (`video_start`, `video_progress`, `video_complete`). `true`: `gtag` varsa onunla, yoksa
     * `dataLayer.push({ event, … })` (Google Tag Manager). `'gtag'` / `'dataLayer'` yolu zorlar.
     */
    ga4?: boolean | 'gtag' | 'dataLayer';
    /** Her olayda. */
    onEvent?(event: HopeAnalyticsEvent, metrics: HopeQoeMetrics): void;
    /** Gönderim öncesi paketi değiştirir; `false` dönerse gönderilmez. */
    beforeSend?(payload: HopeAnalyticsPayload): HopeAnalyticsPayload | false;
}

/** Çoklu dokunuş hareketi türü — ileride `'tripletap'` eklenebilir. */
export type TapGestureType = 'doubletap';
/** Ekranın bölgesi: sol/sağ üçte bir, orta, ya da tamamı. */
export type TapRegion = 'left' | 'center' | 'right' | 'full';
export type TapPointer = 'touch' | 'mouse' | 'pen' | 'any';
export type TapAction = 'seekStep' | 'togglePlay' | 'toggleFullscreen' | 'toggleMute';

export interface TapGesture {
    type: TapGestureType;
    region: TapRegion;
    /** Hangi işaretçiyle — varsayılan `'touch'` (masaüstünde çift tık normal davranışını korur). */
    pointer?: TapPointer;
    action: TapAction;
    /** `seekStep` için saniye; negatif = geri. Verilmezse solda -10, sağda +10. */
    value?: number;
}

export interface ContextMenuOptions {
    /** Menüye "İstatistikler" satırı ekler — player üstünde canlı teknik bilgi paneli açar. Varsayılan false. */
    stats?: boolean;
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
    /**
     * Birden fazla kalite/kaynak — doluysa kalite menüsü gösterilir. Farklı biçimler (ör. bir HLS + MP4 kaliteleri)
     * biçime göre gruplanır: bir grup çalınır ve menüde yalnızca onun kaliteleri görünür; grup ölümcül hata verirse
     * (yüklenemedi, desteklenmiyor, yayın koptu) konum korunarak sıradaki gruba geçilir. Sıra: `sourcePriority`.
     */
    sources?: HopeSourceOption[];
    /**
     * Biçim grupları hangi sırayla denensin, ör. `['hls', 'mp4']`. Verilmezse listede ilk görünme sırası.
     * Listede olmayan biçimler sona eklenir. Tarayıcının hiç oynatamadığı biçim (ör. Safari'de webm) atlanır.
     */
    sourcePriority?: HopeSourceFormat[];
    poster?: string;
    /**
     * Ses modu: video alanında kapak, plak ve başlık; tam ekran / PiP butonları gizlenir, kontroller hep görünür kalır.
     * `src` bir ses dosyası (mp3, m4a, aac, ogg, wav, flac) ya da yalnızca ses içeren bir HLS olabilir.
     */
    audio?: boolean | AudioOptions;
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
    /** Ayarlar menüsündeki oynatma hızları. Varsayılan [0.5, 0.75, 1, 1.25, 1.5, 2]. `[]` "Oynatma hızı" satırını kaldırır. */
    playbackRates?: number[];
    /**
     * Ayarlar ikonunun köşesinde oynayan görüntünün kalite rozeti: "HD" (720p+), "2K" (1440p), "4K" (2160p), "8K".
     * Gerçekten oynayan çözünürlükten okunur ("Otomatik"te de ABR'nin o anki kalitesi). 720p altında rozet yok.
     * Varsayılan true; `false` gizler.
     */
    qualityBadge?: boolean;
    /**
     * Canlı yayında ilerleme çubuğu (geri sarılabilir canlıda DVR çubuğu). Varsayılan true; `false` canlıda gizler —
     * "● CANLI" rozeti ve klavyeyle sarma kalır. VOD'u etkilemez.
     */
    liveSeekBar?: boolean;
    /** Kontrol çubuğundaki Picture-in-Picture butonu. Varsayılan true (tarayıcı destekliyorsa); `false` gizler. */
    pipButton?: boolean;
    /**
     * Kontrol çubuğundaki tam ekran butonu. Varsayılan true; `false` gizler. Yalnızca buton: `F` kısayolu ve
     * `tapGestures`'taki `toggleFullscreen` çalışmaya devam eder.
     */
    fullscreenButton?: boolean;
    /** Fare video üzerinden ayrılınca kontrol çubuğunun/merkez play butonunun kaybolmadan önce beklediği süre (ms). Varsayılan 1200. */
    autoHideDelayMs?: number;
    /** Video oynarken fare bu süre (ms) kıpırdamazsa imleç gizlenir; `false` = hiç gizleme. Varsayılan 5000. */
    cursorHideDelayMs?: number | false;
    /**
     * Videoya dokununca/tıklayınca oynat/duraklat. `'auto'` (varsayılan): dar player'da (kompakt düzen, tam ekran
     * dışında) dokunmatikte kapalı — dokunuş kontrolleri gösterir/gizler; büyük player'da ve fareyle açık.
     * `true`: her zaman açık, `false`: hiç (yalnızca oynat butonu).
     */
    tapToPlay?: 'auto' | boolean;
    /**
     * Sayfa açılınca ne kadarının önceden yükleneceği (HTML `preload`). Varsayılan `'metadata'`:
     * yalnızca süre/boyut bilgisi — veri harcamaz, süre ve ilk kare hazır olur.
     */
    preload?: 'none' | 'metadata' | 'auto';
    /** Kontroller gizliyken videonun en altında kenardan kenara 1px ilerleme çizgisi. Varsayılan false. */
    miniProgress?: boolean;
    /**
     * Player'ın en-boy oranı: '16 / 9' (varsayılan), '4 / 3', '21 / 9', '9 / 16', '1 / 1' — '21:9' yazımı ya da sayı
     * (2.35) da olur. Video farklı orandaysa siyah bantlarla sığdırılır. Tam ekran ve story kendi oranını kullanır.
     * CSS'ten de verilebilir: `hope-player { --hp-aspect-ratio: 21 / 9; }`.
     */
    aspectRatio?: string | number;
    /** Ödüllü reklamla yüksek kalite kilidi — bkz. RewardedUnlockOptions. */
    rewardedUnlock?: RewardedUnlockOptions;
    /** Sponsorluk katmanı (renkler, logo, giriş) — ayarları sizin API'nizden alır. */
    sponsorship?: SponsorshipOptions;
    /** Kurallara göre (saniye, tam ekrana giriş, duraklatma…) tetiklenen Ad Manager out-of-page reklamları — bkz. AdTriggersOptions. */
    adTriggers?: AdTriggersOptions;
    /** TV'ye yayın: Google Cast (Chromecast) ve AirPlay — varsayılan kapalı, bkz. CastOptions. */
    cast?: CastOptions;
    /** Süre göstergesinde kalan süreyi (-0:10 / 0:15) gösterme. Varsayılan false (geçen süre). */
    showRemainingTime?: boolean;
    /** Oynat butonunun yanında geri/ileri sarma butonları. `true` = 10 sn geri + 10 sn ileri. Varsayılan kapalı. */
    skipButtons?: boolean | SkipButtonsOptions;
    /** ←/→ ve J/L klavye kısayollarıyla kaç saniye sarılır. Varsayılan 5. */
    keyboardSeekStep?: number;
    /** HLS oynatma ayarları — motor seçimi, hls.js config'i (buffer/ABR/düşük gecikme), kimlik bilgisi. */
    hls?: HopeHlsOptions;
    /** DASH (.mpd) oynatma ayarları. */
    dash?: HopeDashOptions;
    /** Şifreli içerik (Widevine / PlayReady / FairPlay / ClearKey). HLS, DASH ve MP4'te çalışır. */
    drm?: HopeDrmOptions;
    /** Deneyim (QoE) ölçümleri ve izlenme olayları; `true` = yalnızca `hp:analytics` olayı. */
    analytics?: boolean | HopeAnalyticsOptions;
    /** Sağ tık menüsü (player adı + sürüm). Varsayılan açık; `false` tarayıcının kendi menüsünü geri getirir. */
    contextMenu?: boolean | ContextMenuOptions;
    /** Ekranın sol/sağına çift dokunma hareketleri. `true` = solda 10 sn geri, sağda 10 sn ileri (dokunmatik). Varsayılan kapalı. */
    tapGestures?: boolean | TapGesture[];
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
    /**
     * true: player'ın tüm hataları (medya, yayın, reklam, altyazı) sağ tık menüsündeki "Hata ayıklama" penceresinde
     * ayrıntılarıyla listelenir (giriş yalnızca kayıtlı hata varsa görünür). Kayıt her zaman tutulur —
     * `player.errorLog` ile kodla da okunabilir.
     */
    debug?: boolean;
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
    /** "İntroyu atla" / "Özeti atla" / "Jeneriği atla" butonları — bölüm oynarken görünür, basınca sonuna atlar. */
    skipSegments?: SkipSegment[];
    /**
     * Ayarlar menüsünde "Erişilebilirlik": yakınlaştırma, görüntü filtreleri (siyah-beyaz, gün / gece ışığı, yüksek
     * kontrast, renk körlüğü), mono ses, ses güçlendirme, büyük kontroller, klavye kısayolları listesi. Varsayılan kapalı.
     */
    accessibility?: boolean | AccessibilityOptions;
    /**
     * Zaman ve ses geçmişi: yarıda bırakılan video kaldığı yerden başlar (bildirimle, "Baştan başla" ile geri alınır);
     * ses seviyesi / sessiz durumu hatırlanır. Kayıtlar izleyicinin tarayıcısında. Varsayılan kapalı.
     */
    history?: boolean | HistoryOptions;
    /** Eklentiler: `[eklenti]`, `[[eklenti, seçenekler]]` ya da yükleyici `() => import('./x')`. Bkz. `definePlugin`. */
    plugins?: PluginEntry[];
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
    /** Hata ekranı açıldı (oynatılamayan kaynak, kopan yayın…). `code`: MediaError kodu (2 ağ, 3 çözümleme, 4 desteklenmiyor). */
    'hp:error': CustomEvent<{ message: string; code?: number }>;
    'hp:analytics': CustomEvent<{ event: HopeAnalyticsEvent; metrics: HopeQoeMetrics }>;
    'hp:qualitychange': CustomEvent<{ label: string }>;
    /**
     * Kaynak grubu değişti: `from` grubu ölümcül hata verdi (ya da tarayıcı oynatamıyor) ve `to` grubuna geçildi.
     * `code`: MediaError kodu (2 ağ, 3 çözümleme, 4 desteklenmiyor); `skipped`: denenmeden atlandı (desteklenmiyor).
     */
    'hp:sourcefallback': CustomEvent<{ from: HopeSourceFormat; to: HopeSourceFormat; code?: number; skipped?: boolean }>;
    'hp:ratechange': CustomEvent<{ rate: number }>;
    /** `linear: false` → overlay (non-linear) reklam: içerik durmaz, reklam içeriğin üstünde gösterilir. */
    'hp:adstart': CustomEvent<{ type: 'preroll' | 'midroll' | 'postroll'; linear?: boolean; /** Eklenti reklamıysa eklenti adı. */ plugin?: string }>;
    'hp:adend': CustomEvent<{ type: 'preroll' | 'midroll' | 'postroll'; linear?: boolean; /** Eklenti reklamıysa eklenti adı. */ plugin?: string }>;
    /**
     * Reklam gösterilemedi. `code`: IMA hata kodu (ör. 1009 boş VAST, 301 zaman aşımı), `vastCode`: VAST hata numarası,
     * `errorType`: 'adLoadError' | 'adPlayError', `breakType`: hangi ara. Zaman aşımında `message` = 'preroll-timeout'.
     */
    'hp:aderror': CustomEvent<{
        message: string;
        code?: number;
        vastCode?: number;
        errorType?: string;
        breakType?: 'preroll' | 'midroll' | 'postroll';
    }>;
    'hp:itemchange': CustomEvent<{ index: number; source: 'playlist' | 'story' }>;
    'hp:sticky': CustomEvent<{ sticky: boolean; corner?: StickyCorner }>;
    /**
     * TV yayın durumu değişti. `state`: available (cihaz var), unavailable, connecting, connected, disconnected.
     * `via`: chromecast | airplay | remote. `device`: cihaz adı (Cast).
     */
    'hp:cast': CustomEvent<{ state: 'available' | 'unavailable' | 'connecting' | 'connected' | 'disconnected'; via: 'chromecast' | 'airplay' | 'remote'; device?: string }>;
    /** Reklam tetikleyici kuralları yüklendi (null = kapalı). */
    'hp:adtriggers': CustomEvent<{ config: AdTriggersConfig | null }>;
    /** Tetikleyici reklamı doldu ve gösterildi. */
    /** `custParams`: isteğe giden tüm key-value'lar (sayfa + kural + hp_*). */
    'hp:adtriggershow': CustomEvent<{ rule?: string; trigger: AdTrigger['type']; adUnitPath: string; fullscreen: boolean; custParams: Record<string, string | string[]> }>;
    /** Reklam boş döndü, hata verdi ya da zaman aşımına uğradı. */
    'hp:adtriggerempty': CustomEvent<{ rule?: string; trigger: AdTrigger['type']; adUnitPath: string }>;
    /**
     * Reklam kapandı — `reason`: user (X ya da `closeAdTrigger()`), timeout (duration), mode (tam ekran durumu değişti),
     * ad (video reklamı başladı), content (içerik değişti), replaced ('none' reklamı yeni tetiklemeyle değişti).
     */
    'hp:adtriggerclose': CustomEvent<{ rule?: string; reason: 'user' | 'timeout' | 'mode' | 'ad' | 'content' | 'replaced' }>;
    /**
     * Yönlendirme ekranı / kartı. `shown`: göründü (`mode`), `cancel`: kullanıcı iptal etti, `redirect`: yönlendirilecek
     * (`reason`: auto | click). `redirect` olayı iptal edilebilir — `preventDefault()` ile sayfa değişmez, yönlendirmeyi
     * kendiniz yaparsınız (ör. SPA router, playlist).
     */
    'hp:redirect': CustomEvent<{ state: 'shown' | 'cancel' | 'redirect'; url: string; mode: 'screen' | 'card'; reason?: 'auto' | 'click' }>;
    'hp:pausead': CustomEvent<{ state: 'shown' | 'hidden' | 'empty'; size?: [number, number]; reason?: 'closed' | 'resumed' }>;
    /**
     * `skipSegments` butonu: `shown` (bölüm başladı, buton göründü) ve `skip` (`reason`: click | auto). `skip` iptal
     * edilebilir — `preventDefault()` ile atlanmaz (ör. jenerikte sıradaki bölüme kendiniz geçin).
     */
    /** `history`: kayıtlı konumdan devam edildi (`resumed`) ya da izleyici "Baştan başla"ya bastı (`restart`). */
    'hp:history': CustomEvent<{ state: 'resumed' | 'restart'; time: number; id: string | null }>;
    /** İzleyici bir erişilebilirlik ayarını değiştirdi (`changed`: hangi alan) — tüm güncel durumla. */
    'hp:accessibility': CustomEvent<AccessibilityState & { changed: keyof AccessibilityState }>;
    'hp:skip': CustomEvent<{ state: 'shown' | 'skip'; type: SkipSegmentType; start: number; end: number; reason?: 'click' | 'auto' }>;
};
