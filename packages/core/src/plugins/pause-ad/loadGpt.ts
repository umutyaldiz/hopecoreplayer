/** Google Publisher Tag (GPT) için kullanılan minimal yüzey. */
export interface GptSlot {
    addService(service: unknown): GptSlot;
    setTargeting(key: string, value: string | string[]): GptSlot;
    getSlotElementId(): string;
}

export interface GptSlotRenderEndedEvent {
    slot: GptSlot;
    isEmpty: boolean;
    size: [number, number] | number[] | null;
}

export interface GptPubAds {
    addEventListener(type: 'slotRenderEnded', listener: (e: GptSlotRenderEndedEvent) => void): void;
    removeEventListener?(type: 'slotRenderEnded', listener: (e: GptSlotRenderEndedEvent) => void): void;
    refresh(slots: GptSlot[]): void;
    isInitialLoadDisabled(): boolean;
}

export interface GoogleTag {
    cmd: Array<() => void> | { push(fn: () => void): void };
    defineSlot(adUnitPath: string, sizes: Array<[number, number]>, divId: string): GptSlot | null;
    pubads(): GptPubAds;
    enableServices(): void;
    display(divId: string): void;
    destroySlots(slots?: GptSlot[]): boolean;
}

declare global {
    interface Window {
        googletag?: GoogleTag;
    }
}

const GPT_SRC = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
let loading: Promise<GoogleTag> | null = null;

/** GPT'yi bir kez yükler; sayfada zaten varsa onu kullanır. Komutlar googletag.cmd kuyruğuyla çalışır. */
export function loadGpt(): Promise<GoogleTag> {
    if (loading) return loading;
    window.googletag = window.googletag || ({ cmd: [] } as unknown as GoogleTag);
    loading = new Promise((resolve, reject) => {
        const ready = (): void => {
            window.googletag!.cmd.push(() => resolve(window.googletag!));
        };
        if (document.querySelector(`script[src="${GPT_SRC}"]`)) return ready();
        const script = document.createElement('script');
        script.async = true;
        script.src = GPT_SRC;
        script.onload = ready;
        script.onerror = () => {
            loading = null;
            reject(new Error('GPT yüklenemedi'));
        };
        document.head.appendChild(script);
    });
    return loading;
}
