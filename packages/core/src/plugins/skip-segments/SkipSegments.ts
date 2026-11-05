import type { SkipSegment, SkipSegmentType } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { createIcon } from '../../icons/Icon';
import { vodSeekTarget } from '../../utils/seek-by';

export interface SkipSegmentsPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayContainerEl: HTMLElement;
    isAdActive(): boolean;
    i18n: HopeLocaleStrings;
}

/** Bölüm sonuna bu kadar kala buton kalkar — sona yaklaşırken bir an görünüp kaybolmasın. */
const END_MARGIN_SEC = 0.25;

interface Active {
    index: number;
    segment: SkipSegment;
    end: number;
    /** Butonun göründüğü video zamanı — `hideAfter` / `autoSkip` geri sayımı video zamanıyla işler (duraklatınca durur). */
    shownAt: number;
    /** Kullanıcı bölüme sararak girdi ya da bölüm içinde geri sardı → bu gösterimde otomatik atlama yok. */
    autoCancelled: boolean;
}

/**
 * "İntroyu atla" / "Özeti atla" / "Jeneriği atla": bölüm oynarken köşede bir buton, basınca bölümün sonuna atlar.
 * `autoSkip` ile basılmadan (isteğe bağlı geri sayımla) atlar; `hideAfter` ile bir süre sonra çekilir, kontroller
 * açılınca geri gelir. Reklam sırasında görünmez. `hp:skip` (`skip`) iptal edilebilir.
 */
export class SkipSegments {
    private active: Active | null = null;
    private button: HTMLButtonElement | null = null;
    private labelEl: HTMLSpanElement | null = null;
    /** Kullanıcının (bizim değil) yaptığı sarma — bir sonraki timeupdate'te işlenir. */
    private userSeeked = false;
    private ownSeek = false;

    constructor(
        private readonly ctx: SkipSegmentsPlayerContext,
        private readonly segments: SkipSegment[]
    ) {
        const v = ctx.videoEl;
        v.addEventListener('timeupdate', this.update);
        v.addEventListener('seeking', this.onSeeking);
        v.addEventListener('seeked', this.update);
        v.addEventListener('loadstart', this.onSourceChange);
        ctx.hostEl.addEventListener('hp:adstart', this.update);
        ctx.hostEl.addEventListener('hp:adend', this.update);
        this.update();
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        v.removeEventListener('timeupdate', this.update);
        v.removeEventListener('seeking', this.onSeeking);
        v.removeEventListener('seeked', this.update);
        v.removeEventListener('loadstart', this.onSourceChange);
        this.ctx.hostEl.removeEventListener('hp:adstart', this.update);
        this.ctx.hostEl.removeEventListener('hp:adend', this.update);
        this.hide();
    }

    refreshLabels(): void {
        if (this.active && this.labelEl) this.labelEl.textContent = this.label(this.active.segment);
    }

    private label(s: SkipSegment): string {
        if (s.label) return s.label;
        const t = this.ctx.i18n;
        const byType: Record<SkipSegmentType, string> = { intro: t.skipIntro, recap: t.skipRecap, credits: t.skipCredits, custom: t.skipSegment };
        return byType[s.type ?? 'intro'] ?? t.skipSegment;
    }

    /** Bölümün sonu: `end` yoksa videonun sonu (süre bilinmiyorsa bölüm yok sayılır). */
    private endOf(s: SkipSegment): number | null {
        if (Number.isFinite(s.end)) return s.end!;
        const d = this.ctx.videoEl.duration;
        return Number.isFinite(d) && d > 0 ? d : null;
    }

    private readonly onSeeking = (): void => {
        if (this.ownSeek) this.ownSeek = false;
        else this.userSeeked = true;
    };

    private readonly onSourceChange = (): void => {
        this.hide();
        this.userSeeked = false;
    };

    private readonly update = (): void => {
        const v = this.ctx.videoEl;
        const t = v.currentTime;
        const seeked = this.userSeeked;
        this.userSeeked = false;

        let found: { index: number; segment: SkipSegment; end: number } | null = null;
        if (!this.ctx.isAdActive()) {
            for (let i = 0; i < this.segments.length; i++) {
                const s = this.segments[i]!;
                const end = this.endOf(s);
                if (end === null || !Number.isFinite(s.start)) continue;
                const from = Math.max(s.start, Number.isFinite(s.showFrom) ? s.showFrom! : s.start);
                const until = Number.isFinite(s.showUntil) ? Math.min(s.showUntil!, end) : end;
                if (t >= from && t < until - END_MARGIN_SEC) {
                    found = { index: i, segment: s, end };
                    break;
                }
            }
        }

        if (!found) {
            this.hide();
            return;
        }
        if (this.active?.index !== found.index) {
            this.hide();
            this.active = { ...found, shownAt: t, autoCancelled: seeked };
            this.show();
            this.emit('shown');
        } else if (seeked) {
            // Bölüm içinde sarma: geri sardıysa (kullanıcı bölümü izlemek istiyor) otomatik atlama bu gösterimde kapanır.
            this.active.autoCancelled = true;
            this.active.shownAt = Math.min(this.active.shownAt, t);
        }
        this.tick(t);
    };

    /** `hideAfter` (çekilme) ve `autoSkip` geri sayımı. */
    private tick(t: number): void {
        const a = this.active;
        if (!a || !this.button) return;
        const elapsed = Math.max(0, t - a.shownAt);
        const hideAfter = a.segment.hideAfter ?? 0;
        this.button.toggleAttribute('data-faded', hideAfter > 0 && elapsed >= hideAfter);

        const auto = a.segment.autoSkip;
        if (!auto || a.autoCancelled) {
            this.button.removeAttribute('data-auto');
            return;
        }
        const delay = auto === true ? 0 : Math.max(0, auto);
        if (elapsed >= delay) {
            this.skip('auto');
            return;
        }
        this.button.setAttribute('data-auto', '');
        this.button.style.setProperty('--hp-skip-progress', String(delay ? elapsed / delay : 1));
    }

    private show(): void {
        const a = this.active!;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hp-skip-segment';
        btn.setAttribute('part', 'skip-segment');
        btn.setAttribute('data-position', a.segment.position ?? 'bottom-right');
        btn.setAttribute('data-type', a.segment.type ?? 'intro');
        const label = document.createElement('span');
        label.className = 'hp-skip-segment-label';
        label.textContent = this.label(a.segment);
        btn.append(label, createIcon('skip-forward', 'hp-skip-segment-icon'));
        btn.addEventListener('click', () => this.skip('click'));
        // Oynat/duraklat ve çift tık tam ekran alttaki video alanına geçmesin.
        for (const ev of ['pointerdown', 'pointerup', 'click', 'dblclick'] as const) btn.addEventListener(ev, (e) => e.stopPropagation());
        this.ctx.overlayContainerEl.appendChild(btn);
        this.button = btn;
        this.labelEl = label;
    }

    private hide(): void {
        this.button?.remove();
        this.button = null;
        this.labelEl = null;
        this.active = null;
    }

    private emit(state: 'shown' | 'skip', reason?: 'click' | 'auto'): boolean {
        const a = this.active!;
        return this.ctx.hostEl.dispatchEvent(
            new CustomEvent('hp:skip', {
                detail: { state, type: a.segment.type ?? 'intro', start: a.segment.start, end: a.end, reason },
                cancelable: state === 'skip',
            })
        );
    }

    private skip(reason: 'click' | 'auto'): void {
        const a = this.active;
        if (!a) return;
        const focused = !!this.button?.matches(':focus');
        if (!this.emit('skip', reason)) {
            // Entegratör kendisi halletti — bu gösterim için otomatik atlama tekrar tetiklenmesin.
            a.autoCancelled = true;
            this.button?.removeAttribute('data-auto');
            return;
        }
        const v = this.ctx.videoEl;
        this.hide();
        this.ownSeek = true;
        v.currentTime = vodSeekTarget(v, a.end);
        // Klavyeyle basıldıysa odak kaybolmasın — player'a dön (kısayollar çalışmaya devam etsin).
        if (focused) this.ctx.hostEl.focus({ preventScroll: true });
    }
}
