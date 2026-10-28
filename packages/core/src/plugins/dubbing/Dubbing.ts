import type { SettingsSubmenuDef } from '../../controls/SettingsMenu';
import type { DubbingOptions, DubbingTrack } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface DubbingPlayerContext {
    videoEl: HTMLVideoElement;
    loadSource(src: string, type?: string): Promise<void>;
    registerSubmenu(def: SettingsSubmenuDef): void;
    unregisterSubmenu(key: string): void;
    i18n: HopeLocaleStrings;
}

const SUBMENU_KEY = 'dubbing';

function dubLangCode(track: DubbingTrack): string {
    return (track.srclang || track.label || '').toUpperCase().slice(0, 3);
}

/** Ayarlar menüsüne "Ses/Dil" alt menüsü ekler (registerSubmenu). */
export class Dubbing {
    private activeIndex: number;

    constructor(
        private readonly ctx: DubbingPlayerContext,
        private readonly options: DubbingOptions
    ) {
        const defaultIdx = options.tracks.findIndex((t) => t.default);
        this.activeIndex = defaultIdx >= 0 ? defaultIdx : 0;

        this.registerMenu();
    }

    /** Dil sonradan değişince başlığı güncel `ctx.i18n.dubbingTitle`'la yeniden kaydeder — `registerSubmenu` aynı key'i replace eder. */
    refreshLabels(): void {
        this.registerMenu();
    }

    private registerMenu(): void {
        this.ctx.registerSubmenu({
            key: SUBMENU_KEY,
            title: this.ctx.i18n.dubbingTitle,
            getValueLabel: () => dubLangCode(this.options.tracks[this.activeIndex]!),
            getItems: () =>
                this.options.tracks.map((track, i) => ({
                    label: track.label,
                    active: i === this.activeIndex,
                    onSelect: () => this.select(i),
                })),
        });
    }

    destroy(): void {
        this.ctx.unregisterSubmenu(SUBMENU_KEY);
    }

    private select(index: number): void {
        if (index === this.activeIndex) return;
        const track = this.options.tracks[index];
        if (!track) return;

        const resumeTime = this.ctx.videoEl.currentTime;
        const wasPlaying = !this.ctx.videoEl.paused;
        this.activeIndex = index;

        void this.ctx.loadSource(track.src, track.type).then(() => {
            this.ctx.videoEl.currentTime = resumeTime;
            if (wasPlaying) void this.ctx.videoEl.play().catch(() => {});
        });
    }
}
