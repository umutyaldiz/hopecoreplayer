import type { TranscriptOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { createIcon } from '../../icons/Icon';
import { formatTime } from '../../utils/format-time';
import { trackCues } from '../../subtitles/attachTracks';

export interface TranscriptPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    /** Altyazı menüsündeki izler (dosya + yayın). */
    getTracks(): { label: string; track: TextTrack }[];
    /** Seçili altyazının adı (kapalıysa null). */
    activeLabel(): string | null;
    addButton(label: string, iconName: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
}

interface Line {
    start: number;
    end: number;
    text: string;
    row: HTMLLIElement;
    textEl: HTMLSpanElement;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" };

/** VTT etiketlerini (<v Ad>, <b>, <c.renk>, zaman damgası) atar, satırları birleştirir. */
function cleanCueText(raw: string): string {
    return raw
        .replace(/<[^>]*>/g, '')
        .replace(/&(amp|lt|gt|nbsp|quot|#39);/g, (m) => ENTITIES[m] ?? m)
        .replace(/\s+/g, ' ')
        .trim();
}

/** Arama için harf/aksan duyarsız biçim (İ/ı dahil). */
function fold(s: string): string {
    return s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Transkript paneli: seçili (ya da `track`) altyazı izinin tüm satırları; tıklayınca o ana gider, oynayan satır
 * vurgulanır ve görünür tutulur, aranabilir. Dosyadan gelen altyazılar iz kapalıyken de okunur; yayın içi izler
 * (HLS / DASH) yalnızca açıkken dolar.
 */
export class Transcript {
    private readonly panel: HTMLElement;
    private readonly list: HTMLOListElement;
    private readonly status: HTMLParagraphElement;
    private readonly select: HTMLSelectElement;
    private readonly search: HTMLInputElement | null = null;
    private readonly titleEl: HTMLSpanElement;
    private readonly closeBtn: HTMLButtonElement;
    private button: HTMLButtonElement | null = null;
    private lines: Line[] = [];
    private activeIndex = -1;
    private sourceLabel: string | null = null;
    private sourceTrack: TextTrack | null = null;
    private cueCount = -1;
    private query = '';
    private open = false;
    private userScrollUntil = 0;
    private lastSync = 0;
    private readonly autoScroll: boolean;

    constructor(
        private readonly ctx: TranscriptPlayerContext,
        private readonly options: TranscriptOptions
    ) {
        this.autoScroll = options.autoScroll !== false;
        const panel = document.createElement('aside');
        panel.className = 'hp-transcript';
        panel.setAttribute('part', 'transcript');
        panel.setAttribute('data-position', options.position === 'left' ? 'left' : 'right');
        panel.hidden = true;

        const head = document.createElement('div');
        head.className = 'hp-transcript-head';
        this.titleEl = document.createElement('span');
        this.titleEl.className = 'hp-transcript-title';
        this.select = document.createElement('select');
        this.select.className = 'hp-transcript-select';
        this.select.addEventListener('change', () => {
            this.sourceLabel = this.select.value;
            this.load();
        });
        this.closeBtn = document.createElement('button');
        this.closeBtn.type = 'button';
        this.closeBtn.className = 'hp-transcript-close';
        this.closeBtn.appendChild(createIcon('close'));
        this.closeBtn.addEventListener('click', () => this.setOpen(false));
        head.append(this.titleEl, this.select, this.closeBtn);
        panel.appendChild(head);

        if (options.search !== false) {
            const search = document.createElement('input');
            search.type = 'search';
            search.className = 'hp-transcript-search';
            search.addEventListener('input', () => {
                this.query = search.value;
                this.applyFilter();
            });
            this.search = search;
            panel.appendChild(search);
        }

        this.list = document.createElement('ol');
        this.list.className = 'hp-transcript-list';
        // Kullanıcı kaydırırken otomatik kaydırma birkaç saniye durur.
        for (const ev of ['wheel', 'touchmove'] as const) {
            this.list.addEventListener(ev, () => (this.userScrollUntil = performance.now() + 4000), { passive: true });
        }
        this.status = document.createElement('p');
        this.status.className = 'hp-transcript-status';
        this.status.setAttribute('aria-live', 'polite');
        panel.append(this.list, this.status);

        // Panel içindeki tıklama / yazma oynatıcıya (oynat-duraklat, kısayollar) gitmesin.
        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) panel.addEventListener(ev, (e) => e.stopPropagation());
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.setOpen(false);
                this.button?.focus();
            }
            e.stopPropagation();
        });
        ctx.overlayEl.appendChild(panel);
        this.panel = panel;

        if (options.button !== false) {
            const { btn } = ctx.addButton(ctx.i18n.transcript, 'transcript', () => this.setOpen(!this.open));
            btn.classList.add('hp-transcript-btn');
            btn.setAttribute('aria-pressed', 'false');
            this.button = btn;
        }

        this.refreshLabels();
        ctx.videoEl.addEventListener('timeupdate', this.onTimeUpdate);
        ctx.videoEl.addEventListener('seeked', this.onTimeUpdate);
        ctx.videoEl.addEventListener('hp-internal:subtitle-loaded', this.onTracksChanged);
        ctx.hostEl.addEventListener('hp:adstart', this.onAd);
        ctx.hostEl.addEventListener('hp:adend', this.onAd);
        this.onTracksChanged();
        if (options.open) this.setOpen(true, false);
    }

    get isOpen(): boolean {
        return this.open;
    }

    setOpen(open: boolean, emit = true): void {
        if (open === this.open) return;
        this.open = open;
        this.panel.hidden = !open;
        this.button?.setAttribute('aria-pressed', String(open));
        this.ctx.overlayEl.toggleAttribute('data-transcript-open', open);
        if (open) {
            this.onTracksChanged();
            this.scrollToActive(true);
        }
        if (emit) this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:transcript', { detail: { state: open ? 'open' : 'close' } }));
    }

    /** Altyazı listesi / seçimi değişti — kaynak iz yeniden seçilir. */
    readonly onTracksChanged = (): void => {
        const tracks = this.ctx.getTracks();
        const prev = this.select.value;
        this.select.replaceChildren(
            ...tracks.map((t) => {
                const o = document.createElement('option');
                o.value = o.textContent = t.label;
                return o;
            })
        );
        this.select.hidden = tracks.length < 2;
        const want = this.options.track;
        const byOption = want ? tracks.find((t) => t.label === want || t.track.language === want) : undefined;
        const keep = this.sourceLabel ? tracks.find((t) => t.label === this.sourceLabel) : undefined;
        const active = this.ctx.activeLabel();
        const pick = keep ?? (active ? tracks.find((t) => t.label === active) : undefined) ?? byOption ?? tracks[0];
        if (pick) this.select.value = pick.label;
        if (pick?.track !== this.sourceTrack || prev !== this.select.value || this.cueCount < 0) this.load();
        else this.syncCues();
    };

    refreshLabels(): void {
        const i18n = this.ctx.i18n;
        this.titleEl.textContent = i18n.transcript;
        this.panel.setAttribute('aria-label', i18n.transcript);
        this.select.setAttribute('aria-label', i18n.transcriptTrack);
        this.closeBtn.setAttribute('aria-label', i18n.transcriptClose);
        if (this.search) {
            this.search.placeholder = i18n.transcriptSearch;
            this.search.setAttribute('aria-label', i18n.transcriptSearch);
        }
        this.button?.setAttribute('aria-label', i18n.transcript);
        this.updateStatus();
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        v.removeEventListener('timeupdate', this.onTimeUpdate);
        v.removeEventListener('seeked', this.onTimeUpdate);
        v.removeEventListener('hp-internal:subtitle-loaded', this.onTracksChanged);
        this.ctx.hostEl.removeEventListener('hp:adstart', this.onAd);
        this.ctx.hostEl.removeEventListener('hp:adend', this.onAd);
        this.ctx.overlayEl.removeAttribute('data-transcript-open');
        this.panel.remove();
        this.button?.remove();
    }

    private readonly onAd = (e: Event): void => {
        this.panel.toggleAttribute('data-ad', e.type === 'hp:adstart');
    };

    /** Seçili izin cue'larını baştan kurar. */
    private load(): void {
        const label = this.select.value || null;
        this.sourceTrack = this.ctx.getTracks().find((t) => t.label === label)?.track ?? null;
        this.cueCount = -1;
        this.syncCues();
    }

    /** Cue sayısı değiştiyse (yayın izi parça parça dolar) satırları yeniden çizer. */
    private syncCues(): void {
        const cues = this.sourceTrack ? trackCues(this.sourceTrack) : null;
        const count = cues?.length ?? 0;
        if (count === this.cueCount) return;
        this.cueCount = count;
        const sorted = (cues ?? []).slice().sort((a, b) => a.start - b.start);
        const lines: Line[] = [];
        for (const c of sorted) {
            const text = cleanCueText(c.text);
            if (!text) continue;
            // Kayan (roll-up) altyazılarda aynı satır art arda tekrar eder — birleştir.
            const last = lines[lines.length - 1];
            if (last && last.text === text) {
                last.end = Math.max(last.end, c.end);
                continue;
            }
            lines.push(this.buildLine(c.start, c.end, text));
        }
        this.lines = lines;
        this.activeIndex = -1;
        this.list.replaceChildren(...lines.map((l) => l.row));
        this.applyFilter();
        this.onTimeUpdate();
    }

    private buildLine(start: number, end: number, text: string): Line {
        const row = document.createElement('li');
        row.className = 'hp-transcript-line';
        const btn = document.createElement('button');
        btn.type = 'button';
        const time = document.createElement('span');
        time.className = 'hp-transcript-time';
        time.textContent = formatTime(start);
        const textEl = document.createElement('span');
        textEl.className = 'hp-transcript-text';
        textEl.textContent = text;
        btn.append(time, textEl);
        btn.addEventListener('click', () => {
            const v = this.ctx.videoEl;
            v.currentTime = start;
            this.userScrollUntil = 0;
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:transcript', { detail: { state: 'seek', time: start } }));
        });
        row.appendChild(btn);
        return { start, end, text, row, textEl };
    }

    private readonly onTimeUpdate = (): void => {
        // Yayın izleri oynarken dolar — saniyede bir bakılır.
        const now = performance.now();
        if (this.sourceTrack && this.cueCount >= 0 && now - this.lastSync > 1000) {
            this.lastSync = now;
            this.syncCues();
        }
        const t = this.ctx.videoEl.currentTime;
        let index = -1;
        for (let i = 0; i < this.lines.length; i++) {
            if (this.lines[i]!.start > t) break;
            index = i;
        }
        // Satırlar arası boşlukta son satır vurgulu kalır; satırın bitişinden 3 sn sonra söner.
        if (index >= 0 && t > this.lines[index]!.end + 3) index = -1;
        if (index === this.activeIndex) return;
        if (this.activeIndex >= 0) {
            const prev = this.lines[this.activeIndex]?.row;
            prev?.removeAttribute('data-active');
            prev?.firstElementChild?.removeAttribute('aria-current');
        }
        this.activeIndex = index;
        const row = this.lines[index]?.row;
        row?.setAttribute('data-active', '');
        row?.firstElementChild?.setAttribute('aria-current', 'true');
        this.scrollToActive(false);
    };

    private scrollToActive(force: boolean): void {
        if (!this.open || (!force && (!this.autoScroll || performance.now() < this.userScrollUntil))) return;
        const row = this.lines[this.activeIndex]?.row;
        if (!row || row.hidden) return;
        // scrollIntoView sayfayı da kaydırır — yalnızca listeyi kaydır.
        const list = this.list;
        const top = row.offsetTop - list.offsetTop;
        if (force || top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
            list.scrollTop = Math.max(0, top - list.clientHeight / 3);
        }
    }

    /** Arama: eşleşmeyen satırlar gizlenir, eşleşen kısım <mark> ile vurgulanır. */
    private applyFilter(): void {
        const q = fold(this.query.trim());
        let shown = 0;
        for (const line of this.lines) {
            if (!q) {
                line.row.hidden = false;
                line.textEl.textContent = line.text;
                shown++;
                continue;
            }
            const at = fold(line.text).indexOf(q);
            line.row.hidden = at < 0;
            if (at < 0) continue;
            shown++;
            // fold() uzunluğu değiştirmeyen harflerde konum aynıdır; değiştiyse vurgusuz göster.
            if (fold(line.text).length !== line.text.length) {
                line.textEl.textContent = line.text;
                continue;
            }
            const mark = document.createElement('mark');
            mark.textContent = line.text.slice(at, at + q.length);
            line.textEl.replaceChildren(line.text.slice(0, at), mark, line.text.slice(at + q.length));
        }
        this.updateStatus(shown);
    }

    private updateStatus(shown = this.lines.filter((l) => !l.row.hidden).length): void {
        const i18n = this.ctx.i18n;
        let msg = '';
        if (!this.ctx.getTracks().length) msg = i18n.transcriptEmpty;
        else if (!this.lines.length) msg = i18n.transcriptWaiting;
        else if (!shown) msg = i18n.transcriptNoResults;
        this.status.textContent = msg;
        this.status.hidden = !msg;
    }
}
