import { adoptStyle } from '../../utils/plugin-style';
import css from './ad-overlays.css?inline';

/** Doğrusal reklam başladı / bitti: host'a `data-ad` — reklamın üstünde yalnızca kontrol çubuğu kalır. */
export function markLinearAd(hostEl: HTMLElement, shadowEl: Node, active: boolean): void {
    if (active) adoptStyle(shadowEl, 'ad-overlays', css);
    hostEl.toggleAttribute('data-ad', active);
}
