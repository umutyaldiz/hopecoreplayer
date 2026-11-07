// Renk körlüğü filtreleri: daltonizasyon (renk körünün ayırt edemediği renk farkını gördüğü kanallara kaydırma).
// Simülasyon matrisi S ile: M = I + E·(I − S). E hatayı görülebilen kanallara dağıtır. Sonuç tek bir 3×3 renk
// matrisi — CSS `filter: url(...)` ile bir SVG feColorMatrix olarak uygulanır (shadow DOM'da #id başvurusu tarayıcıdan
// tarayıcıya değiştiği için filtre veri adresinin içinde gelir).

type M3 = [number, number, number, number, number, number, number, number, number];
type Kind = 'protanopia' | 'deuteranopia' | 'tritanopia';

/** RGB uzayında yaygın kullanılan renk körlüğü simülasyon matrisleri. */
const SIMULATE: Record<Kind, M3> = {
    protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
    deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
    tritanopia: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
};

/** Kırmızı / yeşil körlüğünde hata yeşil ve maviye; mavi körlüğünde kırmızı ve yeşile kaydırılır. */
const SHIFT: Record<Kind, M3> = {
    protanopia: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
    deuteranopia: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
    tritanopia: [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0],
};

const I: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function mul(a: M3, b: M3): M3 {
    const r = new Array<number>(9) as M3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    return r;
}

export function daltonizeMatrix(kind: Kind): M3 {
    const s = SIMULATE[kind];
    const err = I.map((v, i) => v - s[i]!) as M3;
    const shifted = mul(SHIFT[kind], err);
    return I.map((v, i) => v + shifted[i]!) as M3;
}

const cache = new Map<Kind, string>();

export function colorBlindFilterUrl(kind: Kind): string {
    let url = cache.get(kind);
    if (!url) {
        const m = daltonizeMatrix(kind).map((n) => Math.round(n * 1000) / 1000);
        const values = [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0].join(' ');
        const svg = `<svg xmlns='http://www.w3.org/2000/svg'><filter id='f' color-interpolation-filters='sRGB'><feColorMatrix type='matrix' values='${values}'/></filter></svg>`;
        url = `url("data:image/svg+xml,${encodeURIComponent(svg)}#f")`;
        cache.set(kind, url);
    }
    return url;
}
