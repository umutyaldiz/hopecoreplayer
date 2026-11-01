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

const GPT_SRC = 'https://securepagead2.googlesyndication.com/tag/js/gpt.js';
let gptLoading: Promise<void> | null = null;

/** GPT sayfada yoksa yükler (sayfa zaten GPT kullanıyorsa onu paylaşır). */
function loadGpt(): Promise<void> {
    const w = window as unknown as { googletag?: Partial<GoogleTag> };
    w.googletag ??= { cmd: [] } as Partial<GoogleTag>;
    w.googletag.cmd ??= [];
    if (w.googletag.apiReady || document.querySelector(`script[src="${GPT_SRC}"]`)) return Promise.resolve();
    gptLoading ??= new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.async = true;
        s.src = GPT_SRC;
        s.crossOrigin = 'anonymous';
        s.onload = () => resolve();
        s.onerror = () => {
            gptLoading = null;
            reject(new Error('gpt.js could not be loaded (ad blocker / network)'));
        };
        document.head.appendChild(s);
    });
    return gptLoading;
}

/**
 * GPT web rewarded akışı (Google'ın örneğiyle aynı): slot tanımla → display → `rewardedSlotReady` gelince göster →
 * `rewardedSlotGranted` ödül → `rewardedSlotClosed` kapandı → slotu yok et. Kullanıcı onayı bu fonksiyon çağrılmadan
 * ÖNCE alınmış olmalı (player'ın onay penceresi). `rewardedSlotReady` gelmezse (reklam yok) zaman aşımında 'nofill'.
 */
export async function showGptRewarded(adUnitPath: string, timeoutMs: number): Promise<RewardedResult> {
    await loadGpt();
    const googletag = (window as unknown as { googletag: GoogleTag }).googletag;
    return new Promise<RewardedResult>((resolve) => {
        googletag.cmd.push(() => {
            const slot = googletag.defineOutOfPageSlot(adUnitPath, googletag.enums.OutOfPageFormat.REWARDED);
            // null: sayfa formatı desteklemiyor (ör. mobil uyumlu viewport yok) — reklam yok sayılır.
            if (!slot) {
                resolve('nofill');
                return;
            }
            slot.addService(googletag.pubads());
            const pubads = googletag.pubads();
            let granted = false;
            let done = false;
            const listeners: Array<[string, (e: GptEvent) => void]> = [];
            const on = (type: string, fn: (e: GptEvent) => void): void => {
                listeners.push([type, fn]);
                pubads.addEventListener(type, fn);
            };
            const finish = (result: RewardedResult): void => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                for (const [type, fn] of listeners) pubads.removeEventListener?.(type, fn);
                try {
                    googletag.destroySlots([slot]);
                } catch {
                    /* zaten yok edildi */
                }
                resolve(result);
            };
            on('rewardedSlotReady', (e) => {
                if (e.slot !== slot) return;
                clearTimeout(timer);
                e.makeRewardedVisible?.();
            });
            on('rewardedSlotGranted', (e) => {
                if (e.slot === slot) granted = true;
            });
            on('rewardedSlotClosed', (e) => {
                if (e.slot === slot) finish(granted ? 'granted' : 'closed');
            });
            on('slotRenderEnded', (e) => {
                if (e.slot === slot && e.isEmpty) finish('nofill');
            });
            const timer = setTimeout(() => finish('nofill'), timeoutMs);
            googletag.enableServices();
            googletag.display(slot);
        });
    });
}
