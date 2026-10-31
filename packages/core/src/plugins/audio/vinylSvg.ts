/**
 * Plak ve pikap kolu — elle çizilmiş SVG (dış görsel yok). Disk döner; ışık yansıması ayrı bir katmanda sabit kalır,
 * böylece dönüş gerçek bir plaktaki gibi okunur. Oluklar tam simetrik olduğundan etikette dönüşü gösteren bir işaret var.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
let uid = 0;

function grooves(): string {
    let out = '';
    // Kayıt alanı r=40..95; iki şarkı arası boşluk gibi birkaç koyu halka.
    for (let r = 40; r <= 95; r += 1.25) {
        const gap = Math.abs(r - 58) < 0.7 || Math.abs(r - 74) < 0.7;
        const alpha = gap ? 0 : 0.035 + ((r * 7) % 5) * 0.008;
        out += `<circle cx="100" cy="100" r="${r}" fill="none" stroke="rgba(255,255,255,${alpha.toFixed(3)})" stroke-width="0.45"/>`;
    }
    return out;
}

/** Dönen disk: oluklar, etiket (kapak ya da düz renk), merkez deliği. */
export function createDisc(): { el: SVGSVGElement; setLabel(cover: string | null, text: string): void } {
    const id = `hp-vinyl-${++uid}`;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
<svg xmlns="${SVG_NS}" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="${id}-disc" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#1c1c1f"/>
      <stop offset="0.45" stop-color="#101012"/>
      <stop offset="0.97" stop-color="#151518"/>
      <stop offset="1" stop-color="#2a2a2e"/>
    </radialGradient>
    <clipPath id="${id}-label"><circle cx="100" cy="100" r="34"/></clipPath>
  </defs>
  <circle cx="100" cy="100" r="99.5" fill="url(#${id}-disc)"/>
  ${grooves()}
  <circle cx="100" cy="100" r="96.5" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="0.6"/>
  <circle cx="100" cy="100" r="38" fill="none" stroke="#050506" stroke-width="3"/>
  <g class="hp-vinyl-label">
    <circle cx="100" cy="100" r="34" fill="var(--hp-color-accent, #e5484d)"/>
    <image class="hp-vinyl-cover" x="66" y="66" width="68" height="68" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}-label)"/>
    <circle cx="100" cy="100" r="34" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
    <text class="hp-vinyl-text" x="100" y="80" text-anchor="middle" font-size="6.5" font-weight="700" fill="rgba(0,0,0,0.72)" font-family="system-ui, sans-serif"></text>
    <circle cx="100" cy="122" r="2.2" fill="rgba(255,255,255,0.85)"/>
  </g>
  <circle cx="100" cy="100" r="3.6" fill="#0b0b0c"/>
  <circle cx="100" cy="100" r="3.6" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.6"/>
</svg>`;
    const svg = wrap.firstElementChild as SVGSVGElement;
    const image = svg.querySelector('.hp-vinyl-cover') as SVGImageElement;
    const text = svg.querySelector('.hp-vinyl-text') as SVGTextElement;
    return {
        el: svg,
        setLabel(cover, label) {
            if (cover) {
                image.setAttribute('href', cover);
                image.style.display = '';
            } else {
                image.removeAttribute('href');
                image.style.display = 'none';
            }
            // Kapak varsa yazı kapağın üstüne binmesin.
            text.textContent = cover ? '' : label.slice(0, 22);
        },
    };
}

/** Pikap kolu: sağ üstteki mile bağlı; çalarken plağın üzerine iner. */
export function createTonearm(): SVGSVGElement {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
<svg xmlns="${SVG_NS}" viewBox="0 0 100 200" aria-hidden="true" focusable="false">
  <circle cx="70" cy="22" r="15" fill="#2b2b30" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
  <circle cx="70" cy="22" r="7" fill="#9a9aa2"/>
  <path d="M70 22 L66 120 L40 162" fill="none" stroke="#c9c9cf" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="26" y="156" width="20" height="28" rx="3" transform="rotate(32 36 170)" fill="#3a3a40" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
</svg>`;
    return wrap.firstElementChild as SVGSVGElement;
}
