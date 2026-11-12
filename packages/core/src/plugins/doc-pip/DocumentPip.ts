import type { DocumentPipOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { createIcon } from '../../icons/Icon';
import { adoptStyle, copyAdoptedStyles } from '../../utils/plugin-style';
import css from './doc-pip.css?inline';

export interface DocumentPipContext {
    hostEl: HTMLElement;
    /** Taşınan katman: video + kontroller + reklam + eklentiler. */
    videoArea: HTMLElement;
    /** videoArea'nın shadow içindeki kabı (.hp-root) — yer tutucu buraya girer. */
    rootEl: HTMLElement;
    css: string;
    i18n: HopeLocaleStrings;
    /** Pencere açıldı / kapandı. */
    onChange(active: boolean, win: Window | null): void;
    /** PiP penceresindeki tuşu player'a ilet; işlendiyse true. */
    forwardKey(e: KeyboardEvent): boolean;
}

interface DocPipApi {
    requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean }): Promise<Window>;
    window: Window | null;
}

export function documentPipApi(): DocPipApi | null {
    return (window as unknown as { documentPictureInPicture?: DocPipApi }).documentPictureInPicture ?? null;
}

/**
 * Document Picture-in-Picture (Chrome / Edge 116+): oynatıcının video alanı — kontroller, altyazı, menüler, reklam
 * katmanı ve eklentiler — her zaman üstte duran ayrı bir pencereye taşınır. Pencere kapanınca (X, "geri al",
 * sayfadan ayrılma) yerine döner. Video elementi aynı kalır: oynatma, tampon ve reklam durumu kesilmez.
 */
export class DocumentPip {
    private win: Window | null = null;
    private placeholder: HTMLElement | null = null;

    private pipRoot: ShadowRoot | null = null;

    constructor(private readonly ctx: DocumentPipContext) {
        adoptStyle(ctx.rootEl, 'doc-pip', css);
    }

    get active(): boolean {
        return this.win !== null;
    }

    async open(options: DocumentPipOptions): Promise<boolean> {
        const api = documentPipApi();
        if (!api || this.win) return false;
        const rect = this.ctx.videoArea.getBoundingClientRect();
        const ratio = rect.width > 0 && rect.height > 0 ? rect.height / rect.width : 9 / 16;
        const width = Math.round(options.width ?? Math.min(Math.max(rect.width, 320), 640));
        const height = Math.round(options.height ?? width * ratio);
        const win = await api.requestWindow({ width, height });
        this.mount(win);
        return true;
    }

    close(): void {
        this.win?.close();
    }

    destroy(): void {
        if (this.win) {
            const win = this.win;
            this.restore();
            win.close();
        }
    }

    private mount(win: Window): void {
        const doc = win.document;
        const { hostEl, videoArea, rootEl } = this.ctx;
        doc.title = document.title;
        const base = doc.createElement('style');
        base.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden}';
        doc.head.appendChild(base);
        // İkon fontu belge başına enjekte edilir (Shadow DOM'da @font-face çalışmıyor).
        const iconFont = document.getElementById('hope-player-icon-font');
        if (iconFont) doc.head.appendChild(iconFont.cloneNode(true));

        const host = doc.createElement('div');
        host.className = 'hp-docpip';
        // Tema ve sayfadan gelen token'lar (`hope-player { --hp-color-accent: … }`) pencereye de geçsin.
        for (const { name, value } of Array.from(hostEl.attributes)) if (name.startsWith('data-')) host.setAttribute(name, value);
        const computed = getComputedStyle(hostEl);
        for (let i = 0; i < computed.length; i++) {
            const prop = computed[i]!;
            if (prop.startsWith('--hp-')) host.style.setProperty(prop, computed.getPropertyValue(prop));
        }
        host.style.fontFamily = computed.fontFamily;
        const shadow = host.attachShadow({ mode: 'open' });
        const style = doc.createElement('style');
        style.textContent = this.ctx.css;
        const wrap = doc.createElement('div');
        wrap.className = 'hp-root';
        shadow.append(style, wrap);
        // Eklentilerin sonradan eklenen stilleri (transkript, etkileşimli…) pencereye de.
        copyAdoptedStyles(hostEl.shadowRoot!, shadow);
        this.pipRoot = shadow;
        doc.body.appendChild(host);

        const placeholder = document.createElement('div');
        placeholder.className = 'hp-docpip-placeholder';
        placeholder.setAttribute('part', 'pip-placeholder');
        const text = document.createElement('span');
        text.textContent = this.ctx.i18n.pipPlaying;
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'hp-docpip-btn';
        back.append(createIcon('pip'), document.createTextNode(this.ctx.i18n.pipBack));
        back.addEventListener('click', () => this.close());
        placeholder.append(text, back);
        // Yer tutucu oynatıcının boyutunu korur — sayfa düzeni kaymasın.
        placeholder.style.aspectRatio = `${Math.max(1, videoArea.offsetWidth)} / ${Math.max(1, videoArea.offsetHeight)}`;

        // Taşıma tek adımda (appendChild) — video oynamaya devam eder.
        rootEl.insertBefore(placeholder, videoArea);
        wrap.appendChild(videoArea);
        videoArea.setAttribute('data-docpip', '');
        this.placeholder = placeholder;
        this.win = win;

        doc.addEventListener('keydown', (e) => {
            if (e.defaultPrevented) return;
            const t = e.composedPath()[0];
            // Odaktaki buton / alan tuşu kendisi işlesin.
            if (t instanceof Element && t.closest('input, textarea, select')) return;
            if ((e.key === ' ' || e.key === 'Enter') && t instanceof Element && t.closest('button')) return;
            if (this.ctx.forwardKey(e)) e.preventDefault();
        });
        win.addEventListener('pagehide', this.restore, { once: true });
        this.ctx.onChange(true, win);
    }

    private readonly restore = (): void => {
        const placeholder = this.placeholder;
        if (!placeholder) return;
        const { videoArea } = this.ctx;
        videoArea.removeAttribute('data-docpip');
        // Pencere açıkken kurulan eklentilerin stilleri sayfaya dönsün.
        if (this.pipRoot) copyAdoptedStyles(this.pipRoot, this.ctx.hostEl.shadowRoot!);
        this.pipRoot = null;
        placeholder.replaceWith(videoArea);
        this.placeholder = null;
        this.win = null;
        this.ctx.onChange(false, null);
    };
}
