import type { TapGesture, TapGestureType, TapRegion } from '../../types';

/** Bir hareketin kaç dokunuşla tetiklendiği — `tripletap` eklemek için buraya `tripletap: 3` yeterli. */
const TAP_COUNTS: Record<TapGestureType, number> = {
    doubletap: 2,
};
/** Ardışık dokunuşların aynı harekete sayılacağı en uzun aralık (ms). */
const TAP_WINDOW_MS = 300;
/** Sarmadan sonra aynı tarafa gelen her dokunuş sarmaya devam eder (YouTube gibi) — bu süre içinde. */
const CHAIN_WINDOW_MS = 700;
/** Ekranın sol/sağ bölgesi — genişliğin üçte biri. */
const SIDE_FRACTION = 1 / 3;

export const DEFAULT_TAP_GESTURES: TapGesture[] = [
    { type: 'doubletap', region: 'left', pointer: 'touch', action: 'seekStep', value: -10 },
    { type: 'doubletap', region: 'right', pointer: 'touch', action: 'seekStep', value: 10 },
];

export interface TapGesturesPlayerContext {
    /** Bölge hesabı için dokunulan alan (video alanı). */
    areaEl: HTMLElement;
    seekBy(delta: number): void;
    togglePlay(): void;
    toggleFullscreen(): void;
    toggleMute(): void;
}

export type TapPointerType = 'touch' | 'mouse' | 'pen';

/**
 * Ekranın sol/orta/sağ bölgesine çoklu dokunuş hareketleri (options.tapGestures). Bir bölgede tanımlı hareket varsa
 * tek dokunuşun normal davranışı (oynat/duraklat) hareket penceresi kadar bekletilir; ikinci dokunuş gelmezse uygulanır.
 */
export class TapGestures {
    private gestures: TapGesture[];
    private count = 0;
    private lastRegion: TapRegion | null = null;
    private lastPointer: TapPointerType | null = null;
    private pendingTimer: ReturnType<typeof setTimeout> | null = null;
    private chain: { gesture: TapGesture; region: TapRegion; pointer: TapPointerType; until: number } | null = null;

    constructor(
        private readonly ctx: TapGesturesPlayerContext,
        gestures: TapGesture[]
    ) {
        this.gestures = gestures;
    }

    setGestures(gestures: TapGesture[]): void {
        this.gestures = gestures;
        this.reset();
    }

    /**
     * Video alanına bir dokunuş. `true` = dokunuşu bu modül üstlendi (tek dokunuş davranışı gerekirse
     * `singleTap` ile sonradan çağrılır); `false` = bu bölge/işaretçi için hareket yok, normal davranış hemen uygulansın.
     */
    handleTap(clientX: number, pointer: TapPointerType, singleTap: () => void): boolean {
        const region = this.regionAt(clientX);
        const now = Date.now();

        // Sarma zinciri: çift dokunuştan sonra aynı tarafa her dokunuş bir adım daha sarar.
        const chain = this.chain;
        if (chain && now < chain.until && chain.pointer === pointer && (chain.gesture.region === 'full' || chain.region === region)) {
            this.clearPending();
            this.run(chain.gesture, region);
            chain.until = now + CHAIN_WINDOW_MS;
            return true;
        }
        this.chain = null;

        const candidates = this.gestures.filter((g) => matchesPointer(g, pointer) && (g.region === region || g.region === 'full'));
        if (!candidates.length) {
            this.reset();
            return false;
        }

        const continues = this.pendingTimer !== null && this.lastRegion === region && this.lastPointer === pointer;
        this.count = continues ? this.count + 1 : 1;
        this.lastRegion = region;
        this.lastPointer = pointer;
        this.clearPending();

        const maxCount = Math.max(...candidates.map((g) => TAP_COUNTS[g.type]));
        const match = candidates.find((g) => TAP_COUNTS[g.type] === this.count);
        // Bu bölgede daha uzun bir hareket (ör. üçlü dokunuş) yoksa beklemeden tetikle.
        if (match && this.count >= maxCount) {
            this.fire(match, region, pointer);
            return true;
        }
        const count = this.count;
        this.pendingTimer = setTimeout(() => {
            this.pendingTimer = null;
            const late = candidates.find((g) => TAP_COUNTS[g.type] === count);
            this.count = 0;
            if (late) this.fire(late, region, pointer);
            else if (count === 1) singleTap();
        }, TAP_WINDOW_MS);
        return true;
    }

    destroy(): void {
        this.reset();
    }

    private fire(gesture: TapGesture, region: TapRegion, pointer: TapPointerType): void {
        this.count = 0;
        this.run(gesture, region);
        if (gesture.action === 'seekStep') this.chain = { gesture, region, pointer, until: Date.now() + CHAIN_WINDOW_MS };
    }

    private run(gesture: TapGesture, region: TapRegion): void {
        switch (gesture.action) {
            case 'seekStep':
                this.ctx.seekBy(gesture.value ?? (region === 'left' ? -10 : 10));
                break;
            case 'togglePlay':
                this.ctx.togglePlay();
                break;
            case 'toggleFullscreen':
                this.ctx.toggleFullscreen();
                break;
            case 'toggleMute':
                this.ctx.toggleMute();
                break;
        }
    }

    private regionAt(clientX: number): TapRegion {
        const r = this.ctx.areaEl.getBoundingClientRect();
        const x = (clientX - r.left) / (r.width || 1);
        if (x < SIDE_FRACTION) return 'left';
        if (x > 1 - SIDE_FRACTION) return 'right';
        return 'center';
    }

    private clearPending(): void {
        if (this.pendingTimer) clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
    }

    private reset(): void {
        this.clearPending();
        this.count = 0;
        this.chain = null;
        this.lastRegion = null;
        this.lastPointer = null;
    }
}

function matchesPointer(gesture: TapGesture, pointer: TapPointerType): boolean {
    const want = gesture.pointer ?? 'touch';
    return want === 'any' || want === pointer;
}
