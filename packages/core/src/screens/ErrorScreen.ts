import { createIcon } from '../icons/Icon';
import type { HopeLocaleStrings } from '../i18n/types';

const RETRY_ICON =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

/**
 * Video 'error' olayında görünen minimal hata ekranı (stiller tailwind.css `.hp-error-*`).
 * Video alanına chrome'un (z-20) üstünde monte edilir — merkez play butonu ve kontroller üstüne binmesin.
 */
export class ErrorScreen {
    readonly el: HTMLDivElement;
    private readonly video: HTMLVideoElement;
    private readonly labels: HopeLocaleStrings;
    private readonly messageEl: HTMLParagraphElement;
    private readonly codeEl: HTMLParagraphElement;
    private readonly retryBtn: HTMLButtonElement;
    private readonly retryText: HTMLSpanElement;
    private onRetry: (() => void) | null = null;
    private shouldShow: () => boolean = () => true;

    constructor(video: HTMLVideoElement, labels: HopeLocaleStrings) {
        this.video = video;
        this.labels = labels;

        this.el = document.createElement('div');
        this.el.setAttribute('part', 'error-screen');
        this.el.setAttribute('role', 'alert');
        this.el.className = 'hp-error-screen';

        const card = document.createElement('div');
        card.className = 'hp-error-card';

        const icon = document.createElement('div');
        icon.className = 'hp-error-icon';
        icon.appendChild(createIcon('warning'));
        card.appendChild(icon);

        this.messageEl = document.createElement('p');
        this.messageEl.className = 'hp-error-message';
        card.appendChild(this.messageEl);

        this.codeEl = document.createElement('p');
        this.codeEl.className = 'hp-error-code';
        card.appendChild(this.codeEl);

        this.retryBtn = document.createElement('button');
        this.retryBtn.type = 'button';
        this.retryBtn.className = 'hp-error-retry';
        this.retryBtn.innerHTML = RETRY_ICON;
        this.retryText = document.createElement('span');
        this.retryText.textContent = labels.retry;
        this.retryBtn.appendChild(this.retryText);
        this.retryBtn.addEventListener('click', () => {
            this.hide();
            this.onRetry?.();
        });
        card.appendChild(this.retryBtn);

        this.el.appendChild(card);
        video.addEventListener('error', this.show);
    }

    setOnRetry(fn: () => void): void {
        this.onRetry = fn;
    }

    /** false dönerse hata gösterilmez (ör. SourceManager native HLS'ten hls.js'e geçerken). */
    setShouldShow(fn: () => boolean): void {
        this.shouldShow = fn;
    }

    get visible(): boolean {
        return this.el.hasAttribute('data-visible');
    }

    refreshLabels(): void {
        this.retryText.textContent = this.labels.retry;
        if (this.visible) this.render();
    }

    private readonly show = (): void => {
        // Kaynak yokken gelen hata (kaynak değişimi/temizliği sırasında) kullanıcıya gösterilmez —
        // Safari/iOS bu durumda kod 4 üretebiliyor.
        if (!this.video.getAttribute('src') && !this.video.querySelector('source')) return;
        if (!this.shouldShow()) return;
        this.render();
        this.el.setAttribute('data-visible', '');
    };

    private render(): void {
        const code = this.video.error?.code ?? 0;
        const messages: Record<number, string> = {
            1: this.labels.errorAborted,
            2: this.labels.errorNetwork,
            3: this.labels.errorDecode,
            4: this.labels.errorSrcNotSupported,
        };
        this.messageEl.textContent = messages[code] ?? this.labels.errorGeneric;
        this.codeEl.textContent = code ? `${this.labels.errorCode} ${code}` : '';
        this.codeEl.style.display = code ? '' : 'none';
    }

    private hide(): void {
        this.el.removeAttribute('data-visible');
    }

    destroy(): void {
        this.video.removeEventListener('error', this.show);
    }
}
