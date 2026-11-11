// Boyut bütçesi: sayfa player'ı yüklediğinde HEMEN inen kod (giriş dosyası + statik import ettiği parçalar) gzip'li
// olarak bütçeyi aşmasın. Eklentiler (reklam, cast, hls.js…) dinamik import ile ayrı parçalarda — onlar yalnızca
// raporlanır. Kullanım: npm run size --workspace=packages/core (önce build).
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** İlk yükleme bütçesi (KB, gzip). Bilinçli olarak büyütülecekse burayı değiştirip PR'da gerekçesini yazın. */
const INITIAL_BUDGET_KB = 80;
/** Tek bir eklenti parçası için üst sınır (hls.js / dash.js hariç — üçüncü taraf, yalnızca o kaynakta iner). */
const CHUNK_BUDGET_KB = 30;

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const entry = join(dist, 'hope-player.js');
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (bytes) => (bytes / 1024).toFixed(1);

// Yalnızca statik `import … from "./x.js"` / `export … from` — `import("./x.js")` (dinamik) eşleşmez.
const STATIC_IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]*?\sfrom\s*|[\w$*{}\s,]*?from)?["'](\.{1,2}\/[^"']+)["']/g;

const initial = new Set();
const walk = (file) => {
    if (initial.has(file)) return;
    initial.add(file);
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(STATIC_IMPORT)) walk(resolve(dirname(file), m[1]));
};
walk(entry);

let initialBytes = 0;
for (const f of initial) initialBytes += gz(f);

const chunkDir = join(dist, 'chunks');
const lazy = readdirSync(chunkDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(chunkDir, f))
    .filter((f) => !initial.has(f))
    .map((f) => ({ name: f.slice(chunkDir.length + 1), bytes: gz(f) }))
    .sort((a, b) => b.bytes - a.bytes);

console.log(`İlk yükleme: ${kb(initialBytes)} KB gzip (${initial.size} dosya) — bütçe ${INITIAL_BUDGET_KB} KB`);
console.log('En büyük gerektiğinde yüklenen parçalar:');
for (const c of lazy.slice(0, 6)) console.log(`  ${kb(c.bytes).padStart(6)} KB  ${c.name}`);

let failed = false;
if (initialBytes > INITIAL_BUDGET_KB * 1024) {
    console.error(`\n✗ İlk yükleme bütçeyi aştı: ${kb(initialBytes)} KB > ${INITIAL_BUDGET_KB} KB. Yeni kodu bir eklentiye (dinamik import) taşıyın.`);
    failed = true;
}
const big = lazy.filter((c) => !c.name.startsWith('hls') && !c.name.startsWith('dash-') && c.bytes > CHUNK_BUDGET_KB * 1024);
for (const c of big) console.error(`✗ ${c.name}: ${kb(c.bytes)} KB > ${CHUNK_BUDGET_KB} KB parça bütçesi.`);
if (big.length) failed = true;
if (!failed) console.log('\n✓ Boyut bütçesi içinde.');
process.exit(failed ? 1 : 0);
