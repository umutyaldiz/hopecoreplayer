import type { AdsOptions } from '../../types';

/** Preroll beklenirken içeriğin en fazla ne kadar bekletileceği — sonra reklamsız başlar. */
export const DEFAULT_PREROLL_TIMEOUT_MS = 8000;

/** Bu reklam ayarlarıyla içerik başlamadan önce bir preroll bekleniyor mu (VMAP'in 0 noktası da olabilir). */
export function expectsPreroll(ads: AdsOptions): boolean {
    if (ads.live?.scte35 && !ads.adTagPreroll && !ads.adTagVmap) return false;
    return !!(ads.adTagPreroll || ads.adTagVmap);
}

/**
 * Preroll kapısı: preroll sonuçlanana kadar (reklam başladı / gelmedi / hata / zaman aşımı) içeriğin oynamasını
 * engeller — içerik 1-2 sn oynayıp reklamla kesilmesin, ilk karesini reklamdan SONRA göstersin.
 *
 * Elementin constructor'ında, video'nun diğer tüm 'play'/'pause' dinleyicilerinden ÖNCE kurulur: kapı açıkken gelen
 * 'play' olayını yutar (UI, hp:play ve IMA görmez), videoyu hemen duraklatır ve bunu "oynatma isteği" olarak saklar.
 * Reklam plugin'i daha sonra dinamik yüklendiği için kapı plugin'den bağımsız, çekirdekte yaşar.
 */
export class PrerollGate {
    /** Kapı kurulu (preroll bekleniyor) mu. */
    private armed = false;
    /** Kapı kuruluyken kullanıcı / autoplay oynatmak istedi mi. */
    private playIntent = false;
    /** Kapının kendi pause() çağrısının ürettiği 'pause' olayı yutulsun. */
    private swallowNextPause = false;
    private timeoutMs = DEFAULT_PREROLL_TIMEOUT_MS;
    private timer: ReturnType<typeof setTimeout> | null = null;

    /** İlk oynatma isteği (reklam plugin'i bekleyen preroll'u başlatır). */
    onPlayIntent: (() => void) | null = null;
    /** Zaman aşımı — reklam plugin'i geç gelecek cevabı iptal eder. Kapı bundan sonra içeriği başlatarak açılır. */
    onTimeout: (() => void) | null = null;
    /** "Preroll bekleniyor" durumu değişti (UI: yükleme halkası, merkez buton). */
    onWaitChange: ((waiting: boolean) => void) | null = null;

    constructor(private readonly video: HTMLVideoElement) {
        video.addEventListener('play', this.onPlay);
        video.addEventListener('pause', this.onPause);
    }

    get isArmed(): boolean {
        return this.armed;
    }

    /** Kapı kurulu ve oynatma istendi — kullanıcı preroll'u bekliyor. */
    get isWaiting(): boolean {
        return this.armed && this.playIntent;
    }

    get hasPlayIntent(): boolean {
        return this.playIntent;
    }

    arm(timeoutMs = DEFAULT_PREROLL_TIMEOUT_MS): void {
        this.clearTimer();
        this.armed = true;
        this.playIntent = false;
        this.timeoutMs = timeoutMs;
    }

    /**
     * Elementin `play()`'i için: kapı kuruluysa videoya dokunmadan oynatma isteği kaydedilir (play() promise'i
     * pause() ile reddedilip konsola "interrupted by a call to pause()" düşmesin). true → istek kapıda.
     */
    interceptPlay(): boolean {
        if (!this.armed) return false;
        this.registerIntent();
        return true;
    }

    /** Bekleme sırasında kullanıcı vazgeçti (duraklat'a bastı). Kapı kurulu kalır; preroll geri döner ama başlatılmaz. */
    cancelIntent(): void {
        if (!this.isWaiting) return;
        this.playIntent = false;
        this.clearTimer();
        this.onWaitChange?.(false);
    }

    /** Preroll sonuçlandı. `resume`: oynatma istenmişse içerik şimdi başlasın (reklam yok / hata / zaman aşımı). */
    release(resume: boolean): void {
        if (!this.armed) return;
        const wanted = this.playIntent;
        this.armed = false;
        this.playIntent = false;
        this.clearTimer();
        if (wanted) this.onWaitChange?.(false);
        if (resume && wanted) this.video.play().catch(() => {});
    }

    destroy(): void {
        this.clearTimer();
        this.video.removeEventListener('play', this.onPlay);
        this.video.removeEventListener('pause', this.onPause);
    }

    private registerIntent(): void {
        if (this.playIntent) return;
        this.playIntent = true;
        this.onWaitChange?.(true);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.onTimeout?.();
            this.release(true);
        }, this.timeoutMs);
        this.onPlayIntent?.();
    }

    private readonly onPlay = (e: Event): void => {
        if (!this.armed) return;
        e.stopImmediatePropagation();
        this.swallowNextPause = true;
        this.video.pause();
        this.registerIntent();
    };

    private readonly onPause = (e: Event): void => {
        if (!this.swallowNextPause) return;
        this.swallowNextPause = false;
        e.stopImmediatePropagation();
    };

    private clearTimer(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }
}
