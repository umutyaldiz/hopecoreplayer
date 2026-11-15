import type { CourseNote, CourseOptions, CourseProgress } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { createIcon } from '../../icons/Icon';
import { formatTime } from '../../utils/format-time';
import { adoptStyle } from '../../utils/plugin-style';
import { showToast } from '../shared/toast';
import css from './course.css?inline';
import { storageGet, storageSet } from '../../utils/storage';

/** Kontrol çubuğu ikonu — yalnızca bu parçada (ana ikon fontuna girmez). */
const BOOKMARK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 2h11A1.5 1.5 0 0 1 19 3.5v17.6a.9.9 0 0 1 -1.4.7L12 18l-5.6 3.8a.9.9 0 0 1 -1.4 -.7V3.5A1.5 1.5 0 0 1 6.5 2Z"/></svg>';

export interface CoursePlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    seekBarEl: HTMLElement;
    addSeekBarMarker(ratio: number, extraClass?: string, label?: string): HTMLElement;
    i18n: HopeLocaleStrings;
    addButton(label: string, iconName: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
    isAdActive(): boolean;
    isLive(): boolean;
    holdChrome(hold: boolean): void;
}

type Range = [number, number];
interface Saved {
    ranges?: Range[];
    notes?: CourseNote[];
    hit?: number[];
    done?: boolean;
}

/** Doğal ilerleme sayılan en büyük adım (sn) — daha büyüğü sarmadır, izlenmiş sayılmaz. */
const MAX_STEP = 1.5;
/** Sarma engelinde tolerans (sn). */
const SLACK = 1;

/** Aralıkları sırala ve birleştir (0.25 sn'lik boşluklar da birleşir). */
export function mergeRanges(list: Range[]): Range[] {
    const sorted = list.filter((r) => Array.isArray(r) && r[1] > r[0]).sort((a, b) => a[0] - b[0]);
    const out: Range[] = [];
    for (const [s, e] of sorted) {
        const last = out[out.length - 1];
        if (last && s <= last[1] + 0.25) last[1] = Math.max(last[1], e);
        else out.push([s, e]);
    }
    return out;
}

/**
 * Eğitim modu: gerçekten izlenen aralıklar sayılır (sarılan yerler sayılmaz), izlenmemiş kısma ileri sarma engellenir,
 * belirli yüzdelerde ve tamamlanınca `hp:course` gelir; zamana bağlı notlar seek bar'da işaretlenir. Her şey `id` ile bu
 * tarayıcıda saklanır, `initial` ile sunucunuzdaki ilerleme eklenebilir.
 */
export class Course {
    private ranges: Range[] = [];
    private notes: CourseNote[] = [];
    private hit = new Set<number>();
    private done = false;
    private lastTime = 0;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private watchedEl: HTMLElement | null = null;
    private noteMarkers: HTMLElement[] = [];
    private button: HTMLButtonElement | null = null;
    private panel: HTMLElement | null = null;
    private readonly key: string;

    constructor(
        private readonly ctx: CoursePlayerContext,
        private readonly options: CourseOptions
    ) {
        adoptStyle(ctx.overlayEl, 'course', css);
        adoptStyle(ctx.seekBarEl, 'course', css);
        this.key = `hp-course:${options.id}`;
        this.load();
        const v = ctx.videoEl;
        this.lastTime = v.currentTime;
        v.addEventListener('timeupdate', this.onTime);
        v.addEventListener('seeking', this.onSeeking);
        v.addEventListener('ratechange', this.onRate);
        v.addEventListener('pause', this.saveNow);
        v.addEventListener('ended', this.onTime);
        v.addEventListener('loadedmetadata', this.renderAll);
        if (options.showWatched !== false) {
            this.watchedEl = document.createElement('div');
            this.watchedEl.className = 'hp-course-watched';
            this.watchedEl.setAttribute('part', 'course-watched');
            ctx.seekBarEl.prepend(this.watchedEl);
        }
        if (options.notes !== false) {
            const { btn } = ctx.addButton(ctx.i18n.courseNotes, BOOKMARK_ICON, () => this.toggleNotes());
            btn.setAttribute('aria-expanded', 'false');
            this.button = btn;
        }
        window.addEventListener('pagehide', this.saveNow);
        this.onRate();
        this.renderAll();
    }

    // ── Kalıcılık ──

    private load(): void {
        let saved: Saved = {};
        try {
            saved = JSON.parse(storageGet(this.key) ?? '{}') as Saved;
        } catch {
            /* depolama kapalı / bozuk */
        }
        const init = this.options.initial ?? {};
        this.ranges = mergeRanges([...(saved.ranges ?? []), ...(init.ranges ?? [])].map((r) => [Number(r[0]), Number(r[1])] as Range));
        const notes = new Map<string, CourseNote>();
        for (const n of [...(init.notes ?? []), ...(saved.notes ?? [])]) if (n && n.id && typeof n.time === 'number') notes.set(n.id, { id: n.id, time: n.time, text: String(n.text ?? '') });
        this.notes = [...notes.values()].sort((a, b) => a.time - b.time);
        this.hit = new Set(saved.hit ?? []);
        this.done = !!saved.done;
    }

    private readonly saveNow = (): void => {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
        try {
            storageSet(this.key, JSON.stringify({ ranges: this.ranges, notes: this.notes, hit: [...this.hit], done: this.done } satisfies Saved));
        } catch {
            /* depolama kapalı */
        }
    };

    private save(): void {
        this.saveTimer ??= setTimeout(this.saveNow, 2000);
    }

    destroy(): void {
        this.saveNow();
        const v = this.ctx.videoEl;
        v.removeEventListener('timeupdate', this.onTime);
        v.removeEventListener('seeking', this.onSeeking);
        v.removeEventListener('ratechange', this.onRate);
        v.removeEventListener('pause', this.saveNow);
        v.removeEventListener('ended', this.onTime);
        v.removeEventListener('loadedmetadata', this.renderAll);
        window.removeEventListener('pagehide', this.saveNow);
        this.closeNotes();
        this.watchedEl?.remove();
        for (const m of this.noteMarkers) m.remove();
        this.button?.remove();
    }

    refreshLabels(): void {
        this.button?.setAttribute('aria-label', this.ctx.i18n.courseNotes);
        if (this.panel) {
            this.closeNotes();
            this.openNotes();
        }
    }

    // ── İlerleme ──

    private get duration(): number {
        const d = this.ctx.videoEl.duration;
        return Number.isFinite(d) && d > 0 ? d : 0;
    }

    getProgress(): CourseProgress {
        const watched = this.ranges.reduce((a, [s, e]) => a + (e - s), 0);
        const d = this.duration;
        const percent = d ? Math.min(100, Math.round((watched / d) * 1000) / 10) : 0;
        return { watched: Math.round(watched * 10) / 10, percent, completed: this.done, ranges: this.ranges.map((r) => [r[0], r[1]]), notes: this.notes.map((n) => ({ ...n })) };
    }

    private emit(state: 'progress' | 'complete' | 'blocked' | 'note', extra: { milestone?: number; time?: number } = {}): void {
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:course', { detail: { state, ...extra, progress: this.getProgress() } }));
    }

    private readonly onTime = (): void => {
        const v = this.ctx.videoEl;
        const t = v.currentTime;
        const step = t - this.lastTime;
        if (step > 0 && step <= MAX_STEP && !this.ctx.isAdActive() && !this.ctx.isLive()) {
            this.ranges = mergeRanges([...this.ranges, [this.lastTime, t]]);
            this.save();
            this.check();
            this.renderWatched();
        }
        this.lastTime = t;
    };

    private check(): void {
        const p = this.getProgress();
        for (const m of [...(this.options.milestones ?? [25, 50, 75, 100])].sort((a, b) => a - b)) {
            if (p.percent + 0.05 >= m && !this.hit.has(m)) {
                this.hit.add(m);
                this.emit('progress', { milestone: m });
            }
        }
        const at = Math.min(1, Math.max(0.1, this.options.completeAt ?? 0.9)) * 100;
        if (!this.done && p.percent + 0.05 >= at) {
            this.done = true;
            this.saveNow();
            this.emit('complete');
            showToast(this.ctx.overlayEl, this.ctx.i18n.courseCompleted, 3000);
        }
    }

    /** Sarmanın gidebileceği en ileri nokta: baştan kesintisiz izlenen kısmın sonu ya da sarmadan önceki konum. */
    private reachable(from: number): number {
        let end = 0;
        for (const [s, e] of this.ranges) {
            if (s <= end + 0.5) end = Math.max(end, e);
            else break;
        }
        return Math.max(end, from);
    }

    private readonly onSeeking = (): void => {
        if (this.options.preventSkip === false || this.ctx.isLive() || this.ctx.isAdActive()) return;
        const v = this.ctx.videoEl;
        const target = v.currentTime;
        const inRange = this.ranges.some(([s, e]) => target >= s - SLACK && target <= e + SLACK);
        const limit = this.reachable(this.lastTime);
        if (inRange || target <= limit + SLACK) return;
        v.currentTime = limit;
        this.lastTime = limit;
        this.emit('blocked', { time: target });
        showToast(this.ctx.overlayEl, this.ctx.i18n.courseBlocked);
    };

    private readonly onRate = (): void => {
        const max = this.options.maxRate;
        const v = this.ctx.videoEl;
        if (max && max > 0 && v.playbackRate > max) v.playbackRate = max;
    };

    // ── Çizim ──

    private readonly renderAll = (): void => {
        this.renderWatched();
        this.renderNoteMarkers();
    };

    private renderWatched(): void {
        const el = this.watchedEl;
        const d = this.duration;
        if (!el || !d) return;
        el.replaceChildren(
            ...this.ranges.map(([s, e]) => {
                const seg = document.createElement('i');
                seg.style.left = `${(s / d) * 100}%`;
                seg.style.width = `${((e - s) / d) * 100}%`;
                return seg;
            })
        );
    }

    private renderNoteMarkers(): void {
        for (const m of this.noteMarkers) m.remove();
        this.noteMarkers = [];
        const d = this.duration;
        if (!d) return;
        for (const n of this.notes) this.noteMarkers.push(this.ctx.addSeekBarMarker(Math.min(1, n.time / d), 'hp-course-note-marker', n.text || formatTime(n.time)));
    }

    // ── Notlar ──

    toggleNotes(force?: boolean): void {
        const open = force ?? !this.panel;
        if (open) this.openNotes();
        else this.closeNotes();
    }

    addNote(text: string, time = this.ctx.videoEl.currentTime): CourseNote {
        const note: CourseNote = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, time: Math.max(0, time), text: text.slice(0, 500) };
        this.notes = [...this.notes, note].sort((a, b) => a.time - b.time);
        this.saveNow();
        this.renderNoteMarkers();
        this.renderNoteList();
        this.emit('note');
        return note;
    }

    removeNote(id: string): void {
        this.notes = this.notes.filter((n) => n.id !== id);
        this.saveNow();
        this.renderNoteMarkers();
        this.renderNoteList();
        this.emit('note');
    }

    private list: HTMLElement | null = null;

    private openNotes(): void {
        if (this.panel || this.options.notes === false) return;
        const t = this.ctx.i18n;
        const panel = document.createElement('div');
        panel.className = 'hp-course-notes';
        panel.setAttribute('part', 'course-notes');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', t.courseNotes);

        const head = document.createElement('div');
        head.className = 'hp-course-head';
        const h = document.createElement('span');
        h.textContent = t.courseNotes;
        const progress = document.createElement('small');
        progress.textContent = t.courseProgress(Math.round(this.getProgress().percent));
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'hp-course-icon';
        close.setAttribute('aria-label', t.close);
        close.appendChild(createIcon('close'));
        close.addEventListener('click', () => this.closeNotes());
        head.append(h, progress, close);

        const form = document.createElement('form');
        form.className = 'hp-course-form';
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 500;
        input.placeholder = t.courseNotePlaceholder;
        input.setAttribute('aria-label', t.courseNotePlaceholder);
        const add = document.createElement('button');
        add.type = 'submit';
        add.textContent = t.courseAddNote;
        form.append(input, add);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            this.addNote(text);
        });

        const list = document.createElement('ol');
        list.className = 'hp-course-list';
        panel.append(head, form, list);
        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) panel.addEventListener(ev, (e) => e.stopPropagation());
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeNotes();
                this.button?.focus();
            }
            e.stopPropagation();
        });
        this.ctx.overlayEl.appendChild(panel);
        this.panel = panel;
        this.list = list;
        this.renderNoteList();
        this.ctx.holdChrome(true);
        this.button?.setAttribute('aria-expanded', 'true');
        input.focus({ preventScroll: true });
    }

    private closeNotes(): void {
        if (!this.panel) return;
        this.panel.remove();
        this.panel = null;
        this.list = null;
        this.ctx.holdChrome(false);
        this.button?.setAttribute('aria-expanded', 'false');
    }

    private renderNoteList(): void {
        const list = this.list;
        if (!list) return;
        const t = this.ctx.i18n;
        if (!this.notes.length) {
            const empty = document.createElement('li');
            empty.className = 'hp-course-empty';
            empty.textContent = t.courseNoNotes;
            list.replaceChildren(empty);
            return;
        }
        list.replaceChildren(
            ...this.notes.map((n) => {
                const li = document.createElement('li');
                const time = document.createElement('button');
                time.type = 'button';
                time.className = 'hp-course-time';
                time.textContent = formatTime(n.time);
                time.addEventListener('click', () => {
                    this.ctx.videoEl.currentTime = n.time;
                });
                const text = document.createElement('span');
                text.textContent = n.text;
                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'hp-course-icon';
                del.setAttribute('aria-label', t.courseDeleteNote);
                del.appendChild(createIcon('close'));
                del.addEventListener('click', () => this.removeNote(n.id));
                li.append(time, text, del);
                return li;
            })
        );
    }
}
