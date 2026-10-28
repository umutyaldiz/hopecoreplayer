import QRCodeGenerator from 'qrcode-generator';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export interface QrSvgOptions {
    size: number;
    logoUrl?: string;
    /** 0-0.3 arası — `H` (en yüksek, ~%30 toleranslı) hata düzeltme seviyesiyle bile daha büyük değerler taranabilirliği bozabilir. */
    logoScale: number;
}

/** data'yı QR SVG'sine çizer (DOM API ile). */
export function buildQrSvg(data: string, opts: QrSvgOptions): SVGSVGElement {
    const qr = QRCodeGenerator(0, opts.logoUrl ? 'H' : 'M');
    qr.addData(data);
    qr.make();

    const count = qr.getModuleCount();
    const cell = opts.size / count;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${opts.size} ${opts.size}`);
    svg.setAttribute('width', String(opts.size));
    svg.setAttribute('height', String(opts.size));

    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', '#fff');
    svg.appendChild(bg);

    const modules = document.createElementNS(SVG_NS, 'g');
    modules.setAttribute('fill', '#000');
    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            if (!qr.isDark(row, col)) continue;
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', String(col * cell));
            rect.setAttribute('y', String(row * cell));
            rect.setAttribute('width', String(cell));
            rect.setAttribute('height', String(cell));
            modules.appendChild(rect);
        }
    }
    svg.appendChild(modules);

    if (opts.logoUrl) {
        const logoSize = opts.size * opts.logoScale;
        const pad = logoSize * 0.18;
        const backSize = logoSize + pad * 2;
        const backXY = (opts.size - backSize) / 2;
        const logoXY = (opts.size - logoSize) / 2;

        const back = document.createElementNS(SVG_NS, 'rect');
        back.setAttribute('x', String(backXY));
        back.setAttribute('y', String(backXY));
        back.setAttribute('width', String(backSize));
        back.setAttribute('height', String(backSize));
        back.setAttribute('rx', String(backSize * 0.22));
        back.setAttribute('fill', '#fff');
        svg.appendChild(back);

        const img = document.createElementNS(SVG_NS, 'image');
        img.setAttribute('href', opts.logoUrl);
        // Eski Safari sürümleri `href`i değil yalnızca `xlink:href`i anlıyor.
        img.setAttributeNS(XLINK_NS, 'xlink:href', opts.logoUrl);
        img.setAttribute('x', String(logoXY));
        img.setAttribute('y', String(logoXY));
        img.setAttribute('width', String(logoSize));
        img.setAttribute('height', String(logoSize));
        img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.appendChild(img);
    }

    return svg;
}
