import { createIcon } from '../icons/Icon';
import type { HopeLocaleStrings } from '../i18n/types';

/** video 'error' olayında görünür; "Tekrar Dene" video.load()'u tetikler. */
export class ErrorScreen {
    readonly el: HTMLDivElement;
    private readonly video: HTMLVideoElement;
    private readonly labels: HopeLocaleStrings;
    private readonly messageEl: HTMLParagraphElement;
    private readonly retryBtn: HTMLButtonElement;
    private onRetry: (() => void) | null = null;

    constructor(video: HTMLVideoElement, labels: HopeLocaleStrings) {
        this.video = video;
        this.labels = labels;

        this.el = document.createElement('div');
        this.el.className =
            'hp:absolute hp:inset-0 hp:hidden hp:flex-col hp:items-center hp:justify-center hp:gap-3 hp:bg-surface/95 hp:text-on-surface hp:text-sm hp:text-center hp:px-6';

        this.el.appendChild(createIcon('warning', 'hp:text-3xl hp:text-accent'));

        this.messageEl = document.createElement('p');
        this.el.appendChild(this.messageEl);

        this.retryBtn = document.createElement('button');
        this.retryBtn.type = 'button';
        this.retryBtn.textContent = labels.retry;
        this.retryBtn.className =
            'hp:px-4 hp:py-1.5 hp:rounded-md hp:bg-accent hp:text-on-accent hp:text-xs hp:font-medium hp:border-0 hp:cursor-pointer';
        this.retryBtn.addEventListener('click', () => {
            this.hide();
            this.onRetry?.();
        });
        this.el.appendChild(this.retryBtn);

        video.addEventListener('error', this.show);
    }

    setOnRetry(fn: () => void): void {
        this.onRetry = fn;
    }

    refreshLabels(): void {
        this.retryBtn.textContent = this.labels.retry;
        if (!this.el.classList.contains('hp:hidden')) this.show();
    }

    private readonly show = (): void => {
        const code = this.video.error?.code ?? 0;
        const messages: Record<number, string> = {
            1: this.labels.errorAborted,
            2: this.labels.errorNetwork,
            3: this.labels.errorDecode,
            4: this.labels.errorSrcNotSupported,
        };
        this.messageEl.textContent = messages[code] ?? this.labels.errorGeneric;
        this.el.classList.remove('hp:hidden');
        this.el.classList.add('hp:flex');
    };

    private hide(): void {
        this.el.classList.add('hp:hidden');
        this.el.classList.remove('hp:flex');
    }

    destroy(): void {
        this.video.removeEventListener('error', this.show);
    }
}
