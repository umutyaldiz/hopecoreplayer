import type { HopeLocaleStrings } from '../../i18n/types';
import type { ErrorLog, PlayerLogEntry, PlayerLogSource } from '../../debug/ErrorLog';

export interface DebugPanelContext {
    containerEl: HTMLElement;
    i18n: HopeLocaleStrings;
    log: ErrorLog;
    version: string;
}

const CLOSE_ICON =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/**
 * Sağ tık menüsündeki "Hata ayıklama" — player'ın tüm hatalarını (medya, yayın, reklam, altyazı) zaman sırasıyla,
 * ayrıntılarıyla gösteren ve tüm player alanını kaplayan pencere. Uzun satırlar (URL'ler) kırılır, liste kendi içinde
 * kayar; yeni hata gelince açık pencere canlı güncellenir.
 */
export class DebugPanel {
    private readonly el: HTMLDivElement;
    private readonly titleEl: HTMLSpanElement;
    private readonly countEl: HTMLSpanElement;
    private readonly copyBtn: HTMLButtonElement;
    private readonly clearBtn: HTMLButtonElement;
    private readonly closeBtn: HTMLButtonElement;
    private readonly list: HTMLOListElement;
    private readonly emptyEl: HTMLParagraphElement;
    private copiedTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly ctx: DebugPanelContext) {
        this.el = document.createElement('div');
        this.el.className = 'hp-debug';
        this.el.setAttribute('part', 'debug-panel');
        this.el.setAttribute('role', 'dialog');
        // Odak pencerenin kendisinde (ESC ile kapanır) — butona odaklanınca ipucu kendiliğinden açılıyordu.
        this.el.tabIndex = -1;

        const header = document.createElement('div');
        header.className = 'hp-debug-header';
        const title = document.createElement('div');
        title.className = 'hp-debug-title';
        this.titleEl = document.createElement('span');
        this.countEl = document.createElement('span');
        this.countEl.className = 'hp-debug-count';
        title.append(this.titleEl, this.countEl);

        const actions = document.createElement('div');
        actions.className = 'hp-debug-actions';
        this.copyBtn = this.button('hp-debug-btn', () => void this.copy());
        this.clearBtn = this.button('hp-debug-btn', () => this.ctx.log.clear());
        this.closeBtn = this.button('hp-stats-close', () => this.hide());
        this.closeBtn.innerHTML = CLOSE_ICON;
        actions.append(this.copyBtn, this.clearBtn, this.closeBtn);
        header.append(title, actions);

        this.list = document.createElement('ol');
        this.list.className = 'hp-debug-list';
        this.emptyEl = document.createElement('p');
        this.emptyEl.className = 'hp-debug-empty';

        this.el.append(header, this.list, this.emptyEl);
        // Panel tıklamaları / kaydırma videoyu oynat-duraklat yapmasın, klavye kısayolları tetiklenmesin.
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.el.addEventListener('click', (e) => e.stopPropagation());
        this.el.addEventListener('dblclick', (e) => e.stopPropagation());
        this.el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.hide();
            e.stopPropagation();
        });
        this.refreshLabels();
    }

    get isVisible(): boolean {
        return this.el.isConnected;
    }

    show(): void {
        if (!this.isVisible) this.ctx.containerEl.appendChild(this.el);
        this.ctx.log.onChange = () => this.render();
        this.render();
        this.el.focus({ preventScroll: true });
    }

    hide(): void {
        if (this.ctx.log.onChange) this.ctx.log.onChange = null;
        this.el.remove();
    }

    refreshLabels(): void {
        const t = this.ctx.i18n;
        this.titleEl.textContent = t.debugTitle;
        this.copyBtn.textContent = t.debugCopy;
        this.clearBtn.textContent = t.debugClear;
        this.closeBtn.setAttribute('aria-label', t.debugClose);
        this.emptyEl.textContent = t.debugEmpty;
        if (this.isVisible) this.render();
    }

    destroy(): void {
        if (this.copiedTimer) clearTimeout(this.copiedTimer);
        this.hide();
    }

    private button(className: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = className;
        btn.addEventListener('click', onClick);
        return btn;
    }

    private sourceLabel(source: PlayerLogSource): string {
        const t = this.ctx.i18n;
        return { media: t.debugSourceMedia, stream: t.debugSourceStream, ads: t.debugSourceAds, subtitles: t.debugSourceSubtitles, player: t.debugSourcePlayer }[source];
    }

    private render(): void {
        const entries = this.ctx.log.entries;
        this.countEl.textContent = entries.length ? String(entries.length) : '';
        this.emptyEl.hidden = entries.length > 0;
        this.clearBtn.disabled = entries.length === 0;
        this.copyBtn.disabled = entries.length === 0;
        // En yeni en üstte.
        this.list.replaceChildren(...[...entries].reverse().map((e) => this.row(e)));
    }

    private row(entry: PlayerLogEntry): HTMLLIElement {
        const li = document.createElement('li');
        li.className = 'hp-debug-row';
        if (entry.fatal) li.setAttribute('data-fatal', '');

        const head = document.createElement('div');
        head.className = 'hp-debug-row-head';
        const time = document.createElement('time');
        time.className = 'hp-debug-time';
        const d = new Date(entry.time);
        time.textContent = `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
        const source = document.createElement('span');
        source.className = 'hp-debug-source';
        source.setAttribute('data-source', entry.source);
        source.textContent = this.sourceLabel(entry.source);
        head.append(time, source);
        if (entry.fatal) {
            const fatal = document.createElement('span');
            fatal.className = 'hp-debug-fatal';
            fatal.textContent = this.ctx.i18n.debugFatal;
            head.appendChild(fatal);
        }

        const message = document.createElement('div');
        message.className = 'hp-debug-message';
        message.textContent = entry.message;
        if (entry.count && entry.count > 1) {
            const repeat = document.createElement('span');
            repeat.className = 'hp-debug-repeat';
            repeat.textContent = ` ×${entry.count}`;
            message.appendChild(repeat);
        }
        li.append(head, message);

        const details = Object.entries(entry.details ?? {}).filter(([, v]) => v !== undefined && v !== '');
        if (details.length) {
            const dl = document.createElement('dl');
            dl.className = 'hp-debug-details';
            for (const [k, v] of details) {
                const dt = document.createElement('dt');
                dt.textContent = k;
                const dd = document.createElement('dd');
                dd.textContent = String(v);
                dl.append(dt, dd);
            }
            li.appendChild(dl);
        }
        return li;
    }

    private async copy(): Promise<void> {
        const text = `HopeCorePlayer ${this.ctx.version} · ${navigator.userAgent}\n${this.ctx.log.toText()}`;
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            return;
        }
        this.copyBtn.textContent = this.ctx.i18n.debugCopied;
        if (this.copiedTimer) clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => {
            this.copiedTimer = null;
            this.copyBtn.textContent = this.ctx.i18n.debugCopy;
        }, 1500);
    }
}
