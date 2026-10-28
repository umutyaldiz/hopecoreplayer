import type { LiveWallClockOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface LiveWallClockPlayerContext {
    videoEl: HTMLVideoElement;
    seekBarEl: HTMLElement;
    addControlElement(el: HTMLElement): void;
    /** UI dili (chrome metinleri) — `options.locale` (Intl saat biçimlendirme locale'i, ör. 'tr-TR') ile KARIŞTIRILMASIN, ayrı bir kavram. */
    i18n: HopeLocaleStrings;
}

const DEFAULTS: Required<LiveWallClockOptions> = {
    locale: 'tr-TR',
    timeZone: 'UTC',
    showSeconds: true,
    tooltipMode: 'clock',
};

/**
 * Canlı yayında duvar saati + seek bar hover tooltip'i. Canlı uç = seekable (yoksa buffered) sonu;
 * uç anının şu anki duvar saati olduğu varsayılır.
 */
export class LiveWallClock {
    private readonly clockEl: HTMLElement;
    private readonly tooltipEl: HTMLElement;
    private readonly options: Required<LiveWallClockOptions>;

    private clockTimer: ReturnType<typeof setTimeout> | null = null;
    private tooltipTimer: ReturnType<typeof setTimeout> | null = null;
    private isHovering = false;
    private lastSeekBarPoint: number | null = null;

    constructor(
        private readonly ctx: LiveWallClockPlayerContext,
        options: LiveWallClockOptions = {}
    ) {
        this.options = { ...DEFAULTS, ...options };

        this.clockEl = document.createElement('span');
        this.clockEl.setAttribute('part', 'live-clock');
        this.clockEl.setAttribute('role', 'status');
        this.clockEl.setAttribute('aria-label', ctx.i18n.liveClock);
        this.clockEl.className = 'hp:hidden hp:text-xs hp:text-on-surface hp:opacity-90 hp:tabular-nums hp:whitespace-nowrap hp:ml-1';
        ctx.addControlElement(this.clockEl);

        this.tooltipEl = document.createElement('div');
        this.tooltipEl.setAttribute('part', 'live-tooltip');
        this.tooltipEl.className =
            'hp:hidden hp:absolute hp:bottom-full hp:mb-2 hp-center-x hp:px-2 hp:py-1 hp:rounded hp:bg-surface-elev hp:text-on-surface hp:text-xs hp:tabular-nums hp:whitespace-nowrap hp:pointer-events-none hp:z-20';
        ctx.seekBarEl.appendChild(this.tooltipEl);

        ctx.seekBarEl.addEventListener('mouseenter', this.onSeekEnter);
        ctx.seekBarEl.addEventListener('mouseleave', this.onSeekLeave);
        ctx.seekBarEl.addEventListener('mousemove', this.onSeekMove);

        this.startClockTick();
    }

    refreshLabels(): void {
        this.clockEl.setAttribute('aria-label', this.ctx.i18n.liveClock);
    }

    destroy(): void {
        this.stopClockTick();
        this.stopTooltipTick();
        this.ctx.seekBarEl.removeEventListener('mouseenter', this.onSeekEnter);
        this.ctx.seekBarEl.removeEventListener('mouseleave', this.onSeekLeave);
        this.ctx.seekBarEl.removeEventListener('mousemove', this.onSeekMove);
        this.clockEl.remove();
        this.tooltipEl.remove();
    }

    /** Canlılık için duration === Infinity yeterli — native HLS'te DVR'sız canlıda seekable boş kalabiliyor. */
    private isLive(): boolean {
        return this.ctx.videoEl.duration === Infinity;
    }

    /** Canlı edge'in media-time'ı (saniye) — seekable aralığının sonu; seekable boşsa (bkz. isLive notu) buffered aralığının sonu. */
    private liveEdge(): number | null {
        const { seekable, buffered } = this.ctx.videoEl;
        if (seekable.length) return seekable.end(seekable.length - 1);
        if (buffered.length) return buffered.end(buffered.length - 1);
        return null;
    }

    // ── saat ──

    private startClockTick(): void {
        const tick = () => {
            this.renderClock();
            const delay = 1000 - (Date.now() % 1000);
            this.clockTimer = setTimeout(tick, delay);
        };
        tick();
    }

    private stopClockTick(): void {
        if (this.clockTimer) {
            clearTimeout(this.clockTimer);
            this.clockTimer = null;
        }
    }

    private renderClock(): void {
        if (!this.isLive()) {
            this.clockEl.classList.add('hp:hidden');
            return;
        }

        const liveNow = this.liveEdge();
        const ct = this.ctx.videoEl.currentTime;
        if (liveNow === null || !Number.isFinite(ct)) {
            this.clockEl.textContent = '--:--:--';
            this.clockEl.classList.remove('hp:hidden');
            return;
        }

        const behindSec = Math.max(0, liveNow - ct);
        const watchedMs = Date.now() - behindSec * 1000;
        this.clockEl.textContent = this.formatClock(new Date(watchedMs));
        this.clockEl.classList.remove('hp:hidden');
    }

    // ── seekbar hover tooltip ──

    private readonly onSeekEnter = (): void => {
        this.isHovering = true;
        this.renderTooltip();
        this.startTooltipTick();
    };

    private readonly onSeekLeave = (): void => {
        this.isHovering = false;
        this.lastSeekBarPoint = null;
        this.stopTooltipTick();
        this.hideTooltip();
    };

    private readonly onSeekMove = (e: MouseEvent): void => {
        const rect = this.ctx.seekBarEl.getBoundingClientRect();
        const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : null;
        this.lastSeekBarPoint = ratio === null ? null : Math.max(0, Math.min(1, ratio));
        this.renderTooltip();
        this.startTooltipTick();
    };

    private startTooltipTick(): void {
        if (this.tooltipTimer) return;
        const tick = () => {
            if (!this.isHovering || this.lastSeekBarPoint == null) {
                this.tooltipTimer = null;
                return;
            }
            this.renderTooltip();
            const delay = 1000 - (Date.now() % 1000);
            this.tooltipTimer = setTimeout(tick, delay);
        };
        tick();
    }

    private stopTooltipTick(): void {
        if (this.tooltipTimer) {
            clearTimeout(this.tooltipTimer);
            this.tooltipTimer = null;
        }
    }

    private renderTooltip(): void {
        if (!this.isLive() || this.lastSeekBarPoint == null) {
            this.hideTooltip();
            return;
        }

        const liveEdge = this.liveEdge();
        if (liveEdge === null || liveEdge <= 0) {
            this.hideTooltip();
            return;
        }

        const secondsBehind = Math.max(0, liveEdge - this.lastSeekBarPoint * liveEdge);
        const hoveredMs = Date.now() - secondsBehind * 1000;
        const wallClock = this.formatClock(new Date(hoveredMs));
        const minus = `-${this.formatDuration(secondsBehind)}`;

        this.tooltipEl.innerHTML = '';
        if (this.options.tooltipMode === 'behind') {
            this.tooltipEl.textContent = minus;
        } else if (this.options.tooltipMode === 'both') {
            const line1 = document.createElement('div');
            line1.textContent = wallClock;
            const line2 = document.createElement('div');
            line2.textContent = minus;
            line2.className = 'hp:opacity-70';
            this.tooltipEl.append(line1, line2);
        } else {
            this.tooltipEl.textContent = wallClock;
        }

        this.tooltipEl.style.left = `${this.lastSeekBarPoint * 100}%`;
        this.tooltipEl.classList.remove('hp:hidden');
    }

    private hideTooltip(): void {
        this.tooltipEl.classList.add('hp:hidden');
    }

    // ── format ──

    private formatClock(date: Date): string {
        const fmtOpts: Intl.DateTimeFormatOptions = this.options.showSeconds
            ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: this.options.timeZone }
            : { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: this.options.timeZone };
        try {
            return new Intl.DateTimeFormat(this.options.locale, fmtOpts).format(date);
        } catch {
            const pad = (n: number) => String(n).padStart(2, '0');
            const base = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
            return this.options.showSeconds ? `${base}:${pad(date.getSeconds())}` : base;
        }
    }

    private formatDuration(totalSeconds: number): string {
        const s = Math.floor(totalSeconds);
        const hh = Math.floor(s / 3600);
        const mm = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        const pad = (n: number) => String(n).padStart(2, '0');
        return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
    }
}
