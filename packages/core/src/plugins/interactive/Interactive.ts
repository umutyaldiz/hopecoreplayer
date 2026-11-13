import type { InteractiveCard, InteractiveChoice, InteractiveItem, InteractiveOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { createIcon } from '../../icons/Icon';
import { adoptStyle } from '../../utils/plugin-style';
import css from './interactive.css?inline';
import { isSafeUrl } from '../../utils/safe-url';

export interface InteractivePlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    isAdActive(): boolean;
    addSeekBarMarker(ratio: number, extraClass?: string, label?: string): HTMLElement;
}

interface Entry {
    item: InteractiveItem;
    id: string;
    /** Bu oturumda gösterildi (ileri geri sarınca tekrar sorulmaz). */
    done: boolean;
}

const STORE = 'hp-interactive:';
/** Bu kadar saniye geç kalınırsa (ileri sarma) öğe atlanır. */
const LATE = 1.5;

function choiceOf(c: string | InteractiveChoice, i: number): { id: string; text: string } {
    return typeof c === 'string' ? { id: String(i), text: c } : { id: c.id ?? String(i), text: c.text };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

/**
 * Etkileşimli içerik: belirli saniyelerde anket, quiz, ürün ya da bağlantı kartı. Zamanlama videonun zamanıyla
 * işler (duraklatınca süre durur); ileri sarılıp geçilen öğe gösterilmez. Cevaplanan anket / quiz izleyiciye bir daha
 * sorulmaz (localStorage). Reklam oynarken gizlenir.
 */
export class Interactive {
    private entries: Entry[] = [];
    private active: { entry: Entry; el: HTMLElement; shownAt: number; pausedByUs: boolean; answered: boolean } | null = null;
    private markers: HTMLElement[] = [];
    private closeTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly ctx: InteractivePlayerContext,
        private options: InteractiveOptions
    ) {
        adoptStyle(ctx.overlayEl, 'interactive', css);
        this.entries = options.items.map((item, i) => ({ item, id: item.id ?? `i${i}`, done: false }));
        const v = ctx.videoEl;
        v.addEventListener('timeupdate', this.onTime);
        v.addEventListener('seeked', this.onSeeked);
        v.addEventListener('loadedmetadata', this.drawMarkers);
        v.addEventListener('emptied', this.onEmptied);
        ctx.hostEl.addEventListener('hp:adstart', this.onAdStart);
        if (v.readyState >= 1) this.drawMarkers();
    }

    /** Yalnızca fonksiyonlar değişti (ör. React'te her render'da yeni onAnswer). */
    setOptions(options: InteractiveOptions): void {
        this.options = options;
    }

    refreshLabels(): void {
        // Açık öğenin metinleri bir sonraki gösterimde dilden okunur; açık olanın kapat etiketi güncellenir.
        this.active?.el.querySelector('.hp-ia-close')?.setAttribute('aria-label', this.ctx.i18n.interactiveClose);
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        v.removeEventListener('timeupdate', this.onTime);
        v.removeEventListener('seeked', this.onSeeked);
        v.removeEventListener('loadedmetadata', this.drawMarkers);
        v.removeEventListener('emptied', this.onEmptied);
        this.ctx.hostEl.removeEventListener('hp:adstart', this.onAdStart);
        this.hide(null);
        for (const m of this.markers) m.remove();
        this.markers = [];
    }

    private emit(state: 'shown' | 'answer' | 'click' | 'dismiss', entry: Entry, extra: Record<string, unknown> = {}): boolean {
        return this.ctx.hostEl.dispatchEvent(
            new CustomEvent('hp:interactive', { detail: { state, id: entry.id, type: entry.item.type, ...extra }, cancelable: state === 'click' })
        );
    }

    private readonly drawMarkers = (): void => {
        for (const m of this.markers) m.remove();
        this.markers = [];
        const d = this.ctx.videoEl.duration;
        if (this.options.markers === false || !Number.isFinite(d) || d <= 0) return;
        for (const e of this.entries) {
            if (e.item.time < 0 || e.item.time > d) continue;
            const m = this.ctx.addSeekBarMarker(e.item.time / d, 'hp-ia-marker', 'question' in e.item ? e.item.question : e.item.title);
            const color = e.item.markerColor ?? this.options.markerColor;
            if (color) m.style.backgroundColor = color;
            this.markers.push(m);
        }
    };

    /** Yeni kaynak: oturum durumu sıfırlanır. */
    private readonly onEmptied = (): void => {
        this.hide(null);
        for (const e of this.entries) e.done = false;
    };

    private readonly onAdStart = (): void => {
        // Reklam açık öğeyi örtmesin — kapat, reklamdan sonra tekrar gösterilmez.
        if (this.active && !this.active.answered) this.hide('timeout');
    };

    private remembered(entry: Entry): boolean {
        if (this.options.rememberAnswers === false || (entry.item.type !== 'poll' && entry.item.type !== 'quiz')) return false;
        try {
            return localStorage.getItem(STORE + entry.id) !== null;
        } catch {
            return false;
        }
    }

    private remember(entry: Entry, choice: number): void {
        if (this.options.rememberAnswers === false) return;
        try {
            localStorage.setItem(STORE + entry.id, String(choice));
        } catch {
            /* depolama kapalı */
        }
    }

    private duration(item: InteractiveItem): number {
        return item.duration ?? (item.type === 'poll' || item.type === 'quiz' ? 15 : 8);
    }

    /** Geri sarınca sonraki öğeler yeniden gösterilebilir (cevaplanmış anket / quiz yine sorulmaz). */
    private readonly onSeeked = (): void => {
        const t = this.ctx.videoEl.currentTime;
        for (const e of this.entries) if (e.item.time > t + 0.1 && e !== this.active?.entry) e.done = false;
        this.onTime();
    };

    private readonly onTime = (): void => {
        const t = this.ctx.videoEl.currentTime;
        const a = this.active;
        if (a) {
            // Geri sarıldı ya da süresi doldu (cevaplanmış anket sonucu kendi zamanlayıcısıyla kapanır).
            if (t < a.entry.item.time - 0.5) this.hide('seek');
            else if (!a.answered && t >= a.shownAt + this.duration(a.entry.item)) this.hide('timeout');
            // Sonuç gösterilirken sıradaki öğenin zamanı geldi — sonucu kapat, yenisini göster.
            else if (a.answered && this.entries.some((e) => !e.done && t >= e.item.time && t - e.item.time <= LATE)) this.hide(null);
            else return;
        }
        if (this.ctx.isAdActive()) return;
        for (const e of this.entries) {
            if (e.done || t < e.item.time) continue;
            e.done = true;
            // İleri sarılıp geçildiyse ya da daha önce cevaplandıysa gösterme.
            if (t - e.item.time > LATE || this.remembered(e)) continue;
            this.show(e, t);
            return;
        }
    };

    private show(entry: Entry, t: number): void {
        const item = entry.item;
        const box = el('div', 'hp-ia');
        box.setAttribute('part', `interactive interactive-${item.type}`);
        box.setAttribute('data-type', item.type);
        box.setAttribute('data-position', item.position ?? (item.type === 'poll' || item.type === 'quiz' ? 'top-right' : 'bottom-right'));
        box.setAttribute('role', 'group');
        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) box.addEventListener(ev, (e) => e.stopPropagation());
        box.addEventListener('keydown', (e) => e.stopPropagation());

        if (item.dismissible !== false) {
            const close = el('button', 'hp-ia-close');
            close.type = 'button';
            close.setAttribute('aria-label', this.ctx.i18n.interactiveClose);
            close.appendChild(createIcon('close'));
            close.addEventListener('click', () => this.hide('user'));
            box.appendChild(close);
        }

        if (item.type === 'poll' || item.type === 'quiz') this.buildQuestion(box, entry);
        else this.buildCard(box, entry, item);

        this.ctx.overlayEl.appendChild(box);
        const v = this.ctx.videoEl;
        const pausedByUs = !!item.pause && !v.paused;
        if (pausedByUs) v.pause();
        this.active = { entry, el: box, shownAt: t, pausedByUs, answered: false };
        this.emit('shown', entry);
    }

    private buildQuestion(box: HTMLElement, entry: Entry): void {
        const item = entry.item as Extract<InteractiveItem, { type: 'poll' | 'quiz' }>;
        const i18n = this.ctx.i18n;
        box.appendChild(el('span', 'hp-ia-label', item.type === 'poll' ? i18n.interactivePoll : i18n.interactiveQuiz));
        const q = el('p', 'hp-ia-question', item.question);
        q.id = `hp-ia-q-${entry.id}`;
        box.setAttribute('aria-labelledby', q.id);
        box.appendChild(q);
        const list = el('div', 'hp-ia-choices');
        const choices = item.choices.map(choiceOf);
        const buttons = choices.map((c, i) => {
            const b = el('button', 'hp-ia-choice');
            b.type = 'button';
            b.appendChild(el('span', 'hp-ia-choice-text', c.text));
            b.addEventListener('click', () => void this.answer(entry, i, choices[i]!.id, buttons));
            list.appendChild(b);
            return b;
        });
        box.appendChild(list);
        const status = el('p', 'hp-ia-status');
        status.setAttribute('aria-live', 'polite');
        box.appendChild(status);
    }

    private async answer(entry: Entry, choice: number, choiceId: string, buttons: HTMLButtonElement[]): Promise<void> {
        const a = this.active;
        if (!a || a.entry !== entry || a.answered) return;
        a.answered = true;
        const item = entry.item as Extract<InteractiveItem, { type: 'poll' | 'quiz' }>;
        const correct = item.type === 'quiz' ? choice === item.answer : undefined;
        this.remember(entry, choice);
        for (const b of buttons) b.disabled = true;
        buttons[choice]?.setAttribute('data-picked', '');
        const status = a.el.querySelector<HTMLElement>('.hp-ia-status');
        this.emit('answer', entry, { choice, choiceId, ...(correct !== undefined ? { correct } : {}) });

        let results: number[] | void | undefined;
        try {
            results = await this.options.onAnswer?.({ item, id: entry.id, choice, choiceId, correct });
        } catch {
            results = undefined;
        }
        if (this.active?.entry !== entry) return;

        if (item.type === 'quiz') {
            buttons[item.answer]?.setAttribute('data-correct', '');
            if (!correct) buttons[choice]?.setAttribute('data-wrong', '');
            if (status) status.textContent = `${correct ? this.ctx.i18n.interactiveCorrect : this.ctx.i18n.interactiveWrong}${item.explanation ? ` ${item.explanation}` : ''}`;
        } else {
            // Sonuç: onAnswer'ın döndürdüğü, yoksa verilen dağılım + bu oy.
            const base = Array.isArray(results) ? results : item.results ? item.results.map((n, i) => n + (i === choice ? 1 : 0)) : null;
            if (base) {
                const total = base.reduce((s, n) => s + (Number.isFinite(n) && n > 0 ? n : 0), 0) || 1;
                buttons.forEach((b, i) => {
                    const pct = Math.round(((base[i] ?? 0) / total) * 100);
                    b.style.setProperty('--hp-ia-pct', `${pct}%`);
                    b.setAttribute('data-result', '');
                    b.appendChild(el('span', 'hp-ia-pct', this.ctx.i18n.interactiveVotes(pct)));
                });
            }
        }
        // Sonuç birkaç saniye görünür, sonra kapanır (duraklattıysak oynatma devam eder).
        this.closeTimer = setTimeout(() => this.hide(null), item.type === 'quiz' ? 5000 : 3500);
    }

    private buildCard(box: HTMLElement, entry: Entry, item: InteractiveCard): void {
        const i18n = this.ctx.i18n;
        const link = el('a', 'hp-ia-card');
        if (isSafeUrl(item.url)) link.href = item.url;
        if (item.newTab !== false) {
            link.target = '_blank';
            link.rel = 'noopener';
        }
        if (item.image) {
            const img = el('img', 'hp-ia-image');
            img.src = item.image;
            img.alt = '';
            img.decoding = 'async';
            img.addEventListener('error', () => img.remove());
            link.appendChild(img);
        }
        const body = el('span', 'hp-ia-body');
        if (item.sponsored) body.appendChild(el('span', 'hp-ia-label', i18n.interactiveSponsored));
        body.appendChild(el('span', 'hp-ia-title', item.title));
        if (item.subtitle) body.appendChild(el('span', 'hp-ia-sub', item.subtitle));
        if (item.price || item.oldPrice) {
            const price = el('span', 'hp-ia-price');
            if (item.price) price.appendChild(el('strong', '', item.price));
            if (item.oldPrice) price.appendChild(el('s', '', item.oldPrice));
            body.appendChild(price);
        }
        body.appendChild(el('span', 'hp-ia-cta', item.cta ?? (item.type === 'product' ? i18n.interactiveBuy : i18n.interactiveGo)));
        link.appendChild(body);
        link.addEventListener('click', (e) => {
            // preventDefault → entegratör kendisi açar (sepete ekle, SPA router).
            if (!this.emit('click', entry, { url: item.url })) e.preventDefault();
        });
        box.setAttribute('aria-label', item.title);
        box.appendChild(link);
    }

    private hide(reason: 'user' | 'timeout' | 'seek' | null): void {
        if (this.closeTimer) clearTimeout(this.closeTimer);
        this.closeTimer = null;
        const a = this.active;
        if (!a) return;
        this.active = null;
        a.el.remove();
        if (reason) this.emit('dismiss', a.entry, { reason });
        if (a.pausedByUs && reason !== 'seek') void this.ctx.videoEl.play().catch(() => {});
    }
}
