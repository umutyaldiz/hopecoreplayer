import type { AgeGateOptions, AgeGateSubmit, AgeGroup, HopePlayerOptions } from '../../types';
import type { GatePlayerContext } from '../shared/GatePlayerContext';
import { adoptStyle } from '../../utils/plugin-style';
import { isSafeUrl } from '../../utils/safe-url';
import { storageGet, storageRemove, storageSet } from '../../utils/storage';
import css from './age-gate.css?inline';

export interface AgeGateContext extends GatePlayerContext {
    hostEl: HTMLElement;
}

const KEY = 'hp-age-gate';
const RING = '<svg class="hp-age-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45"/></svg>';
const CHECK = '<svg class="hp-age-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const LOCK =
    '<svg class="hp-age-lock" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3Z"/></svg>';
/** Kapanış animasyonu (ms) — reduced-motion'da beklenmez. */
const OUT_MS = 900;

/** Bugüne göre tam yaş; tarih geçersiz ya da gelecekteyse null. */
export function ageFrom(y: number, m: number, d: number, now = new Date()): number | null {
    const date = new Date(y, m - 1, d);
    if (y < 1900 || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d || date > now) return null;
    let age = now.getFullYear() - y;
    if (now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d)) age--;
    return age;
}

export function ageGroupOf(age: number): AgeGroup {
    if (age < 13) return '0-12';
    if (age < 18) return '13-17';
    if (age >= 65) return '65+';
    const lo = age < 25 ? 18 : Math.floor((age - 5) / 10) * 10 + 5;
    return `${lo}-${lo === 18 ? 24 : lo + 9}` as AgeGroup;
}

interface Stored {
    age: number;
    ok: boolean;
    until: number;
}

/** Yaş kapısı: player kaynağı, reklamı ve autoplay'i geçilene kadar erteler; doğum tarihi değil yalnızca yaş saklanır. */
export class AgeGate {
    private resolved = false;
    private readonly callbacks: Array<() => void> = [];
    private wrap: HTMLElement | null = null;
    private card: HTMLElement | null = null;
    private view: 'wait' | 'form' | 'denied' = 'wait';
    private busy = false;
    private readonly reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    constructor(
        private readonly ctx: AgeGateContext,
        private options: AgeGateOptions
    ) {
        adoptStyle(ctx.overlayContainerEl, 'age-gate', css);
        ctx.videoEl.addEventListener('play', this.onPlay);
        const stored = this.read();
        if (stored && stored.ok && stored.age >= this.minAge) {
            this.finish('remembered');
            return;
        }
        this.mount();
        if (stored && !this.options.retry) {
            this.render('denied');
            this.emit('denied', 'remembered');
            return;
        }
        const check = this.options.checkAge;
        if (!check) {
            this.showForm();
            return;
        }
        // Sitenin kendi doğrulaması — yanıt gelene kadar yalnızca bulanık perde görünür.
        void Promise.resolve()
            .then(() => check())
            .catch(() => false)
            .then((ok) => {
                if (this.resolved || !this.wrap) return;
                if (ok === true) this.finish('check');
                else this.showForm();
            });
    }

    get minAge(): number {
        return Math.max(0, Math.floor(this.options.minAge ?? 18));
    }

    isComplete(): boolean {
        return this.resolved;
    }

    onComplete(cb: () => void): void {
        if (this.resolved) cb();
        else this.callbacks.push(cb);
    }

    /** Aynı ayarların yeni callback'leri (React yeniden render). */
    setOptions(options: HopePlayerOptions['ageGate']): void {
        if (options && typeof options === 'object') this.options = options;
    }

    refreshLabels(): void {
        if (this.view !== 'wait' && !this.busy) this.render(this.view);
    }

    destroy(): void {
        this.ctx.videoEl.removeEventListener('play', this.onPlay);
        if (this.wrap) {
            this.wrap.remove();
            this.wrap = null;
            this.ctx.unblockChrome();
        }
    }

    private readonly onPlay = (): void => {
        if (!this.resolved) this.ctx.videoEl.pause();
    };

    private emit(state: 'shown' | 'passed' | 'denied', source?: 'input' | 'remembered' | 'check', age?: number): void {
        const detail = { state, source, minAge: this.minAge, ...(age === undefined ? {} : { age, ageGroup: ageGroupOf(age) }) };
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:agegate', { detail }));
    }

    private read(): Stored | null {
        if (this.options.remember === false) return null;
        try {
            const raw = storageGet(KEY, true) ?? storageGet(KEY);
            const s = raw ? (JSON.parse(raw) as Stored) : null;
            if (!s || typeof s.age !== 'number') return null;
            if (s.until && s.until < Date.now()) {
                storageRemove(KEY);
                return null;
            }
            return s;
        } catch {
            return null;
        }
    }

    private save(age: number, ok: boolean): void {
        const r = this.options.remember ?? 'session';
        if (r === false) return;
        const days = typeof r === 'number' && r > 0 ? r : 0;
        storageSet(KEY, JSON.stringify({ age, ok, until: days ? Date.now() + days * 864e5 : 0 }), !days);
    }

    /** Geçti: kapı açılır, beklenen oynatma başlar. */
    private finish(source: 'input' | 'remembered' | 'check', age?: number): void {
        if (this.resolved) return;
        this.resolved = true;
        this.emit('passed', source, age);
        const done = (): void => {
            this.wrap?.remove();
            if (this.wrap) this.ctx.unblockChrome();
            this.wrap = null;
            for (const cb of this.callbacks.splice(0)) cb();
        };
        if (source !== 'input' || this.reduced || !this.wrap) return done();
        this.wrap.dataset.state = 'passed';
        const h = this.card?.querySelector('.hp-age-title');
        if (h) h.textContent = this.ctx.i18n.ageGatePassed;
        setTimeout(done, OUT_MS);
    }

    /** Perde hemen kurulur: video karesi / poster kart gelmeden görünmesin. */
    private mount(): void {
        const t = this.ctx.i18n;
        const wrap = document.createElement('div');
        wrap.className = 'hp-age';
        wrap.setAttribute('part', 'age-gate');
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', this.options.title || t.ageGateTitle(this.minAge));
        const img = this.options.image;
        if (img && isSafeUrl(img)) {
            const bg = document.createElement('img');
            bg.className = 'hp-age-bg';
            bg.src = img;
            bg.alt = '';
            wrap.appendChild(bg);
        }
        const aurora = document.createElement('div');
        aurora.className = 'hp-age-aurora';
        wrap.appendChild(aurora);
        // Altındaki videoya / kontrollere tıklama ve kısayol geçmesin.
        for (const ev of ['pointerdown', 'click', 'dblclick', 'keydown'] as const) wrap.addEventListener(ev, (e) => e.stopPropagation());
        this.ctx.overlayContainerEl.appendChild(wrap);
        this.wrap = wrap;
        this.ctx.blockChrome();
        if (!this.ctx.videoEl.paused) this.ctx.videoEl.pause();
    }

    private showForm(): void {
        this.render('form');
        this.emit('shown');
    }

    private render(view: 'form' | 'denied'): void {
        const wrap = this.wrap;
        if (!wrap) return;
        const t = this.ctx.i18n;
        const o = this.options;
        this.view = view;
        wrap.dataset.state = view;
        this.card?.remove();
        const card = document.createElement('div');
        card.className = 'hp-age-card';
        const badge = document.createElement('div');
        badge.className = 'hp-age-badge';
        badge.innerHTML = `${RING}<span class="hp-age-num">${this.minAge}+</span>${CHECK}${LOCK}`;
        const h = document.createElement('h3');
        h.className = 'hp-age-title';
        const p = document.createElement('p');
        p.className = 'hp-age-text';
        card.append(badge, h, p);
        if (view === 'denied') {
            h.textContent = t.ageGateDeniedTitle;
            p.textContent = t.ageGateDenied(this.minAge);
            if (o.retry) {
                const again = document.createElement('button');
                again.type = 'button';
                again.className = 'hp-age-submit secondary';
                again.textContent = t.ageGateRetry;
                again.addEventListener('click', () => {
                    storageRemove(KEY, true);
                    storageRemove(KEY);
                    this.showForm();
                });
                card.appendChild(again);
            }
        } else {
            h.textContent = o.title || t.ageGateTitle(this.minAge);
            p.textContent = o.text || t.ageGateText;
            card.appendChild(this.form());
        }
        if (o.note) {
            const note = document.createElement('p');
            note.className = 'hp-age-note';
            note.textContent = o.note;
            card.appendChild(note);
        }
        wrap.appendChild(card);
        this.card = card;
        // Sayfa başka bir yere odaklanmışsa (ör. arama kutusu) odağı çalma.
        const active = document.activeElement;
        if (!active || active === document.body || this.ctx.hostEl.contains(active))
            (card.querySelector('input, button') as HTMLElement | null)?.focus({ preventScroll: true });
    }

    private form(): HTMLFormElement {
        const t = this.ctx.i18n;
        const form = document.createElement('form');
        form.className = 'hp-age-form';
        form.noValidate = true;
        const fields = document.createElement('div');
        fields.className = 'hp-age-fields';
        const holders = t.ageGateFormat.split('/');
        const spec: Array<[string, number, AutoFill]> = [
            [t.ageGateDay, 2, 'bday-day'],
            [t.ageGateMonth, 2, 'bday-month'],
            [t.ageGateYear, 4, 'bday-year'],
        ];
        const inputs = spec.map(([label, len, auto], i) => {
            const wrap = document.createElement('label');
            wrap.className = `hp-age-field${len === 4 ? ' wide' : ''}`;
            wrap.style.setProperty('--i', String(i));
            const span = document.createElement('span');
            span.textContent = label;
            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'numeric';
            input.autocomplete = auto;
            input.maxLength = len;
            input.placeholder = holders[i] ?? '';
            input.setAttribute('aria-label', label);
            wrap.append(span, input);
            fields.appendChild(wrap);
            return input;
        });
        const error = document.createElement('p');
        error.className = 'hp-age-error';
        error.setAttribute('role', 'alert');
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'hp-age-submit';
        submit.innerHTML = '<span class="hp-age-spin" aria-hidden="true"></span>';
        submit.prepend(t.ageGateSubmit);

        inputs.forEach((input, i) => {
            input.addEventListener('input', () => {
                // "15.03.1990" ya da "1990-03-15" yapıştırılınca üç alana dağıt.
                const parts = input.value.match(/\d+/g);
                if (parts && parts.length === 3) {
                    const [a, b, c] = parts as [string, string, string];
                    const [d, m, y] = a.length === 4 ? [c, b, a] : [a, b, c];
                    inputs[0]!.value = d.slice(0, 2);
                    inputs[1]!.value = m.slice(0, 2);
                    inputs[2]!.value = y.slice(0, 4);
                    inputs[2]!.focus();
                } else input.value = input.value.replace(/\D/g, '').slice(0, input.maxLength);
                input.classList.toggle('filled', input.value.length > 0);
                error.textContent = '';
                form.removeAttribute('data-invalid');
                if (input.value.length === input.maxLength && i < 2) inputs[i + 1]!.focus();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !input.value && i > 0) inputs[i - 1]!.focus();
            });
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (this.busy) return;
            const [d, m, y] = inputs.map((x) => Number(x.value));
            const age = inputs[2]!.value.length === 4 ? ageFrom(y!, m!, d!) : null;
            if (age === null) {
                error.textContent = t.ageGateInvalid;
                form.removeAttribute('data-invalid');
                void form.offsetWidth; // sallama animasyonu yeniden başlasın
                form.dataset.invalid = '';
                return;
            }
            const result: AgeGateSubmit = {
                dateOfBirth: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                age,
                ageGroup: ageGroupOf(age),
                passed: age >= this.minAge,
            };
            void this.submit(result, form);
        });

        form.append(fields, error, submit);
        return form;
    }

    private async submit(result: AgeGateSubmit, form: HTMLFormElement): Promise<void> {
        let ok = result.passed;
        const cb = this.options.onSubmit;
        if (cb) {
            this.busy = true;
            form.dataset.busy = '';
            const r = await Promise.resolve()
                .then(() => cb(result))
                .catch(() => undefined);
            this.busy = false;
            delete form.dataset.busy;
            if (r === false) ok = false;
        }
        if (!this.wrap) return;
        this.save(result.age, ok);
        if (ok) return this.finish('input', result.age);
        this.render('denied');
        this.emit('denied', 'input', result.age);
    }
}
