import iconFontFaceCss from '../theme/icons/hope-icons-font-face.css?inline';

const STYLE_ID = 'hope-player-icon-font';

/** @font-face Shadow DOM içinde uygulanmadığı için (crbug.com/41085401) document.head'e bir kez enjekte edilir. */
export function injectIconFont(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = iconFontFaceCss;
    document.head.appendChild(style);
}
