import type { StickyCorner, StickyOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface StickyPlayerContext {
    key: string;
    videoEl: HTMLVideoElement;
    hostEl: HTMLElement;
    /** Sticky olarak köşeye taşınacak element — genelde hostEl'in kendisi (bkz. options.wrapperSelector). */
    wrapperEl: HTMLElement;
    /**
     * Kapat butonu wrapperEl'e değil shadow root içine eklenir — wrapperEl varsayılan olarak host;
     * slot olmadığı için light DOM child'ı render edilmez.
     */
    closeButtonMountEl: HTMLElement;
    isAdActive(): boolean;
    i18n: HopeLocaleStrings;
}

/** `register()`'ın döndürdüğü unregister fonksiyonu — dil sonradan değişince close butonunun statik etiketini tazelemek için `refreshLabels` da taşıyor (bkz. loop-section'daki aynı "fonksiyona metod ekleme" deseni). */
export type StickyUnregister = (() => void) & { refreshLabels?: () => void };

interface StickyItemState {
    inView: boolean;
    playing: boolean;
    sticky: boolean;
    hasEverBeenInView: boolean;
    hasEverBeenInViewWhilePlaying: boolean;
    watchMsInView: number;
    lastTickAt: number;
    minPlaySatisfied: boolean;
    userPaused: boolean;
    userPausedAt: number;
    adStartedOnce: boolean;
    contentStartedOnce: boolean;
    blockResumeUntil: number;
    programmaticPauseUntil: number;
    placeholderEl: HTMLElement | null;
    closeBtnEl: HTMLElement | null;
}

interface StickyItem {
    ctx: StickyPlayerContext;
    options: Required<Omit<StickyOptions, 'wrapperSelector'>>;
    state: StickyItemState;
    /** wrapperEl'in doğal konumundaki görünmez işaretçi — IntersectionObserver bunu izler (sticky olunca wrapper yer değiştirir). */
    sentinelEl: HTMLElement;
}

const GESTURE_WINDOW_MS = 1200;
const USER_PAUSED_MAX_MS = 30000;
const PROGRAMMATIC_PAUSE_MS = 800;
const BLOCK_RESUME_MS = 1200;
const STORAGE_KEY = 'hope_sticky_dismissed_until';
const STORAGE_KEY_FOREVER = 'hope_sticky_dismissed_forever';

/** Sayfadaki tüm sticky player'ları koordine eden modül seviyesi singleton (aynı anda tek sticky). */
class StickyManagerImpl {
    private readonly items = new Map<string, StickyItem>();
    private activeKey: string | null = null;
    private observer: IntersectionObserver | null = null;

    private lastUserGestureAt = 0;
    private lastGestureType: 'play' | 'pause' | 'other' | null = null;
    private gestureListenersAttached = false;

    private dismissedUntil = 0;
    private dismissedForever = false;
    private dismissLoaded = false;

    register(ctx: StickyPlayerContext, options: StickyOptions): StickyUnregister {
        this.ensureGestureListeners();
        this.loadDismissState();

        const resolved: StickyItem['options'] = {
            enabled: options.enabled ?? true,
            corner: options.corner ?? 'br',
            requirePlaying: options.requirePlaying ?? true,
            minPlayMs: options.minPlayMs ?? 800,
            onlyOneSticky: options.onlyOneSticky ?? true,
            closeActiveStickyOnAnotherPlay: options.closeActiveStickyOnAnotherPlay ?? true,
            userGestureWindowMs: options.userGestureWindowMs ?? GESTURE_WINDOW_MS,
            adCanTriggerSticky: options.adCanTriggerSticky ?? 'preroll-only',
            dismissMode: options.dismissMode ?? 'cooldown',
            cooldownMinutes: options.cooldownMinutes ?? 5,
            storage: options.storage ?? 'local',
            closeButton: options.closeButton ?? true,
        };

        if (!resolved.enabled) return () => {};

        const sentinel = document.createElement('div');
        sentinel.setAttribute('aria-hidden', 'true');
        sentinel.style.cssText = 'position:relative;width:1px;height:1px;pointer-events:none;opacity:0;';
        ctx.wrapperEl.parentNode?.insertBefore(sentinel, ctx.wrapperEl);

        const item: StickyItem = {
            ctx,
            options: resolved,
            sentinelEl: sentinel,
            state: {
                inView: true,
                playing: false,
                sticky: false,
                hasEverBeenInView: false,
                hasEverBeenInViewWhilePlaying: false,
                watchMsInView: 0,
                lastTickAt: 0,
                minPlaySatisfied: false,
                userPaused: false,
                userPausedAt: 0,
                adStartedOnce: false,
                contentStartedOnce: false,
                blockResumeUntil: 0,
                programmaticPauseUntil: 0,
                placeholderEl: null,
                closeBtnEl: null,
            },
        };
        this.items.set(ctx.key, item);

        this.ensureObserver().observe(sentinel);

        const onPlay = () => this.handlePlay(item);
        const onPause = () => this.handlePauseOrEnded(item, 'pause');
        const onEnded = () => this.handlePauseOrEnded(item, 'ended');
        const onAdStart = () => this.handleAdStart(item);
        const onAdEnd = () => this.handleAdEnd(item);

        ctx.videoEl.addEventListener('play', onPlay);
        ctx.videoEl.addEventListener('pause', onPause);
        ctx.videoEl.addEventListener('ended', onEnded);
        ctx.hostEl.addEventListener('hp:adstart', onAdStart);
        ctx.hostEl.addEventListener('hp:adend', onAdEnd);

        // Plugin dinamik yüklendiği için autoplay video'yu bu dinleyiciden önce başlatmış olabilir —
        // kaçırılan 'play'i telafi et, yoksa requirePlaying sticky'yi hiç açmaz.
        if (!ctx.videoEl.paused && !ctx.videoEl.ended) {
            this.handlePlay(item);
        }

        const unregister: StickyUnregister = () => {
            if (item.state.sticky) this.unstick(ctx.key, 'destroy');
            ctx.videoEl.removeEventListener('play', onPlay);
            ctx.videoEl.removeEventListener('pause', onPause);
            ctx.videoEl.removeEventListener('ended', onEnded);
            ctx.hostEl.removeEventListener('hp:adstart', onAdStart);
            ctx.hostEl.removeEventListener('hp:adend', onAdEnd);
            this.observer?.unobserve(sentinel);
            sentinel.remove();
            this.items.delete(ctx.key);
        };
        unregister.refreshLabels = () => {
            if (item.state.closeBtnEl) {
                item.state.closeBtnEl.setAttribute('aria-label', ctx.i18n.close);
            }
        };
        return unregister;
    }

    // ── gesture tracking (tüm sayfa için tek dinleyici) ──

    private ensureGestureListeners(): void {
        if (this.gestureListenersAttached || typeof window === 'undefined') return;
        this.gestureListenersAttached = true;

        window.addEventListener(
            'pointerdown',
            (e) => {
                this.lastUserGestureAt = Date.now();
                // composedPath()[0]: Shadow DOM'da e.target host'a retarget edilir; gerçek iç butonu almak için.
                const target = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
                const btn = target?.closest?.('button,[role="button"]') as HTMLElement | null;
                if (btn?.querySelector('.hp-icon-pause')) this.lastGestureType = 'pause';
                else if (btn?.querySelector('.hp-icon-play')) this.lastGestureType = 'play';
                else this.lastGestureType = 'other';
            },
            { capture: true, passive: true }
        );
        window.addEventListener(
            'keydown',
            () => {
                this.lastUserGestureAt = Date.now();
                this.lastGestureType = 'other';
            },
            { capture: true }
        );
    }

    // ── intersection observer (tüm sticky item'lar için tek instance) ──

    private ensureObserver(): IntersectionObserver {
        if (this.observer) return this.observer;
        this.observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const item = [...this.items.values()].find((i) => i.sentinelEl === entry.target);
                    if (!item) continue;
                    this.onIntersect(item, entry);
                }
            },
            { threshold: [0.35], rootMargin: '0px 0px -20% 0px' }
        );
        return this.observer;
    }

    private onIntersect(item: StickyItem, entry: IntersectionObserverEntry): void {
        this.accumulateWatch(item);
        const inView = entry.isIntersecting && entry.intersectionRatio >= 0.35;
        item.state.inView = inView;

        if (inView) {
            item.state.hasEverBeenInView = true;
            if (item.state.playing) item.state.hasEverBeenInViewWhilePlaying = true;
            if (item.state.sticky) this.unstick(item.ctx.key, 'back_in_view');
        } else {
            if (!item.state.hasEverBeenInView) return;
            const isActive = item.state.playing;
            if (item.options.requirePlaying && !isActive) return;
            this.maybeStick(item, 'out_of_view');
        }
    }

    // ── player event handlers ──

    private handlePlay(item: StickyItem): void {
        if (item.state.blockResumeUntil && Date.now() < item.state.blockResumeUntil) {
            item.ctx.videoEl.pause();
            item.state.playing = false;
            return;
        }
        if (item.ctx.isAdActive()) return;

        item.state.contentStartedOnce = true;
        const wasPlaying = item.state.playing;
        item.state.playing = true;
        if (!wasPlaying) {
            item.state.lastTickAt = Date.now();
            item.state.watchMsInView = 0;
        }
        if (item.state.inView) item.state.hasEverBeenInViewWhilePlaying = true;

        const gestureWindow = item.options.userGestureWindowMs;
        let userInitiated = Date.now() - this.lastUserGestureAt <= gestureWindow;
        if (this.lastGestureType === 'pause') userInitiated = false;
        if (item.state.userPaused && Date.now() - item.state.userPausedAt <= 1500) userInitiated = false;

        if (userInitiated) {
            item.state.userPaused = false;
            item.state.userPausedAt = 0;
            this.lastGestureType = 'play';
        }

        this.handleBecameActive(item, 'content', userInitiated);
    }

    private handlePauseOrEnded(item: StickyItem, kind: 'pause' | 'ended'): void {
        this.accumulateWatch(item);
        if (item.ctx.isAdActive()) {
            item.state.playing = true;
            return;
        }
        item.state.playing = false;

        const now = Date.now();
        if (item.state.programmaticPauseUntil && now < item.state.programmaticPauseUntil) {
            item.state.programmaticPauseUntil = 0;
            item.state.userPaused = false;
            item.state.userPausedAt = 0;
            return;
        }

        if (kind === 'pause') {
            const isUserPause = now - this.lastUserGestureAt <= item.options.userGestureWindowMs;
            if (isUserPause) {
                item.state.userPaused = true;
                item.state.userPausedAt = now;
                this.lastGestureType = 'pause';
            }
        } else if (item.state.sticky) {
            this.unstick(item.ctx.key, 'ended');
        }
    }

    private handleAdStart(item: StickyItem): void {
        const mode = item.options.adCanTriggerSticky;
        const isCurrentlySticky = this.activeKey === item.ctx.key;
        const isFirstAdEver = !item.state.adStartedOnce;
        item.state.adStartedOnce = true;
        item.state.lastTickAt = Date.now();
        item.state.playing = true;

        let allow = false;
        if (mode === 'always') allow = true;
        else if (mode === 'never') allow = false;
        else allow = isCurrentlySticky || (isFirstAdEver && !item.state.contentStartedOnce);

        if (!allow) return;
        this.handleBecameActive(item, 'ad', false);
    }

    private handleAdEnd(item: StickyItem): void {
        this.accumulateWatch(item);
        item.state.playing = !item.ctx.videoEl.paused && !item.ctx.videoEl.ended;
        item.state.lastTickAt = Date.now();
    }

    private handleBecameActive(item: StickyItem, source: 'content' | 'ad', userInitiated: boolean): void {
        item.state.playing = true;
        if (userInitiated) {
            item.state.userPaused = false;
            item.state.userPausedAt = 0;
            this.lastGestureType = 'play';
        }

        const now = Date.now();
        if (!item.state.lastTickAt) item.state.lastTickAt = now;
        if (item.state.inView) {
            item.state.hasEverBeenInView = true;
            item.state.hasEverBeenInViewWhilePlaying = true;
        }

        if (item.options.closeActiveStickyOnAnotherPlay && userInitiated && this.activeKey && this.activeKey !== item.ctx.key) {
            this.pauseAndUnstick(this.activeKey, 'another_played');
        }

        if (!item.state.inView) this.maybeStick(item, source === 'ad' ? 'play_ad' : 'play');
    }

    private accumulateWatch(item: StickyItem): void {
        const now = Date.now();
        const last = item.state.lastTickAt || now;
        item.state.lastTickAt = now;
        if (!item.state.playing || !item.state.inView) return;

        item.state.watchMsInView += now - last;
        if (!item.state.minPlaySatisfied && item.options.minPlayMs > 0 && item.state.watchMsInView >= item.options.minPlayMs) {
            item.state.minPlaySatisfied = true;
        }
    }

    // ── stick / unstick ──

    private maybeStick(item: StickyItem, _trigger: string): void {
        const maxMs = USER_PAUSED_MAX_MS;
        if (item.state.userPaused && Date.now() - item.state.userPausedAt > maxMs) {
            item.state.userPaused = false;
            item.state.userPausedAt = 0;
        }

        if (!item.state.hasEverBeenInView) return;
        if (!item.state.hasEverBeenInViewWhilePlaying) return;
        if (item.state.userPaused) return;

        const now = Date.now();
        if (item.options.dismissMode === 'never' && this.dismissedForever) return;
        if (item.options.dismissMode === 'cooldown' && this.dismissedUntil && now < this.dismissedUntil) return;

        if (item.options.requirePlaying && !item.state.playing) return;
        if (item.state.sticky) return;
        if (item.options.minPlayMs > 0 && !item.state.minPlaySatisfied) return;

        if (item.options.onlyOneSticky && this.activeKey && this.activeKey !== item.ctx.key) {
            this.pauseAndUnstick(this.activeKey, 'replaced');
        }

        this.stick(item);
    }

    private stick(item: StickyItem): void {
        const wrapper = item.ctx.wrapperEl;
        const corner = item.options.corner;

        if (!item.state.placeholderEl) {
            const ph = document.createElement('div');
            ph.setAttribute('data-hope-sticky-placeholder', '1');
            const rect = wrapper.getBoundingClientRect();
            ph.style.height = `${rect.height}px`;
            wrapper.parentNode?.insertBefore(ph, wrapper);
            item.state.placeholderEl = ph;
        }

        wrapper.setAttribute('data-sticky', '1');
        wrapper.setAttribute('data-sticky-corner', corner);

        if (item.options.closeButton && !item.state.closeBtnEl) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('part', 'sticky-close-button');
            btn.setAttribute('aria-label', item.ctx.i18n.close);
            btn.className =
                'hp:absolute hp:top-1 hp:right-1 hp:z-30 hp:flex hp:items-center hp:justify-center hp:w-6 hp:h-6 ' +
                'hp:rounded-full hp:bg-black/60 hp:text-white hp:border-0 hp:cursor-pointer';
            btn.innerHTML = '<i class="hp-icon hp-icon-close" aria-hidden="true"></i>';
            btn.addEventListener('click', () => {
                this.applyGlobalDismiss(item.options);
                this.pauseAndUnstick(item.ctx.key, 'closed');
            });
            item.ctx.closeButtonMountEl.appendChild(btn);
            item.state.closeBtnEl = btn;
        }

        item.state.sticky = true;
        this.activeKey = item.ctx.key;
        item.ctx.hostEl.dispatchEvent(new CustomEvent('hp:sticky', { detail: { sticky: true, corner } }));
    }

    private unstick(key: string, _reason: string): void {
        const item = this.items.get(key);
        if (!item) return;

        const wrapper = item.ctx.wrapperEl;
        wrapper.removeAttribute('data-sticky');
        wrapper.removeAttribute('data-sticky-corner');

        item.state.closeBtnEl?.remove();
        item.state.closeBtnEl = null;
        item.state.placeholderEl?.remove();
        item.state.placeholderEl = null;

        item.state.sticky = false;
        if (this.activeKey === key) this.activeKey = null;
        item.ctx.hostEl.dispatchEvent(new CustomEvent('hp:sticky', { detail: { sticky: false } }));
    }

    private pauseAndUnstick(key: string, reason: string): void {
        const item = this.items.get(key);
        if (!item) return;

        const now = Date.now();
        item.state.blockResumeUntil = now + BLOCK_RESUME_MS;
        item.state.programmaticPauseUntil = now + PROGRAMMATIC_PAUSE_MS;

        item.ctx.videoEl.pause();
        item.state.playing = false;
        this.unstick(key, reason);
    }

    // ── global dismiss (localStorage/sessionStorage) ──

    private loadDismissState(): void {
        if (this.dismissLoaded) return;
        this.dismissLoaded = true;
        try {
            const st = window.localStorage;
            this.dismissedUntil = Number(st.getItem(STORAGE_KEY) || 0) || 0;
            this.dismissedForever = st.getItem(STORAGE_KEY_FOREVER) === '1';
        } catch {
            /* storage erişilemez (gizli mod vb.) — sessizce yoksay */
        }
    }

    private applyGlobalDismiss(options: StickyItem['options']): void {
        if (options.dismissMode === 'none') return;
        const storage = options.storage === 'memory' ? null : options.storage === 'session' ? window.sessionStorage : window.localStorage;

        if (options.dismissMode === 'never') {
            this.dismissedForever = true;
            try {
                storage?.setItem(STORAGE_KEY_FOREVER, '1');
            } catch {
                /* no-op */
            }
            return;
        }

        const until = Date.now() + options.cooldownMinutes * 60000;
        this.dismissedUntil = until;
        try {
            storage?.setItem(STORAGE_KEY, String(until));
        } catch {
            /* no-op */
        }
    }
}

export const stickyManager = new StickyManagerImpl();
export type { StickyCorner };
