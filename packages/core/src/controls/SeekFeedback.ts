import type { HopeLocaleStrings } from '../i18n/types';

/** Bu süre (ms) içinde aynı yöne tekrar sarılırsa süreler toplanır (+5 → +10 → +15). */
const ACCUMULATE_WINDOW_MS = 1000;
/** Son sarmadan bu kadar sonra bildirim kaybolur. */
const HIDE_AFTER_MS = 800;

const CHEVRON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.3 5.3a1.2 1.2 0 0 1 1.7 0l5.8 5.8a1.2 1.2 0 0 1 0 1.8l-5.8 5.8a1.2 1.2 0 0 1-1.7-1.7l4.9-5-4.9-5a1.2 1.2 0 0 1 0-1.7z"/></svg>';

/**
 * İleri/geri sarmada videonun sağında (ileri) ya da solunda (geri) beliren anlık bildirim.
 * Sarma butonları ve klavye kısayolları tetikler; ard arda sarmalar toplanıp tek sayı olarak gösterilir.
 */
export class SeekFeedback {
    readonly el: HTMLDivElement;
    private readonly valueEl: HTMLSpanElement;
    private readonly unitEl: HTMLSpanElement;
    private readonly liveEl: HTMLSpanElement;
    private total = 0;
    private lastAt = 0;
    private hideTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly labels: HopeLocaleStrings) {
        this.el = document.createElement('div');
        this.el.className = 'hp-seek-fb';
        this.el.setAttribute('part', 'seek-feedback');

        const chevrons = document.createElement('span');
        chevrons.className = 'hp-seek-fb-chevrons';
        chevrons.innerHTML = CHEVRON.repeat(3);

        const value = document.createElement('span');
        value.className = 'hp-seek-fb-value';
        this.valueEl = document.createElement('span');
        this.valueEl.className = 'hp-seek-fb-num';
        this.unitEl = document.createElement('span');
        this.unitEl.className = 'hp-seek-fb-unit';
        value.append(this.valueEl, this.unitEl);

        // Ekran okuyucu için ayrı, görünmez metin ("15 saniye ileri").
        this.liveEl = document.createElement('span');
        this.liveEl.className = 'hp-sr-only';
        this.liveEl.setAttribute('aria-live', 'polite');

        this.el.append(chevrons, value, this.liveEl);
    }

    /** `delta` saniye sarıldı (negatif = geri). */
    show(delta: number): void {
        if (!delta) return;
        const now = Date.now();
        const sameDirection = Math.sign(delta) === Math.sign(this.total);
        this.total = sameDirection && now - this.lastAt < ACCUMULATE_WINDOW_MS ? this.total + delta : delta;
        this.lastAt = now;

        const seconds = Math.round(Math.abs(this.total) * 10) / 10;
        const forward = this.total > 0;
        this.el.dataset.side = forward ? 'forward' : 'back';
        this.valueEl.textContent = `${forward ? '+' : '−'}${seconds}`;
        this.unitEl.textContent = this.labels.secondsShort;
        this.liveEl.textContent = (forward ? this.labels.skipForward : this.labels.skipBack)(seconds);

        // Sayı her artışta "zıplasın" — animasyonu yeniden başlat.
        this.valueEl.classList.remove('hp-seek-fb-bump');
        void this.valueEl.offsetWidth;
        this.valueEl.classList.add('hp-seek-fb-bump');

        this.el.setAttribute('data-visible', '');
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            this.el.removeAttribute('data-visible');
            this.total = 0;
        }, HIDE_AFTER_MS);
    }

    destroy(): void {
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.el.remove();
    }
}
