import { createIcon } from '../../icons/Icon';
import type { PlayableItem, StoryOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface StoryPlayerContext {
    videoEl: HTMLVideoElement;
    hostEl: HTMLElement;
    /** .video-area — story aktifken 9:16'ya çevrilir (data-story attribute ile), destroy'da geri alınır. */
    videoAreaEl: HTMLElement;
    /** Gerçek player gövdesi (.media-layer + chrome + center-play-button) — orta pane'e taşınır, destroy'da geri alınır. */
    playerBodyEls: HTMLElement[];
    loadSource(src: string, type?: string): Promise<void>;
    setPoster(url: string): void;
    requestFreshAd(prerollTag?: string): void;
    i18n: HopeLocaleStrings;
}

type Dir = 'next' | 'prev';

const DEFAULTS: Required<Omit<StoryOptions, 'items' | 'adTagPreroll' | 'gestures' | 'ui'>> = {
    startIndex: 0,
    loop: true,
    autoplayNext: true,
    preferHls: true,
    transitionMs: 380,
    adsOnItemChange: true,
};

/** Dikey video akışı (Shorts/Story): tek <video>, item değişiminde kaynak değişir. */
export class HopeStory {
    private readonly options: Required<Omit<StoryOptions, 'items' | 'adTagPreroll' | 'gestures' | 'ui'>>;
    private readonly gestureOpts: Required<NonNullable<StoryOptions['gestures']>>;
    private readonly uiOpts: Required<NonNullable<StoryOptions['ui']>>;
    private readonly items: PlayableItem[];

    private index: number;
    private destroyed = false;
    private switching = false;
    private listOpen = false;
    private userHasStartedPlayback = false;
    private lastAdsIndex: number | null = null;
    private wheelAccum = 0;
    private lastNavAt = 0;
    private drag: { startY: number; startX: number; dy: number; active: boolean; id: number } | null = null;

    private readonly els: {
        viewport: HTMLElement;
        track: HTMLElement;
        panePrev: HTMLElement;
        paneCurrent: HTMLElement;
        paneNext: HTMLElement;
        overlay: HTMLElement;
        counter: HTMLElement;
        titleEl: HTMLElement;
        spotEl: HTMLElement;
        dots: HTMLElement;
        progressBar: HTMLElement;
        upBtn: HTMLButtonElement;
        downBtn: HTMLButtonElement;
        listBtn: HTMLButtonElement;
        panel: HTMLElement;
        grid: HTMLElement;
    };

    constructor(
        private readonly ctx: StoryPlayerContext,
        private readonly rawOptions: StoryOptions
    ) {
        this.options = { ...DEFAULTS, ...rawOptions };
        this.gestureOpts = {
            swipe: true,
            swipeThreshold: 0.12,
            wheel: true,
            wheelThreshold: 42,
            wheelCooldownMs: 620,
            keyboard: true,
            ...rawOptions.gestures,
        };
        this.uiOpts = { counter: true, title: true, spot: true, dots: true, progress: true, ...rawOptions.ui };
        this.items = Array.isArray(rawOptions.items) ? rawOptions.items : [];
        this.index = this.clamp(this.options.startIndex);

        this.els = this.buildDom();
        this.bindEvents();
        this.syncUi();
        this.preloadNeighbours();

        if (this.items.length) void this.loadItem(this.index, { isStart: true });
    }

    refreshLabels(): void {
        this.els.upBtn.setAttribute('aria-label', this.ctx.i18n.storyPrev);
        this.els.downBtn.setAttribute('aria-label', this.ctx.i18n.storyNext);
        this.els.listBtn.setAttribute('aria-label', this.ctx.i18n.storyAllVideos);
        this.renderList(this.els.grid);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.ctx.videoEl.removeEventListener('ended', this.onEnded);
        this.ctx.videoEl.removeEventListener('playing', this.onPlaying);
        this.ctx.videoEl.removeEventListener('play', this.onFirstPlay);
        this.ctx.videoEl.removeEventListener('timeupdate', this.onTimeUpdate);
        this.els.viewport.removeEventListener('wheel', this.onWheel);
        this.els.viewport.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        document.removeEventListener('keydown', this.onKeyDown);

        // player gövdesini .video-area'ya geri taşı, story DOM'unu kaldır.
        this.ctx.playerBodyEls.forEach((el) => this.ctx.videoAreaEl.appendChild(el));
        this.ctx.videoAreaEl.removeAttribute('data-story');
        this.els.viewport.remove();
        this.els.panel.remove();
    }

    // ── public api ──

    next(userInitiated = true): void {
        const target = this.index + 1;
        if (target >= this.items.length) {
            if (!this.options.loop) return;
            void this.goTo(0, 'next', userInitiated);
            return;
        }
        void this.goTo(target, 'next', userInitiated);
    }

    prev(userInitiated = true): void {
        const target = this.index - 1;
        if (target < 0) {
            if (!this.options.loop) return;
            void this.goTo(this.items.length - 1, 'prev', userInitiated);
            return;
        }
        void this.goTo(target, 'prev', userInitiated);
    }

    async goTo(target: number, direction: Dir | null = null, userInitiated = true): Promise<void> {
        if (this.destroyed || this.switching) return;
        const i = this.clamp(target);
        if (i === this.index) return;

        const dir = direction || (i > this.index ? 'next' : 'prev');
        this.switching = true;
        try {
            this.fillPane(dir, this.items[i]);
            await this.animate(dir);
            this.index = i;
            this.syncUi();
            await this.loadItem(i, { userInitiated });
            this.preloadNeighbours();
        } finally {
            this.switching = false;
        }
    }

    toggleList(force?: boolean): void {
        this.listOpen = typeof force === 'boolean' ? force : !this.listOpen;
        this.els.panel.setAttribute('aria-hidden', this.listOpen ? 'false' : 'true');
        this.els.listBtn.setAttribute('aria-expanded', this.listOpen ? 'true' : 'false');
        // translate-x/-y utility yerine inline transform: Shadow DOM'da tek eksenli Tailwind translate 'none' oluyor.
        this.els.panel.style.transform = this.listOpen ? 'translateX(0)' : 'translateX(100%)';
    }

    // ── dom ──

    private buildDom() {
        this.ctx.videoAreaEl.setAttribute('data-story', '1');

        const viewport = document.createElement('div');
        viewport.className = 'hp:absolute hp:inset-0 hp:overflow-hidden hp:touch-none';
        viewport.setAttribute('tabindex', '0');

        const track = document.createElement('div');
        track.className = 'hp:relative hp:w-full';
        track.style.height = '300%';
        track.style.transform = 'translate3d(0,-33.3333%,0)';
        track.style.transition = `transform ${this.options.transitionMs}ms ease`;

        const panePrev = this.createPane();
        const paneCurrent = document.createElement('div');
        paneCurrent.className = 'hp:absolute hp:inset-x-0 hp:h-1/3';
        paneCurrent.style.top = '33.3333%';
        const paneNext = this.createPane();
        paneNext.style.top = '66.6667%';

        // Gerçek player gövdesini orta pane'e taşı.
        this.ctx.playerBodyEls.forEach((el) => paneCurrent.appendChild(el));

        track.append(panePrev, paneCurrent, paneNext);
        viewport.appendChild(track);

        const overlay = document.createElement('div');
        overlay.className = 'hp:absolute hp:inset-0 hp:z-20 hp:pointer-events-none hp:flex hp:flex-col hp:justify-between hp:p-3';

        const progressBar = document.createElement('div');
        progressBar.className = 'hp:h-0.5 hp:bg-white/30 hp:rounded-full hp:overflow-hidden';
        const progressFill = document.createElement('div');
        progressFill.className = 'hp:h-full hp:bg-accent hp:w-0';
        progressBar.appendChild(progressFill);

        const meta = document.createElement('div');
        meta.className = 'hp:flex hp:flex-col hp:gap-0.5 hp:text-white hp:drop-shadow hp:mt-2 hp:pointer-events-auto';
        const counter = document.createElement('span');
        counter.setAttribute('part', 'story-counter');
        counter.className = 'hp:text-xs hp:opacity-80';
        const titleEl = document.createElement('strong');
        titleEl.className = 'hp:text-sm';
        const spotEl = document.createElement('span');
        spotEl.className = 'hp:text-xs hp:opacity-80';
        meta.append(counter, titleEl, spotEl);

        const dots = document.createElement('div');
        dots.className = 'hp:absolute hp:right-2 hp:top-1/2 hp-center-y hp:flex hp:flex-col hp:gap-1 hp:pointer-events-none';

        const navWrap = document.createElement('div');
        navWrap.className = 'hp:flex hp:flex-col hp:gap-2 hp:self-end hp:pointer-events-auto hp:mb-16';
        const upBtn = this.navBtn('chevron-left', this.ctx.i18n.storyPrev);
        upBtn.style.transform = 'rotate(90deg)';
        const downBtn = this.navBtn('chevron-left', this.ctx.i18n.storyNext);
        downBtn.style.transform = 'rotate(-90deg)';
        navWrap.append(upBtn, downBtn);

        const listBtn = document.createElement('button');
        listBtn.type = 'button';
        listBtn.setAttribute('aria-label', this.ctx.i18n.storyAllVideos);
        listBtn.setAttribute('aria-expanded', 'false');
        // Konum tailwind.css `.hp-story-list-btn` — dar (dikey) player'da üst bara (ayarlar/PiP) taşınan butonların altında.
        listBtn.className =
            'hp-story-list-btn hp:absolute hp:flex hp:items-center hp:justify-center hp:w-9 hp:h-9 hp:rounded-full ' +
            'hp:bg-black/40 hp:text-white hp:border-0 hp:cursor-pointer hp:pointer-events-auto';
        listBtn.setAttribute('part', 'story-list-button');
        listBtn.appendChild(createIcon('grid', 'hp:text-base'));

        overlay.append(progressBar, meta, dots, navWrap, listBtn);

        const panel = document.createElement('aside');
        panel.className =
            'hp:absolute hp:inset-y-0 hp:right-0 hp:w-72 hp:max-w-[80%] hp:bg-surface-elev hp:z-30 hp:overflow-y-auto hp:p-3 ' +
            'hp:transition-transform hp:duration-300';
        panel.style.transform = 'translateX(100%)';
        panel.setAttribute('aria-hidden', 'true');
        const grid = document.createElement('div');
        grid.className = 'hp:flex hp:flex-col hp:gap-2 hp:mt-8';
        panel.appendChild(grid);

        this.ctx.videoAreaEl.append(viewport, overlay, panel);

        this.renderList(grid);

        return {
            viewport, track, panePrev, paneCurrent, paneNext, overlay,
            counter, titleEl, spotEl, dots, progressBar: progressFill,
            upBtn, downBtn, listBtn, panel, grid,
        };
    }

    private createPane(): HTMLElement {
        const pane = document.createElement('div');
        pane.className = 'hp:absolute hp:inset-x-0 hp:h-1/3 hp:bg-cover hp:bg-center hp:bg-black';
        return pane;
    }

    private navBtn(iconName: string, label: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', label);
        btn.className =
            'hp:flex hp:items-center hp:justify-center hp:w-8 hp:h-8 hp:rounded-full hp:bg-black/40 hp:text-white hp:border-0 hp:cursor-pointer';
        btn.appendChild(createIcon(iconName, 'hp:text-sm'));
        return btn;
    }

    private fillPane(dir: Dir, item: PlayableItem | undefined): void {
        const pane = dir === 'next' ? this.els.paneNext : this.els.panePrev;
        const img = item?.image || '';
        pane.style.backgroundImage = img ? `url("${img}")` : 'none';
    }

    private animate(dir: Dir): Promise<void> {
        const track = this.els.track;
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                track.removeEventListener('transitionend', finish);
                clearTimeout(timer);
                track.style.transition = 'none';
                track.style.transform = 'translate3d(0,-33.3333%,0)';
                void track.offsetHeight;
                track.style.transition = `transform ${this.options.transitionMs}ms ease`;
                resolve();
            };
            track.addEventListener('transitionend', finish);
            const timer = setTimeout(finish, this.options.transitionMs + 120);
            track.style.transform = dir === 'next' ? 'translate3d(0,-66.6667%,0)' : 'translate3d(0,0,0)';
        });
    }

    // ── source / playback ──

    private async loadItem(i: number, opts: { userInitiated?: boolean; isStart?: boolean } = {}): Promise<void> {
        const item = this.items[i];
        if (!item) return;

        const mode = this.resolveMode(item);
        const payload = this.buildPayload(item, mode);
        if (!payload) return;

        this.ctx.videoEl.pause();
        if (item.image) this.ctx.setPoster(item.image);
        await this.ctx.loadSource(payload.src, payload.type);

        if (this.options.adsOnItemChange && this.lastAdsIndex !== i) {
            this.lastAdsIndex = i;
            this.ctx.requestFreshAd(item.adTagPreroll || this.rawOptions.adTagPreroll);
        }

        if (this.shouldAutoPlay(opts)) {
            try {
                await this.ctx.videoEl.play();
            } catch {
                /* autoplay engellendi */
            }
        }
    }

    private shouldAutoPlay({ userInitiated, isStart }: { userInitiated?: boolean; isStart?: boolean }): boolean {
        if (isStart) return !!this.ctx.videoEl.autoplay;
        if (userInitiated) return true;
        return this.options.autoplayNext && this.userHasStartedPlayback;
    }

    private resolveMode(item: PlayableItem): 'hls' | 'mp4' {
        const hasHls = this.hasMode(item, 'hls');
        const hasMp4 = this.hasMode(item, 'mp4');
        if (this.options.preferHls) return hasHls ? 'hls' : hasMp4 ? 'mp4' : 'hls';
        return hasMp4 ? 'mp4' : hasHls ? 'hls' : 'mp4';
    }

    private hasMode(item: PlayableItem, mode: 'hls' | 'mp4'): boolean {
        return Array.isArray(item[mode]) && item[mode]!.some((v) => v?.src);
    }

    private buildPayload(item: PlayableItem, mode: 'hls' | 'mp4'): { src: string; type?: string } | null {
        const list = (item[mode] || []).filter((v) => v?.src);
        if (!list.length) return null;
        const src = mode === 'mp4' ? list.find((v) => v.selected) || list[0] : list[0];
        return { src: src!.src, type: src!.type || (mode === 'hls' ? 'application/x-mpegURL' : 'video/mp4') };
    }

    // ── preload ──

    private preloadNeighbours(): void {
        const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
        if (nav.connection?.saveData) return;

        [this.wrapIndex(this.index + 1), this.wrapIndex(this.index - 1)].forEach((i) => {
            if (i === this.index) return;
            const item = this.items[i];
            if (item?.image) {
                const img = new Image();
                img.decoding = 'async';
                img.src = item.image;
            }
        });
    }

    // ── ui sync ──

    private syncUi(): void {
        const item = this.items[this.index];
        const total = this.items.length;

        if (this.uiOpts.counter) this.els.counter.textContent = `${this.index + 1} / ${total}`;
        if (this.uiOpts.title) this.els.titleEl.textContent = item?.title || '';
        if (this.uiOpts.spot) this.els.spotEl.textContent = item?.spot || '';

        this.fillPane('prev', this.items[this.wrapIndex(this.index - 1)]);
        this.fillPane('next', this.items[this.wrapIndex(this.index + 1)]);

        const atStart = !this.options.loop && this.index === 0;
        const atEnd = !this.options.loop && this.index === total - 1;
        this.els.upBtn.disabled = atStart;
        this.els.downBtn.disabled = atEnd;

        if (this.uiOpts.dots) {
            if (this.els.dots.children.length !== total) {
                this.els.dots.innerHTML = '';
                for (let i = 0; i < total; i++) {
                    const dot = document.createElement('i');
                    dot.className = 'hp:block hp:w-1 hp:h-1 hp:rounded-full hp:bg-white/40';
                    this.els.dots.appendChild(dot);
                }
            }
            Array.from(this.els.dots.children).forEach((el, i) => {
                (el as HTMLElement).className = `hp:block hp:w-1 hp:h-1 hp:rounded-full ${i === this.index ? 'hp:bg-white' : 'hp:bg-white/40'}`;
            });
        }

        this.setActiveThumb();
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:itemchange', { detail: { index: this.index, source: 'story' } }));
    }

    private renderList(grid: HTMLElement): void {
        grid.innerHTML = '';
        this.items.forEach((item, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hp:flex hp:items-center hp:gap-2 hp:w-full hp:p-1.5 hp:rounded hp:text-left hp:text-on-surface hp:bg-transparent hp:border-0 hp:cursor-pointer hp:hover:bg-on-surface/5';
            btn.dataset.index = String(i);
            if (item.image) {
                const img = document.createElement('img');
                img.src = item.image;
                img.loading = 'lazy';
                img.className = 'hp:w-14 hp:aspect-[9/16] hp:object-cover hp:rounded hp:shrink-0';
                btn.appendChild(img);
            }
            const title = document.createElement('span');
            title.className = 'hp:text-xs hp:truncate';
            title.textContent = item.title || this.ctx.i18n.videoFallbackTitle(i);
            btn.appendChild(title);
            btn.addEventListener('click', () => {
                this.toggleList(false);
                void this.goTo(i);
            });
            grid.appendChild(btn);
        });
    }

    private setActiveThumb(): void {
        Array.from(this.els.grid.children).forEach((el, i) => {
            el.classList.toggle('hp:bg-accent/15', i === this.index);
        });
    }

    // ── events ──

    private bindEvents(): void {
        this.ctx.videoEl.addEventListener('ended', this.onEnded);
        this.ctx.videoEl.addEventListener('playing', this.onPlaying);
        this.ctx.videoEl.addEventListener('play', this.onFirstPlay);
        if (this.uiOpts.progress) this.ctx.videoEl.addEventListener('timeupdate', this.onTimeUpdate);

        this.els.upBtn.addEventListener('click', () => this.prev());
        this.els.downBtn.addEventListener('click', () => this.next());
        this.els.listBtn.addEventListener('click', () => this.toggleList());

        this.els.grid.parentElement?.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key === 'Escape') this.toggleList(false);
        });

        if (this.gestureOpts.wheel) this.els.viewport.addEventListener('wheel', this.onWheel, { passive: false });
        if (this.gestureOpts.swipe) {
            this.els.viewport.addEventListener('pointerdown', this.onPointerDown);
            window.addEventListener('pointermove', this.onPointerMove, { passive: false });
            window.addEventListener('pointerup', this.onPointerUp);
        }
        if (this.gestureOpts.keyboard) document.addEventListener('keydown', this.onKeyDown);
    }

    private readonly onEnded = (): void => {
        if (!this.options.autoplayNext) return;
        if (!this.options.loop && this.index === this.items.length - 1) return;
        this.next(false);
    };

    private readonly onPlaying = (): void => {};

    private readonly onFirstPlay = (): void => {
        this.userHasStartedPlayback = true;
    };

    private readonly onTimeUpdate = (): void => {
        const dur = this.ctx.videoEl.duration || 0;
        const cur = this.ctx.videoEl.currentTime || 0;
        this.els.progressBar.style.width = dur > 0 ? `${Math.min(100, (cur / dur) * 100)}%` : '0%';
    };

    private readonly onWheel = (e: WheelEvent): void => {
        if (this.switching) {
            e.preventDefault();
            return;
        }
        const dir: Dir = e.deltaY > 0 ? 'next' : 'prev';
        if (!this.canGo(dir)) return;
        e.preventDefault();

        const now = Date.now();
        if (now - this.lastNavAt < this.gestureOpts.wheelCooldownMs) return;
        this.wheelAccum += e.deltaY;
        if (Math.abs(this.wheelAccum) < this.gestureOpts.wheelThreshold) return;
        this.wheelAccum = 0;
        this.lastNavAt = now;
        dir === 'next' ? this.next() : this.prev();
    };

    private readonly onPointerDown = (e: PointerEvent): void => {
        if (this.switching || this.listOpen) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        this.drag = { startY: e.clientY, startX: e.clientX, dy: 0, active: false, id: e.pointerId };
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        const drag = this.drag;
        if (!drag || e.pointerId !== drag.id) return;
        const dy = e.clientY - drag.startY;
        const dx = e.clientX - drag.startX;

        if (!drag.active) {
            if (Math.abs(dy) < 10 || Math.abs(dy) < Math.abs(dx)) return;
            drag.active = true;
            this.els.track.style.transition = 'none';
        }
        e.preventDefault();

        const h = this.els.viewport.clientHeight || 1;
        const resisted = this.canGo(dy < 0 ? 'next' : 'prev') ? dy : dy * 0.25;
        drag.dy = resisted;

        const pct = -33.3333 + (resisted / h) * 33.3333;
        this.els.track.style.transform = `translate3d(0, ${pct}%, 0)`;
    };

    private readonly onPointerUp = (): void => {
        const drag = this.drag;
        this.drag = null;
        if (!drag?.active) return;

        const h = this.els.viewport.clientHeight || 1;
        const ratio = Math.abs(drag.dy) / h;
        const dir: Dir = drag.dy < 0 ? 'next' : 'prev';

        this.els.track.style.transition = `transform ${this.options.transitionMs}ms ease`;
        if (ratio >= this.gestureOpts.swipeThreshold && this.canGo(dir)) {
            this.els.track.style.transform = 'translate3d(0,-33.3333%,0)';
            dir === 'next' ? this.next() : this.prev();
        } else {
            this.els.track.style.transform = 'translate3d(0,-33.3333%,0)';
        }
    };

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        if (this.destroyed) return;
        if (e.key === 'Escape' && this.listOpen) {
            this.toggleList(false);
            return;
        }
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (!this.isInViewport()) return;

        if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') {
            e.preventDefault();
            this.next();
        } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') {
            e.preventDefault();
            this.prev();
        }
    };

    // ── helpers ──

    private canGo(dir: Dir): boolean {
        if (this.options.loop) return this.items.length > 1;
        return dir === 'next' ? this.index < this.items.length - 1 : this.index > 0;
    }

    private isInViewport(): boolean {
        const r = this.ctx.hostEl.getBoundingClientRect();
        return r.bottom > 0 && r.top < (window.innerHeight || 0);
    }

    private clamp(i: number): number {
        if (!Number.isFinite(i) || !this.items.length) return 0;
        return Math.max(0, Math.min(this.items.length - 1, Math.trunc(i)));
    }

    private wrapIndex(i: number): number {
        const n = this.items.length;
        if (!n) return 0;
        if (this.options.loop) return ((i % n) + n) % n;
        return this.clamp(i);
    }
}
