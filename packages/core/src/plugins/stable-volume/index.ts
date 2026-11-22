import type { StableVolumeOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { registerLocaleStrings } from '../../i18n';
import { canTapAudio, mediaAudio, setStableVolume, type MediaAudioGraph } from '../../utils/media-audio';
import { storageGet, storageSet } from '../../utils/storage';

registerLocaleStrings({ tr: { stableVolume: 'Sabit ses' }, en: { stableVolume: 'Stable volume' } });

export interface StableVolumeContext {
    videoEl: HTMLVideoElement;
    i18n: HopeLocaleStrings;
    registerToggle(row: { key: string; label: string; getValueLabel(): string; onToggle(): void }): void;
    unregisterToggle(key: string): void;
}

const STORE = 'hp-stable-volume';
const KEY = 'stable-volume';

/** Sabit ses: ayarlar menüsünde aç-kapa; Web Audio grafiği yalnızca açılınca (ve kaynak izin verince) kurulur. */
export class StableVolume {
    private on: boolean;
    private graph: MediaAudioGraph | null = null;

    constructor(
        private readonly ctx: StableVolumeContext,
        options: StableVolumeOptions
    ) {
        const saved = storageGet(STORE);
        this.on = saved === '1' || (saved !== '0' && !!options.default);
        // Kaynak belli olmadan grafik kurulmaz (CORS'suz kaynakta ses kısılırdı).
        ctx.videoEl.addEventListener('loadedmetadata', this.apply);
        this.register();
        this.apply();
    }

    private register(): void {
        const t = this.ctx.i18n;
        this.ctx.registerToggle({
            key: KEY,
            label: t.stableVolume,
            getValueLabel: () => (this.on && !this.available() ? t.a11yUnavailable : this.on ? t.a11yOn : t.a11yOff),
            onToggle: () => this.set(!this.on),
        });
    }

    private available(): boolean {
        return !!this.graph || canTapAudio(this.ctx.videoEl);
    }

    set(on: boolean): void {
        this.on = on;
        storageSet(STORE, on ? '1' : '0');
        this.apply();
        this.ctx.videoEl.dispatchEvent(new CustomEvent('hp:stablevolume', { bubbles: true, composed: true, detail: { on } }));
    }

    get enabled(): boolean {
        return this.on;
    }

    private readonly apply = (): void => {
        const v = this.ctx.videoEl;
        if (!this.on && !this.graph) return;
        if (!this.graph && v.currentSrc) this.graph = mediaAudio(v);
        if (this.graph) setStableVolume(this.graph, this.on);
    };

    refreshLabels(): void {
        this.register();
    }

    destroy(): void {
        this.ctx.videoEl.removeEventListener('loadedmetadata', this.apply);
        // Grafik geri alınamaz — kompresörden çıkarılır, ses doğrudan akar.
        if (this.graph) setStableVolume(this.graph, false);
        this.ctx.unregisterToggle(KEY);
    }
}

export function installStableVolume(ctx: StableVolumeContext, options: StableVolumeOptions): StableVolume {
    return new StableVolume(ctx, options);
}
