// HopePlayerEventMap'te bildirilen her `hp:*` olayı kaynak kodda gerçekten gönderiliyor mu (dispatchEvent /
// new CustomEvent). Bildirilip hiç gönderilmeyen olaylar (ör. hp:ended) wrapper callback'lerini (onEnded) sessizce
// bozuyordu. Kullanım: npm run check-events --workspace=packages/core
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const types = readFileSync(join(src, 'types/index.ts'), 'utf8');
const map = /export (?:interface|type) HopePlayerEventMap\s*=?\s*\{([\s\S]*?)\r?\n\};?/.exec(types)?.[1] ?? '';
const declared = [...map.matchAll(/^\s+'(hp:[a-z]+)':/gm)].map((m) => m[1]);

const files = [];
const walk = (dir) => {
    for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.d.ts') && !p.includes(`${join('types', 'index.ts')}`)) files.push(readFileSync(p, 'utf8'));
    }
};
walk(src);
const code = files.join('\n');

const missing = declared.filter((ev) => !new RegExp(`CustomEvent(?:<[^>]*>)?\\(\\s*['"\`]${ev}['"\`]`).test(code));
if (!declared.length) {
    console.error('✗ HopePlayerEventMap bulunamadı.');
    process.exit(1);
}
if (missing.length) {
    console.error(`✗ Bildirilmiş ama hiç gönderilmeyen olaylar: ${missing.join(', ')}`);
    process.exit(1);
}
console.log(`✓ ${declared.length} olayın hepsi gönderiliyor.`);
