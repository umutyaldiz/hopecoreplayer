import type { HopeLocaleStrings } from '../../i18n/types';
import type { PlaybackEngineInfo } from '../../hls/SourceManager';

/** hls.js instance'ından okunan alanlar — tam tipi içe aktarmamak için. */
interface HlsStatsSource {
    currentLevel: number;
    autoLevelEnabled: boolean;
    levels: { height: number; width: number; bitrate: number; videoCodec?: string; audioCodec?: string; details?: { live: boolean } }[];
    bandwidthEstimate: number;
    latency: number;
    config: { maxBufferLength: number };
}

export interface StatsPlayerContext {
    videoEl: HTMLVideoElement;
    containerEl: HTMLElement;
    i18n: HopeLocaleStrings;
    version: string;
    getEngine(): PlaybackEngineInfo;
    getHls(): HlsStatsSource | null;
}

const REFRESH_MS = 500;

/** Sağ tık menüsündeki "İstatistikler" — player üstünde canlı teknik bilgi paneli (YouTube'daki "Stats for nerds" gibi). */
export class StatsPanel {
    private readonly el: HTMLDivElement;
    private readonly titleEl: HTMLSpanElement;
    private readonly closeBtn: HTMLButtonElement;
    private readonly body: HTMLDListElement;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly ctx: StatsPlayerContext) {
        this.el = document.createElement('div');
        this.el.className = 'hp-stats';
        this.el.setAttribute('part', 'stats-panel');
        this.el.setAttribute('role', 'dialog');

        const header = document.createElement('div');
        header.className = 'hp-stats-header';
        this.titleEl = document.createElement('span');
        this.closeBtn = document.createElement('button');
        this.closeBtn.type = 'button';
        this.closeBtn.className = 'hp-stats-close';
        this.closeBtn.innerHTML =
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        this.closeBtn.addEventListener('click', () => this.hide());
        header.append(this.titleEl, this.closeBtn);

        this.body = document.createElement('dl');
        this.body.className = 'hp-stats-body';
        this.el.append(header, this.body);
        // Panel tıklamaları videoyu oynat/duraklat yapmasın.
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.el.addEventListener('click', (e) => e.stopPropagation());
        this.refreshLabels();
    }

    get isVisible(): boolean {
        return this.el.isConnected;
    }

    show(): void {
        if (!this.isVisible) this.ctx.containerEl.appendChild(this.el);
        this.render();
        if (!this.timer) this.timer = setInterval(() => this.render(), REFRESH_MS);
    }

    hide(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.el.remove();
    }

    toggle(force?: boolean): void {
        if (force ?? !this.isVisible) this.show();
        else this.hide();
    }

    refreshLabels(): void {
        this.titleEl.textContent = this.ctx.i18n.statsTitle;
        this.closeBtn.setAttribute('aria-label', this.ctx.i18n.statsClose);
        if (this.isVisible) this.render();
    }

    destroy(): void {
        this.hide();
    }

    private render(): void {
        const { videoEl: v, i18n: t } = this.ctx;
        const hls = this.ctx.getHls();
        const engine = this.ctx.getEngine();
        const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : undefined;
        const quality = v.getVideoPlaybackQuality?.();
        const rect = v.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        let ahead = 0;
        for (let i = 0; i < v.buffered.length; i++) {
            if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) > v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
        }

        const rows: [string, string][] = [
            [t.statsEngine, engine.engine + (engine.reason ? ` (${engine.reason})` : '')],
            [t.statsResolution, `${v.videoWidth}×${v.videoHeight} / ${Math.round(rect.width * dpr)}×${Math.round(rect.height * dpr)}`],
            [t.statsQuality, level ? `${level.height}p · ${Math.round(level.bitrate / 1000)} kbps${hls!.autoLevelEnabled ? ' · auto' : ''}` : '—'],
            [t.statsCodecs, level ? [level.videoCodec, level.audioCodec].filter(Boolean).join(', ') || '—' : '—'],
            [t.statsBandwidth, hls ? `${(hls.bandwidthEstimate / 1e6).toFixed(2)} Mbps` : '—'],
            [t.statsBuffer, `${ahead.toFixed(1)} s`],
            [t.statsDropped, quality ? `${quality.droppedVideoFrames} / ${quality.totalVideoFrames}` : '—'],
            // hls.js `latency`'yi VOD'da da hesaplıyor (süre - konum) — yalnızca canlı yayında anlamlı.
            [t.statsLatency, level?.details?.live && Number.isFinite(hls!.latency) ? `${hls!.latency.toFixed(1)} s` : '—'],
            [t.statsSpeedVolume, `${v.playbackRate}× · ${v.muted ? 0 : Math.round(v.volume * 100)}%`],
            [t.statsSource, v.currentSrc && !v.currentSrc.startsWith('blob:') ? v.currentSrc : v.currentSrc ? 'MediaSource (hls.js)' : '—'],
            [t.statsVersion, `HopeCorePlayer ${this.ctx.version}`],
        ];
        this.body.replaceChildren(
            ...rows.flatMap(([k, val]) => {
                const dt = document.createElement('dt');
                dt.textContent = k;
                const dd = document.createElement('dd');
                dd.textContent = val;
                dd.title = val;
                return [dt, dd];
            })
        );
    }
}
