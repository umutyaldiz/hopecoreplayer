import type { RewardedResult } from '../../types';

/** Google Publisher Tag'in kullanılan yüzeyi (minimal tipler). */
interface GptSlot {
    addService(service: unknown): GptSlot;
}
interface GptEvent {
    slot: GptSlot;
    isEmpty?: boolean;
    makeRewardedVisible?: () => boolean | void;
}
interface GptPubAds {
    addEventListener(type: string, listener: (e: GptEvent) => void): void;
    removeEventListener?(type: string, listener: (e: GptEvent) => void): void;
}
interface GoogleTag {
    cmd: Array<() => void> | { push(fn: () => void): void };
    apiReady?: boolean;
    enums: { OutOfPageFormat: { REWARDED: unknown } };
    pubads(): GptPubAds;
    defineOutOfPageSlot(path: string, format: unknown): GptSlot | null;
    enableServices(): void;
    display(slot: GptSlot): void;
    destroySlots(slots: GptSlot[]): void;
}

/** Google'ın güncel örneklerindeki adres (eski securepagead2 adresi bazı ağlarda sertifika hatası veriyordu). */
const GPT_SRC = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
let gptLoading: Promise<void> | null = null;

/** GPT sayfada yoksa yükler; sayfa GPT'yi (hangi adresten olursa olsun) zaten yüklüyorsa onu paylaşır. */
function loadGpt(): Promise<void> {
    const w = window as unknown as { googletag?: Partial<GoogleTag> };
    w.googletag ??= { cmd: [] } as Partial<GoogleTag>;
    w.googletag.cmd ??= [];
    if (w.googletag.apiReady || document.querySelector('script[src*="/tag/js/gpt.js"]')) return Promise.resolve();
    gptLoading ??= new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.async = true;
        s.src = GPT_SRC;
        s.onload = () => resolve();
        s.onerror = () => {
            gptLoading = null;
            s.remove();
            reject(new Error('gpt.js could not be loaded (ad blocker / network / certificate)'));
        };
        document.head.appendChild(s);
    });
    return gptLoading;
}

/**
 * GPT web rewarded akışı (Google'ın örneğiyle aynı): slot tanımla → display → `rewardedSlotReady` gelince göster →
 * `rewardedSlotGranted` ödül → `rewardedSlotClosed` kapandı → slotu yok et. Kullanıcı onayı bu fonksiyon çağrılmadan
 * ÖNCE alınmış olmalı (player'ın onay penceresi).
 *
 * `timeoutMs` betiğin yüklenmesi DAHİL en baştan sayar: GPT hiç yüklenemez ya da çalışmazsa (engelleyici, ağ,
 * sertifika) da 'nofill' döner — bekleme ekranı asla takılı kalmaz. `signal` iptal edilirse (kullanıcı "Vazgeç") slot
 * temizlenip 'closed' döner. Reklam görünür olduktan sonra zaman aşımı işlemez; kapanışı GPT bildirir.
 */
export function showGptRewarded(adUnitPath: string, timeoutMs: number, signal?: AbortSignal): Promise<RewardedResult> {
    return new Promise<RewardedResult>((resolve) => {
        let done = false;
        let granted = false;
        let videoCompleted = false;
        let slot: GptSlot | null = null;
        let googletag: GoogleTag | null = null;
        const listeners: Array<[string, (e: GptEvent) => void]> = [];

        const finish = (result: RewardedResult): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (googletag) {
                const pubads = googletag.pubads();
                for (const [type, fn] of listeners) pubads.removeEventListener?.(type, fn);
                if (slot) {
                    try {
                        googletag.destroySlots([slot]);
                    } catch {
                        /* zaten yok edildi */
                    }
                }
            }
            resolve(result);
        };
        const onAbort = (): void => finish('closed');
        const timer = setTimeout(() => finish('nofill'), timeoutMs);
        if (signal?.aborted) {
            finish('closed');
            return;
        }
        signal?.addEventListener('abort', onAbort);

        loadGpt()
            .then(() => {
                if (done) return;
                const gt = (window as unknown as { googletag: GoogleTag }).googletag;
                gt.cmd.push(() => {
                    if (done) return;
                    googletag = gt;
                    slot = gt.defineOutOfPageSlot(adUnitPath, gt.enums.OutOfPageFormat.REWARDED);
                    // null: sayfa formatı desteklemiyor (ör. mobil uyumlu viewport yok) — reklam yok sayılır.
                    if (!slot) {
                        finish('nofill');
                        return;
                    }
                    slot.addService(gt.pubads());
                    const pubads = gt.pubads();
                    const on = (type: string, fn: (e: GptEvent) => void): void => {
                        listeners.push([type, fn]);
                        pubads.addEventListener(type, fn);
                    };
                    on('rewardedSlotReady', (e) => {
                        if (e.slot !== slot || done) return;
                        // Reklam hazır: artık bekleme yok — kapanışı GPT bildirecek.
                        clearTimeout(timer);
                        signal?.removeEventListener('abort', onAbort);
                        e.makeRewardedVisible?.();
                    });
                    // Google: "You need to close out ads rather than relying on GPT to do so." — ödül verilip video reklam
                    // sonuna kadar oynayınca reklam player tarafından kapatılır (slot yok edilir); kullanıcı X'e basmak
                    // zorunda kalmaz. Ödülü video bitmeden veren reklamlarda kapanış video bitince olur.
                    on('rewardedSlotGranted', (e) => {
                        if (e.slot !== slot) return;
                        granted = true;
                        if (videoCompleted) finish('granted');
                    });
                    on('rewardedSlotVideoCompleted', (e) => {
                        if (e.slot !== slot) return;
                        videoCompleted = true;
                        if (granted) finish('granted');
                    });
                    on('rewardedSlotClosed', (e) => {
                        if (e.slot === slot) finish(granted ? 'granted' : 'closed');
                    });
                    on('slotRenderEnded', (e) => {
                        if (e.slot === slot && e.isEmpty) finish('nofill');
                    });
                    gt.enableServices();
                    gt.display(slot);
                });
            })
            .catch(() => finish('nofill'));
    });
}
