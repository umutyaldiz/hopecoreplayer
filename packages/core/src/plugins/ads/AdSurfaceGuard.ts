/**
 * Reklamın görünmeyeceği yüzeyler: iPhone'un yerleşik (native) video tam ekranı ve Picture-in-Picture.
 * Bu ikisinde yalnızca içerik <video>'su görünür; IMA reklamı sayfadaki kendi video elementinde oynatır —
 * reklam görünmez, tıklanamaz, gösterim "görülmedi" sayılır. Lineer reklam arası başlarken yüzeyden çıkılır,
 * reklam bitince bir dokunuşla geri dönmek için buton gösterilir (iOS tam ekrana kullanıcı dokunmadan girmeye izin vermez).
 */

type SurfaceKind = 'fullscreen' | 'pip';

type WebkitVideo = HTMLVideoElement & {
    webkitDisplayingFullscreen?: boolean;
    webkitExitFullscreen?: () => void;
    webkitPresentationMode?: string;
    webkitSetPresentationMode?: (mode: string) => void;
    webkitSupportsPresentationMode?: (mode: string) => boolean;
};

export interface AdSurfaceGuardContext {
    videoEl: HTMLVideoElement;
    /** "Tam ekrana dön" butonunun ekleneceği alan (video alanı). */
    containerEl: HTMLElement;
    /** Player'ın tam ekran isteği (iPhone'da <video>'nun native tam ekranına düşer). */
    enterFullscreen(): void;
    labels(): { adReturnFullscreen: string; adReturnPip: string };
}

/** Geri dön butonunun ekranda kalma süresi. */
const RETURN_BUTTON_MS = 8000;

export class AdSurfaceGuard {
    /** Reklam yüzünden çıkılan yüzey — reklam bitince geri dönüş butonu için. */
    private exited: SurfaceKind | null = null;
    private button: HTMLButtonElement | null = null;
    private hideTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly ctx: AdSurfaceGuardContext) {}

    private get video(): WebkitVideo {
        return this.ctx.videoEl as WebkitVideo;
    }

    /** Şu an reklamın görünmeyeceği bir yüzeyde miyiz? */
    current(): SurfaceKind | null {
        const v = this.video;
        if (v.webkitDisplayingFullscreen) return 'fullscreen';
        if (document.pictureInPictureElement === v || v.webkitPresentationMode === 'picture-in-picture') return 'pip';
        return null;
    }

    /** Lineer reklam arası başlıyor: görünmeyen yüzeyden çık (içerik zaten duraklatıldı). */
    onBreakStart(): void {
        this.hideButton();
        const kind = this.current();
        if (!kind) return;
        this.exited = kind;
        const v = this.video;
        try {
            if (kind === 'fullscreen') v.webkitExitFullscreen?.();
            else if (document.pictureInPictureElement === v) void document.exitPictureInPicture().catch(() => {});
            else v.webkitSetPresentationMode?.('inline');
        } catch {
            /* yüzey kendiliğinden kapanmış olabilir */
        }
    }

    /** Lineer reklam arası bitti. Postroll'dan sonra içerik bitmiştir — geri dönüş önerilmez. */
    onBreakEnd(contentContinues: boolean): void {
        const kind = this.exited;
        this.exited = null;
        if (kind && contentContinues) this.showButton(kind);
    }

    private showButton(kind: SurfaceKind): void {
        this.hideButton();
        const labels = this.ctx.labels();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hp-ad-return';
        btn.setAttribute('part', 'ad-return');
        btn.textContent = kind === 'fullscreen' ? labels.adReturnFullscreen : labels.adReturnPip;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideButton();
            // Kullanıcı dokunuşu içinde — iOS bu yüzden izin verir.
            if (kind === 'fullscreen') this.ctx.enterFullscreen();
            else this.enterPip();
        });
        // Video alanının tıklama/dokunma işleyicilerine (oynat/duraklat) düşmesin.
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.ctx.containerEl.appendChild(btn);
        this.button = btn;
        this.hideTimer = setTimeout(() => this.hideButton(), RETURN_BUTTON_MS);
    }

    private enterPip(): void {
        const v = this.video;
        if (v.requestPictureInPicture && document.pictureInPictureEnabled) {
            void v.requestPictureInPicture().catch(() => {});
        } else if (v.webkitSupportsPresentationMode?.('picture-in-picture')) {
            v.webkitSetPresentationMode?.('picture-in-picture');
        }
    }

    hideButton(): void {
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = null;
        this.button?.remove();
        this.button = null;
    }

    destroy(): void {
        this.hideButton();
        this.exited = null;
    }
}
