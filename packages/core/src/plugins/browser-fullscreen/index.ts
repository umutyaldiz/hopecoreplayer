import { adoptStyle } from '../../utils/plugin-style';
import css from './browser-fullscreen.css?inline';

/** Fullscreen API'siz tam ekran: player CSS ile pencereyi kaplar; çıkış fonksiyonunu döner. */
export function enterBrowserFullscreen(host: HTMLElement, styleEl: Node, onExit: () => void): () => void {
    adoptStyle(styleEl, 'browser-fullscreen', css);
    const html = document.documentElement;
    const body = document.body;
    const saved = [html.style.overflow, body.style.overflow];
    html.style.overflow = body.style.overflow = 'hidden';
    host.setAttribute('data-hp-fullscreen', '');
    let active = true;
    const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') exit();
    };
    const exit = (): void => {
        if (!active) return;
        active = false;
        document.removeEventListener('keydown', onKey, true);
        html.style.overflow = saved[0]!;
        body.style.overflow = saved[1]!;
        host.removeAttribute('data-hp-fullscreen');
        onExit();
    };
    document.addEventListener('keydown', onKey, true);
    return exit;
}
