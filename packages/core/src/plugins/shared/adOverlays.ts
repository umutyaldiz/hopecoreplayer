import css from './ad-overlays.css?inline';

/** Doğrusal reklam başladı / bitti: host'a `data-ad` — reklamın üstünde yalnızca kontrol çubuğu kalır. */
export function markLinearAd(hostEl: HTMLElement, shadowEl: Node, active: boolean): void {
    // adoptStyle burada elle: ortak yardımcı reklam parçasına ayrı bir istek eklerdi.
    const root = shadowEl.getRootNode() as ShadowRoot;
    if (active && 'host' in root && !root.querySelector('style[data-hp-style="ad-overlays"]')) {
        const style = document.createElement('style');
        style.setAttribute('data-hp-style', 'ad-overlays');
        style.textContent = css;
        root.appendChild(style);
    }
    hostEl.toggleAttribute('data-ad', active);
}
