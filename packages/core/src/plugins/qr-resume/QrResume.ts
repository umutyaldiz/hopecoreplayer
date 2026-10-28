import type { QrResumeOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { buildQrSvg } from './qrSvg';

export interface QrResumePlayerContext {
    videoEl: HTMLVideoElement;
    overlayContainerEl: HTMLElement;
    i18n: HopeLocaleStrings;
}

const STORAGE_KEY = 'hope-qr-resume-dismissed';

/** Yeterince izlenmiş bir noktada duraklatılınca "telefonundan devam et" QR kodu. */
export class QrResume {
    private wrapper: HTMLElement | null = null;
    private seeking = false;
    private seekTimeout: ReturnType<typeof setTimeout> | null = null;
    private pauseTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly paramName: string;

    constructor(
        private readonly ctx: QrResumePlayerContext,
        private readonly options: QrResumeOptions
    ) {
        this.paramName = options.paramName ?? 'vtime';

        this.applyResumeFromUrl();

        ctx.videoEl.addEventListener('play', this.onPlay);
        ctx.videoEl.addEventListener('ended', this.onPlay);
        ctx.videoEl.addEventListener('seeking', this.onSeeking);
        ctx.videoEl.addEventListener('seeked', this.onSeeked);
        ctx.videoEl.addEventListener('pause', this.onPause);
    }

    /** Dışarıdan (ör. entegratörün kendi "telefonuna gönder" butonu, ya da docs demo'sundaki test butonu) manuel olarak göstermek için — "kaldığın yerden devam et" otomatik tetiklenme kuralları (minElapsed/minRemaining) BURADA uygulanmaz, çağıran taraf bilinçli olarak gösteriyor demektir. */
    show(): void {
        this.create();
    }

    hide(): void {
        this.remove();
    }

    /** Ayarlar menüsündeki aç/kapa satırı — "Bir daha gösterme" sonrası tekrar açılabilsin. */
    isEnabled(): boolean {
        return !this.isDismissedForever();
    }

    setEnabled(enabled: boolean): void {
        this.setDismissedForever(!enabled);
    }

    /** Ekran her gösterimde sıfırdan oluşturuluyor ve güncel `ctx.i18n`'i okuyor — RedirectScreen'deki AYNI desen. */
    refreshLabels(): void {
        /* no-op */
    }

    destroy(): void {
        this.ctx.videoEl.removeEventListener('play', this.onPlay);
        this.ctx.videoEl.removeEventListener('ended', this.onPlay);
        this.ctx.videoEl.removeEventListener('seeking', this.onSeeking);
        this.ctx.videoEl.removeEventListener('seeked', this.onSeeked);
        this.ctx.videoEl.removeEventListener('pause', this.onPause);
        if (this.seekTimeout) clearTimeout(this.seekTimeout);
        if (this.pauseTimeout) clearTimeout(this.pauseTimeout);
        this.remove();
    }

    private isDismissedForever(): boolean {
        if (this.options.rememberDismiss === false) return false;
        try {
            return window.localStorage.getItem(STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    }

    private setDismissedForever(value: boolean): void {
        try {
            window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
        } catch {
            /* gizli mod vb. — sessizce yoksay */
        }
    }

    private buildResumeUrl(time: number): string {
        const url = new URL(window.location.href);
        url.searchParams.set(this.paramName, String(Math.floor(time)));
        return url.toString();
    }

    private applyResumeFromUrl(): void {
        const url = new URL(window.location.href);
        const raw = url.searchParams.get(this.paramName);
        if (raw === null || !/^\d+$/.test(raw)) return;

        const seconds = Number(raw);
        const seekOnceReady = () => {
            this.ctx.videoEl.currentTime = seconds;
        };
        if (this.ctx.videoEl.readyState >= 1) seekOnceReady();
        else this.ctx.videoEl.addEventListener('loadedmetadata', seekOnceReady, { once: true });

        url.searchParams.delete(this.paramName);
        window.history.replaceState(window.history.state, '', url.toString());
    }

    private readonly onPlay = (): void => this.remove();

    private readonly onSeeking = (): void => {
        this.seeking = true;
        if (this.seekTimeout) clearTimeout(this.seekTimeout);
        this.seekTimeout = setTimeout(() => {
            this.seeking = false;
        }, 150);
    };

    private readonly onSeeked = (): void => {
        if (this.seekTimeout) clearTimeout(this.seekTimeout);
        this.seeking = false;
    };

    private readonly onPause = (): void => {
        if (this.isDismissedForever()) return;
        const { currentTime, duration } = this.ctx.videoEl;
        const minElapsed = this.options.minElapsed ?? 60;
        const minRemaining = this.options.minRemaining ?? 60;
        if (!(duration - currentTime > minRemaining && currentTime > minElapsed)) return;

        // Eski koddaki AYNI kısa gecikme — 'seeking' sırasında da anlık bir
        // 'pause' tetiklenebiliyor (scrub), bu ekranın yanlışlıkla
        // belirmesini önlüyor.
        if (this.pauseTimeout) clearTimeout(this.pauseTimeout);
        this.pauseTimeout = setTimeout(() => {
            if (!this.seeking && this.ctx.videoEl.paused) this.create();
        }, 150);
    };

    private remove(): void {
        this.wrapper?.remove();
        this.wrapper = null;
    }

    private create(): void {
        this.remove();
        const size = this.options.size ?? 220;
        const url = this.buildResumeUrl(this.ctx.videoEl.currentTime);

        const wrapper = document.createElement('div');
        wrapper.setAttribute('part', 'qr-resume-screen');
        wrapper.className =
            'hp:absolute hp:inset-0 hp:z-30 hp:flex hp:flex-col hp:items-center hp:justify-center hp:gap-3 hp:bg-black/85 hp:text-white hp:text-center hp:p-4';

        const codeWrap = document.createElement('div');
        codeWrap.className = 'hp:rounded-lg hp:overflow-hidden hp:shadow-lg hp:leading-none';
        codeWrap.appendChild(buildQrSvg(url, { size, logoUrl: this.options.logo, logoScale: this.options.logoScale ?? 0.22 }));
        wrapper.appendChild(codeWrap);

        const text = document.createElement('div');
        text.className = 'hp:text-sm hp:opacity-90 hp:max-w-xs';
        text.textContent = this.ctx.i18n.qrResumeTitle;
        wrapper.appendChild(text);

        const buttons = document.createElement('div');
        buttons.className = 'hp:flex hp:gap-2 hp:mt-1';

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.textContent = this.ctx.i18n.qrResumeDontShowAgain;
        dismissBtn.className = 'hp:px-4 hp:py-1.5 hp:rounded hp:bg-white/15 hp:text-white hp:border-0 hp:cursor-pointer hp:text-sm';
        dismissBtn.addEventListener('click', () => {
            this.setDismissedForever(true);
            this.remove();
        });

        const continueBtn = document.createElement('button');
        continueBtn.type = 'button';
        continueBtn.textContent = this.ctx.i18n.qrResumeContinue;
        continueBtn.className = 'hp:px-4 hp:py-1.5 hp:rounded hp:bg-accent hp:text-on-accent hp:border-0 hp:cursor-pointer hp:text-sm';
        continueBtn.addEventListener('click', () => {
            this.remove();
            if (this.ctx.videoEl.paused) void this.ctx.videoEl.play();
        });

        buttons.append(dismissBtn, continueBtn);
        wrapper.appendChild(buttons);

        this.ctx.overlayContainerEl.appendChild(wrapper);
        this.wrapper = wrapper;
    }
}
