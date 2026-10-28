// icon-src/*.svg → src/theme/icons/hope-icons.css. fantasticon yerine alt paketleri doğrudan kullanılıyor
// (generateFonts Windows'ta glob yolları yüzünden çöküyor).
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont';
import svg2ttf from 'svg2ttf';
import ttf2woff2Module from 'ttf2woff2';
import { createReadStream, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ttf2woff2 = ttf2woff2Module.default ?? ttf2woff2Module;

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputDir = join(__dirname, '../icon-src');
const outDir = join(__dirname, '../src/theme/icons');
const fontName = 'hope-icons';
const classPrefix = 'hp-icon';
const CODEPOINT_START = 0xe900; // Private Use Area — gerçek glyph'lerle çakışmaz

const files = readdirSync(inputDir)
    .filter((f) => f.endsWith('.svg'))
    .sort();

if (files.length === 0) {
    throw new Error(`icon-src içinde SVG bulunamadı: ${inputDir}`);
}

const codepoints = {};
files.forEach((file, i) => {
    codepoints[basename(file, '.svg')] = CODEPOINT_START + i;
});

// 1) SVG'ler -> tek bir SVG font (svgicons2svgfont)
const svgFontXml = await new Promise((resolve, reject) => {
    let font = Buffer.alloc(0);
    const fontStream = new SVGIcons2SVGFontStream({
        fontName,
        fontHeight: 512,
        descent: 64,
        normalize: true,
    })
        .on('data', (chunk) => {
            font = Buffer.concat([font, Buffer.from(chunk)]);
        })
        .on('end', () => resolve(font.toString()))
        .on('error', reject);

    for (const file of files) {
        const name = basename(file, '.svg');
        const glyph = createReadStream(join(inputDir, file));
        glyph.metadata = { name, unicode: [String.fromCharCode(codepoints[name])] };
        fontStream.write(glyph);
    }
    fontStream.end();
});

// 2) SVG font -> TTF (svg2ttf)
const ttf = svg2ttf(svgFontXml, { ts: 0 });
const ttfBuffer = Buffer.from(ttf.buffer);

// 3) TTF -> WOFF2 (ttf2woff2)
const woff2Buffer = Buffer.from(ttf2woff2(ttfBuffer));
const base64 = woff2Buffer.toString('base64');

const iconRules = Object.entries(codepoints)
    .map(([name, code]) => `.${classPrefix}-${name}::before { content: "\\${code.toString(16)}"; }`)
    .join('\n');

// Çıktı ikiye ayrık: @font-face Shadow DOM içinde uygulanmıyor (crbug.com/41085401) — document.head'e ayrı enjekte edilir.
const fontFaceCss = `/* OTOMATİK ÜRETİLDİ — elle düzenlemeyin. document.head'e enjekte edilir (bkz. injectIconFont.ts) — Shadow DOM içinde @font-face çalışmıyor (crbug.com/41085401). */
@font-face {
    font-family: "${fontName}";
    src: url("data:font/woff2;base64,${base64}") format("woff2");
    font-weight: normal;
    font-style: normal;
    font-display: block;
}
`;

const iconClassesCss = `/* OTOMATİK ÜRETİLDİ — elle düzenlemeyin. Kaynak: icon-src/*.svg, bkz. scripts/build-icons.mjs. Shadow root stylesheet'ine import edilir. */
.${classPrefix} {
    font-family: "${fontName}";
    font-style: normal;
    font-weight: normal;
    font-variant: normal;
    text-transform: none;
    line-height: 1;
    speak: none;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

${iconRules}
`;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, `${fontName}.css`), iconClassesCss, 'utf-8');
await writeFile(join(outDir, `${fontName}-font-face.css`), fontFaceCss, 'utf-8');

console.log(`✓ ${files.length} ikon:`);
console.log(`  - src/theme/icons/${fontName}.css (shadow root'a, .hp-icon-* kuralları)`);
console.log(`  - src/theme/icons/${fontName}-font-face.css (document.head'e, @font-face — ${(base64.length / 1024).toFixed(1)} KB base64)`);
console.log(Object.keys(codepoints).map((n) => `  ${classPrefix}-${n}`).join('\n'));
