import { createIcon } from '../../icons/Icon';
import type { PlayableItem, PlaylistOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface PlaylistPlayerContext {
    videoEl: HTMLVideoElement;
    hostEl: HTMLElement;
    /** Liste UI'ının monte edileceği, shadow root içindeki panel. */
    panelEl: HTMLElement;
    loadSource(src: string, type?: string): Promise<void>;
    setPoster(url: string): void;
    /** AdsController varsa retry/VMAP durumunu sıfırlayıp item'ın (varsa) kendi adTagPreroll'üyle yeniden reklam ister — yoksa no-op. */
    requestFreshAd(prerollTag?: string): void;
    i18n: HopeLocaleStrings;
}

type SourceMode = 'hls' | 'mp4';

interface Attempt {
    id: number;
    index: number;
    mode: SourceMode;
    tried: Set<SourceMode>;
    mp4Index: number;
}

const DEFAULTS: Required<Omit<PlaylistOptions, 'items' | 'adTagPreroll' | 'ui'>> = {
    startMode: 'after_current',
    startIndex: 0,
    loop: false,
    autoplayNext: true,
    preferHls: true,
    adsOnItemChange: true,
};

/** Tek player üzerinde sıralı oynatma listesi (startMode, loop, hata fallback zinciri). */
export class PlaylistRunner {
    private readonly options: Required<Omit<PlaylistOptions, 'items' | 'adTagPreroll' | 'ui'>>;
    private readonly items: PlayableItem[];

    private index: number;
    private destroyed = false;
    private switching = false;
    private playlistActive = false;
    private startPendingAfterCurrent = false;
    private attemptId = 0;
    private attempt: Attempt | null = null;
    private lastErrorAt = 0;
    private lastAdsIndex: number | null = null;
    private lastDispatchedIndex: number | null = null;
    private userHasStartedPlayback = false;

    private readonly ui: {
        root: HTMLElement;
        titleEl: HTMLElement;
        listEl: HTMLElement;
        prevBtn: HTMLButtonElement;
        nextBtn: HTMLButtonElement;
        itemEls: Array<{ li: HTMLElement; titleRow: HTMLElement; progressFill: HTMLElement | null; timeEl: HTMLElement | null }>;
    };

    constructor(
        private readonly ctx: PlaylistPlayerContext,
        private readonly rawOptions: PlaylistOptions
    ) {
        this.options = { ...DEFAULTS, ...rawOptions };
        this.items = Array.isArray(rawOptions.items) ? rawOptions.items : [];
        this.index = this.clampIndex(this.options.startIndex);

        this.ui = this.buildUi();
        this.bindPlayerEvents();
        this.init();
    }

    // ── lifecycle ──

    private init(): void {
        if (!this.items.length) return;

        if (this.options.startMode === 'after_current') {
            this.startPendingAfterCurrent = true;
            this.playlistActive = false;
            this.setActive(this.index);
            return;
        }

        this.playlistActive = true;
        void this.loadAndPlay(this.index, { userInitiated: false, isPlaylistStart: true });
    }

    refreshLabels(): void {
        this.ui.titleEl.textContent = this.playlistTitleText();
        this.ui.prevBtn.setAttribute('aria-label', this.ctx.i18n.playlistPrev);
        this.ui.nextBtn.setAttribute('aria-label', this.ctx.i18n.playlistNext);
        this.ui.itemEls.forEach((entry, idx) => {
            const item = this.items[idx];
            if (item && !item.title) entry.titleRow.textContent = this.ctx.i18n.videoFallbackTitle(idx);
        });
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.ctx.videoEl.removeEventListener('ended', this.onEnded);
        this.ctx.videoEl.removeEventListener('error', this.onError);
        this.ctx.videoEl.removeEventListener('play', this.onUserPlay);
        this.ui.root.remove();
    }

    // ── public api ──

    start(opts: { index?: number } = {}): void {
        if (this.destroyed || !this.items.length) return;
        this.startPendingAfterCurrent = false;
        this.playlistActive = true;
        this.index = this.clampIndex(opts.index ?? this.index);
        this.setActive(this.index);
        void this.loadAndPlay(this.index, { userInitiated: false, isPlaylistStart: true });
    }

    next(): void {
        if (this.destroyed || !this.items.length) return;
        if (!this.playlistActive) return this.start({ index: this.index });

        if (this.index < this.items.length - 1) this.index++;
        else if (this.options.loop) this.index = 0;
        else return;

        this.setActive(this.index);
        void this.loadAndPlay(this.index, { userInitiated: true });
    }

    prev(): void {
        if (this.destroyed || !this.items.length) return;
        if (!this.playlistActive) return this.start({ index: this.index });
        if (this.index === 0) return;
        this.index--;
        this.setActive(this.index);
        void this.loadAndPlay(this.index, { userInitiated: true });
    }

    setIndex(i: number): void {
        if (this.destroyed || !this.items.length) return;
        this.index = this.clampIndex(i);
        this.setActive(this.index);
        if (!this.playlistActive) return this.start({ index: this.index });
        void this.loadAndPlay(this.index, { userInitiated: true });
    }

    getIndex(): number {
        return this.index;
    }

    isActive(): boolean {
        return this.playlistActive;
    }

    // ── player events ──

    private bindPlayerEvents(): void {
        this.ctx.videoEl.addEventListener('ended', this.onEnded);
        this.ctx.videoEl.addEventListener('error', this.onError);
        this.ctx.videoEl.addEventListener('play', this.onUserPlay);
        this.ctx.videoEl.addEventListener('timeupdate', this.onTimeUpdate);
    }

    private readonly onUserPlay = (): void => {
        this.userHasStartedPlayback = true;
    };

    private readonly onEnded = (): void => {
        if (this.startPendingAfterCurrent && !this.playlistActive) {
            this.startPendingAfterCurrent = false;
            this.playlistActive = true;
            this.setActive(this.index);
            void this.loadAndPlay(this.index, { userInitiated: true, isPlaylistStart: true });
            return;
        }
        if (this.playlistActive) this.next();
    };

    private readonly onError = (): void => {
        if (this.destroyed || !this.playlistActive) return;
        const now = Date.now();
        if (now - this.lastErrorAt < 200) return;
        this.lastErrorAt = now;
        void this.fallbackOrSkip();
    };

    private readonly onTimeUpdate = (): void => {
        this.updateProgress();
    };

    // ── core load ──

    private async loadAndPlay(
        i: number,
        opts: { userInitiated?: boolean; forceMode?: SourceMode | null; forceMp4Index?: number | null; isFallback?: boolean; isPlaylistStart?: boolean } = {}
    ): Promise<void> {
        if (this.destroyed || this.switching || !this.playlistActive) return;
        this.switching = true;

        const item = this.items[i];
        if (!item) {
            this.switching = false;
            return;
        }
        const attemptId = ++this.attemptId;
        const mode = opts.forceMode ?? this.resolveMode(item);

        let tried = new Set<SourceMode>([mode]);
        let mp4Index = opts.forceMp4Index ?? 0;
        if (opts.isFallback && this.attempt?.index === i && this.attempt?.tried) {
            tried = new Set(this.attempt.tried);
            tried.add(mode);
            if (opts.forceMp4Index == null) mp4Index = this.attempt.mp4Index ?? 0;
        }
        this.attempt = { id: attemptId, index: i, mode, tried, mp4Index };

        try {
            const payload = this.buildPayload(item, mode, mp4Index);
            if (!payload) throw new Error('No playable source');

            this.setActive(i);
            this.ctx.videoEl.pause();
            if (item.image) this.ctx.setPoster(item.image);
            await this.ctx.loadSource(payload.src, payload.type);

            if (this.options.adsOnItemChange) this.maybeRequestAds(i, item, !!opts.isFallback);

            if (this.shouldAutoPlay(!!opts.userInitiated)) {
                try {
                    await this.ctx.videoEl.play();
                } catch {
                    /* autoplay engellendi — sessizce geç */
                }
            }
            this.updateProgress();
        } finally {
            this.switching = false;
        }
    }

    private async fallbackOrSkip(): Promise<void> {
        if (this.destroyed || !this.attempt) return;
        const item = this.items[this.attempt.index];
        if (!item) return;

        if (this.attempt.mode === 'mp4') {
            const mp4List = (item.mp4 || []).filter((v) => v?.src);
            const nextMp4 = (this.attempt.mp4Index ?? 0) + 1;
            if (nextMp4 < mp4List.length) {
                await this.loadAndPlay(this.attempt.index, { forceMode: 'mp4', forceMp4Index: nextMp4, isFallback: true });
                return;
            }
        }

        const otherMode: SourceMode = this.attempt.mode === 'hls' ? 'mp4' : 'hls';
        if (this.hasMode(item, otherMode) && !this.attempt.tried.has(otherMode)) {
            await this.loadAndPlay(this.attempt.index, { forceMode: otherMode, isFallback: true });
            return;
        }

        this.next();
    }

    // ── ads ──

    private maybeRequestAds(index: number, item: PlayableItem, _isFallback: boolean): void {
        if (this.lastAdsIndex === index) return;
        this.lastAdsIndex = index;
        this.ctx.requestFreshAd(item.adTagPreroll || this.rawOptions.adTagPreroll);
    }

    // ── sources ──

    private resolveMode(item: PlayableItem): SourceMode {
        if (this.options.preferHls) return this.hasMode(item, 'hls') ? 'hls' : this.hasMode(item, 'mp4') ? 'mp4' : 'hls';
        return this.hasMode(item, 'mp4') ? 'mp4' : this.hasMode(item, 'hls') ? 'hls' : 'mp4';
    }

    private hasMode(item: PlayableItem, mode: SourceMode): boolean {
        return Array.isArray(item[mode]) && item[mode]!.some((v) => v?.src);
    }

    private buildPayload(item: PlayableItem, mode: SourceMode, mp4Index = 0): { src: string; type?: string } | null {
        const list = (item[mode] || []).filter((v) => v?.src);
        if (!list.length) return null;

        let src;
        if (mode === 'mp4') {
            src = mp4Index > 0 ? list[mp4Index] || list[0] : list.find((v) => v.selected) || list[0];
        } else {
            src = list[0];
        }
        return { src: src!.src, type: src!.type || (mode === 'hls' ? 'application/x-mpegURL' : 'video/mp4') };
    }

    private shouldAutoPlay(userInitiated: boolean): boolean {
        if (userInitiated) return true;
        return this.options.autoplayNext && this.userHasStartedPlayback;
    }

    private clampIndex(i: number): number {
        if (!Number.isFinite(i) || !this.items.length) return 0;
        return Math.max(0, Math.min(this.items.length - 1, Math.trunc(i)));
    }

    // ── ui ──

    private buildUi() {
        const ui = this.rawOptions.ui ?? {};
        const root = document.createElement('div');
        root.setAttribute('part', 'playlist-panel');
        root.className = 'hp:flex hp:flex-col hp:gap-2 hp:p-3 hp:bg-surface-elev hp:max-h-80 hp:overflow-y-auto';

        const header = document.createElement('div');
        header.className = 'hp:flex hp:items-center hp:justify-between hp:gap-2 hp:mb-1';

        const titleEl = document.createElement('div');
        titleEl.className = 'hp:text-sm hp:font-semibold hp:text-on-surface';
        titleEl.textContent = this.playlistTitleText();
        header.appendChild(titleEl);

        const navWrap = document.createElement('div');
        navWrap.className = 'hp:flex hp:gap-1';
        const prevBtn = this.navButton('chevron-left', this.ctx.i18n.playlistPrev, () => this.prev());
        const nextBtn = this.navButton('chevron-left', this.ctx.i18n.playlistNext, () => this.next());
        nextBtn.style.transform = 'rotate(180deg)';
        navWrap.append(prevBtn, nextBtn);
        header.appendChild(navWrap);

        root.appendChild(header);

        const listEl = document.createElement('ul');
        listEl.className = 'hp:flex hp:flex-col hp:gap-1 hp:list-none hp:m-0 hp:p-0';
        root.appendChild(listEl);

        const itemEls: Array<{ li: HTMLElement; titleRow: HTMLElement; progressFill: HTMLElement | null; timeEl: HTMLElement | null }> = [];
        this.items.forEach((item, idx) => {
            const li = document.createElement('li');
            li.className =
                'hp:flex hp:items-center hp:gap-2 hp:p-2 hp:rounded hp:cursor-pointer hp:text-on-surface-muted hp:text-sm ' +
                'hp:hover:bg-on-surface/5 hp:data-[active=true]:bg-accent/15 hp:data-[active=true]:text-on-surface';

            if (item.image) {
                const img = document.createElement('img');
                img.src = item.image;
                img.loading = 'lazy';
                img.className = 'hp:w-16 hp:aspect-video hp:object-cover hp:rounded hp:shrink-0';
                li.appendChild(img);
            }

            const body = document.createElement('div');
            body.className = 'hp:flex-1 hp:min-w-0';
            const titleRow = document.createElement('div');
            titleRow.className = 'hp:truncate hp:font-medium';
            titleRow.textContent = item.title || this.ctx.i18n.videoFallbackTitle(idx);
            body.appendChild(titleRow);

            let progressFill: HTMLElement | null = null;
            let timeEl: HTMLElement | null = null;
            if (ui.showMeta !== false) {
                const metaRow = document.createElement('div');
                metaRow.className = 'hp:flex hp:items-center hp:gap-2 hp:text-xs hp:opacity-70 hp:mt-0.5';
                timeEl = document.createElement('span');
                timeEl.textContent = '';
                metaRow.appendChild(timeEl);

                const bar = document.createElement('div');
                bar.className = 'hp:flex-1 hp:h-0.5 hp:bg-on-surface/20 hp:rounded-full hp:overflow-hidden';
                progressFill = document.createElement('div');
                progressFill.className = 'hp:h-full hp:bg-accent';
                progressFill.style.width = '0%';
                bar.appendChild(progressFill);
                metaRow.appendChild(bar);
                body.appendChild(metaRow);
            }

            li.appendChild(body);
            li.addEventListener('click', () => this.setIndex(idx));
            listEl.appendChild(li);
            itemEls.push({ li, titleRow, progressFill, timeEl });
        });

        this.ctx.panelEl.appendChild(root);
        return { root, titleEl, listEl, prevBtn, nextBtn, itemEls };
    }

    private playlistTitleText(): string {
        const ui = this.rawOptions.ui ?? {};
        const title = ui.title || this.ctx.i18n.playlistTitle;
        return ui.showCount === false ? title : `${title} (${this.items.length})`;
    }

    private navButton(iconName: string, label: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', label);
        btn.className = 'hp:flex hp:items-center hp:justify-center hp:w-6 hp:h-6 hp:text-on-surface hp:bg-transparent hp:border-0 hp:cursor-pointer';
        btn.appendChild(createIcon(iconName, 'hp:text-sm'));
        btn.addEventListener('click', onClick);
        return btn;
    }

    private setActive(index: number): void {
        this.ui.itemEls.forEach((entry, idx) => {
            if (idx === index) entry.li.setAttribute('data-active', 'true');
            else entry.li.removeAttribute('data-active');
        });
        // loadAndPlay() hem anlık UI geri bildirimi için önceden (next/prev/setIndex
        // içinden) hem de kaynak gerçekten yüklendiğinde setActive() çağırıyor —
        // aynı index için event'i yalnızca BİR kez yaymak için guard.
        if (this.lastDispatchedIndex !== index) {
            this.lastDispatchedIndex = index;
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:itemchange', { detail: { index, source: 'playlist' } }));
        }
    }

    private updateProgress(): void {
        const active = this.ui.itemEls[this.index];
        if (!active) return;
        const duration = this.ctx.videoEl.duration;
        const current = this.ctx.videoEl.currentTime;
        if (active.timeEl) active.timeEl.textContent = this.formatTime(current);
        if (active.progressFill && Number.isFinite(duration) && duration > 0) {
            active.progressFill.style.width = `${Math.min(100, (current / duration) * 100)}%`;
        }
    }

    private formatTime(sec: number): string {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${String(r).padStart(2, '0')}`;
    }
}
