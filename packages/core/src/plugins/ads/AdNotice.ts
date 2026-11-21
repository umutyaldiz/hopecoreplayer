import css from './ad-notice.css?inline';
import type { AdNoticesOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

type Labels = Pick<HopeLocaleStrings, 'adNoticeLoading' | 'adNoticeEmpty' | 'adNoticeCountdown'>;
type Resolved = Required<AdNoticesOptions>;

const EMPTY_MS = 2600;
const TRANSITION_MS = 420;
/** Geçiş perdesi reklam hiç başlamazsa en geç bu sürede kalkar. */
const CURTAIN_MAX_MS = 6000;

/** ads.notices: true → hepsi açık; obje → verilmeyenler varsayılan. */
export function resolveNotices(o: boolean | AdNoticesOptions | undefined): Resolved | null {
    if (!o) return null;
    const v = o === true ? {} : o;
    return {
        loading: v.loading !== false,
        empty: v.empty !== false,
        countdown: Math.max(0, Math.round(v.countdown ?? 3)),
        transition: v.transition ?? 'fade',
        position: v.position ?? 'bottom-right',
    };
}

/** Reklam durum bildirimi (yükleniyor / reklam yok / geri sayım) ve reklama geçiş perdesi. */
export class AdNotice {
    private el: HTMLDivElement | null = null;
    private textEl: HTMLSpanElement | null = null;
    private ringEl: HTMLElement | null = null;
    private curtain: HTMLDivElement | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private tick: ReturnType<typeof setInterval> | null = null;
    private curtainTimer: ReturnType<typeof setTimeout> | null = null;
    /** Kullanıcı "yükleniyor"u gördü — sonuç (reklam yok) ona bildirilir. */
    private loadingShown = false;

    constructor(
        private readonly area: HTMLElement,
        private readonly mediaLayer: HTMLElement,
        private readonly labels: () => Labels,
        readonly opts: Resolved
    ) {
        const root = area.getRootNode() as ShadowRoot;
        if ('host' in root && !root.querySelector('style[data-hp-style="ad-notice"]')) {
            const style = document.createElement('style');
            style.setAttribute('data-hp-style', 'ad-notice');
            style.textContent = css;
            root.appendChild(style);
        }
    }

    get isLoading(): boolean {
        return this.loadingShown;
    }

    loading(): void {
        if (!this.opts.loading || this.loadingShown) return;
        this.loadingShown = true;
        this.show('loading', this.labels().adNoticeLoading);
    }

    /** Reklam gelmedi: yalnızca kullanıcı beklediyse (yükleniyor göründüyse) söylenir. */
    empty(preroll: boolean): void {
        if (!this.loadingShown) return;
        this.loadingShown = false;
        if (!this.opts.empty) return this.hide();
        this.show('empty', this.labels().adNoticeEmpty(preroll));
        this.timer = setTimeout(() => this.hide(), EMPTY_MS);
    }

    /** Reklam hazır: geri sayım + geçiş perdesi, sonra `done`. Geri sayım kapalıysa hemen. */
    countdown(done: () => void, aborted: () => boolean): void {
        this.loadingShown = false;
        const total = this.opts.countdown;
        if (!total) {
            this.hide();
            return this.closeCurtain(done);
        }
        const end = Date.now() + total * 1000;
        let left = total;
        this.show('countdown', this.labels().adNoticeCountdown(left));
        this.el!.style.setProperty('--hp-ad-countdown', `${total}s`);
        this.ringEl!.textContent = String(left);
        this.tick = setInterval(() => {
            if (aborted()) return this.hide();
            const now = Math.ceil((end - Date.now()) / 1000);
            if (now > 0) {
                if (now === left) return;
                left = now;
                this.textEl!.textContent = this.labels().adNoticeCountdown(left);
                this.ringEl!.textContent = String(left);
                return;
            }
            this.hide();
            this.closeCurtain(done);
        }, 200);
    }

    /** Reklam başladı ya da vazgeçildi: bildirim kalkar, perde açılır. */
    hide(): void {
        this.clearTimers();
        this.loadingShown = false;
        this.el?.removeAttribute('data-visible');
    }

    /** Perde açılır — reklam (ya da içerik) görünür. */
    reveal(): void {
        const c = this.curtain;
        if (!c) return;
        if (this.curtainTimer) clearTimeout(this.curtainTimer);
        c.removeAttribute('data-closed');
        this.curtainTimer = setTimeout(() => c.remove(), TRANSITION_MS + 50);
        this.curtain = null;
    }

    destroy(): void {
        this.hide();
        this.reveal();
        this.el?.remove();
        this.el = null;
    }

    private closeCurtain(done: () => void): void {
        if (this.opts.transition === 'none') return done();
        const c = document.createElement('div');
        c.className = 'hp-ad-curtain';
        c.setAttribute('aria-hidden', 'true');
        c.setAttribute('data-kind', this.opts.transition);
        this.mediaLayer.appendChild(c);
        this.curtain = c;
        void c.offsetWidth;
        c.setAttribute('data-closed', '');
        this.curtainTimer = setTimeout(() => {
            done();
            this.curtainTimer = setTimeout(() => this.reveal(), CURTAIN_MAX_MS);
        }, TRANSITION_MS);
    }

    private show(kind: 'loading' | 'empty' | 'countdown', text: string): void {
        this.clearTimers();
        if (!this.el?.isConnected) {
            const el = document.createElement('div');
            el.className = 'hp-ad-notice';
            el.setAttribute('part', 'ad-notice');
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            el.setAttribute('data-position', this.opts.position);
            const mark = document.createElement('span');
            mark.className = 'hp-ad-notice-mark';
            mark.innerHTML = '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle cx="18" cy="18" r="15" pathLength="100"/></svg><b></b>';
            const ring = mark.querySelector('b')!;
            const textEl = document.createElement('span');
            el.append(mark, textEl);
            this.area.appendChild(el);
            this.el = el;
            this.ringEl = ring;
            this.textEl = textEl;
        }
        const el = this.el;
        el.setAttribute('data-kind', kind);
        this.ringEl!.textContent = '';
        this.textEl!.textContent = text;
        // Aynı türde yeniden gösterimde animasyon baştan başlasın.
        el.removeAttribute('data-visible');
        void el.offsetWidth;
        el.setAttribute('data-visible', '');
    }

    private clearTimers(): void {
        if (this.timer) clearTimeout(this.timer);
        if (this.tick) clearInterval(this.tick);
        this.timer = null;
        this.tick = null;
    }
}
