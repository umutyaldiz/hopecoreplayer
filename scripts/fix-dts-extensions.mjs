// node16/nodenext için .d.ts'lerdeki uzantısız göreli yollara .js ekler (issue #16); tip üretiminden sonra çalışır.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist');
const KNOWN = ['.js', '.mjs', '.cjs', '.json', '.css'];
// from '…', import('…'), declare module '…' içindeki ./ ve ../ yolları.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bdeclare\s+module\s*)(['"])(\.\.?(?:\/[^'"]*)?)(['"])/g;

function walk(d) {
    return readdirSync(d).flatMap((name) => {
        const p = join(d, name);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.d.ts') ? [p] : [];
    });
}

function rewrite(file, spec) {
    if (KNOWN.some((ext) => spec.endsWith(ext))) return null;
    const target = resolve(dirname(file), spec);
    if (existsSync(`${target}.d.ts`)) return `${spec}.js`;
    if (existsSync(join(target, 'index.d.ts'))) return `${spec.replace(/\/$/, '')}/index.js`;
    return null; // hedef yok (ör. JSDoc örneği) — tahmin etme, dokunma
}

if (!existsSync(dir)) {
    console.error(`fix-dts-extensions: ${dir} yok`);
    process.exit(1);
}
let files = 0;
let specs = 0;
for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8');
    let touched = false;
    const out = src.replace(SPECIFIER, (m, pre, q, spec, q2) => {
        const next = rewrite(file, spec);
        if (!next) return m;
        specs++;
        touched = true;
        return `${pre}${q}${next}${q2}`;
    });
    if (touched) {
        files++;
        writeFileSync(file, out);
    }
}
console.log(`fix-dts-extensions: ${specs} yol, ${files} dosya düzeltildi (${dir})`);
