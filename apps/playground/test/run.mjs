// Takımları sırayla koşturur ve sürelerini raporlar: node apps/playground/test/run.mjs [--browser firefox] [--shard 2/4 | ads cast …]
// Ad verilmezse hepsi. Bir takım başarısız olsa da diğerleri çalışır; sonunda biri bile kırmızıysa çıkış kodu 1.
// Tarayıcı: HOPE_BROWSER=chromium | firefox | webkit (bkz. _browser.mjs).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const all = [
    ...readdirSync(here)
        .filter((f) => f.endsWith('.e2e.mjs'))
        .map((f) => f.replace('.e2e.mjs', '')),
    'react-native',
];
const path = (name) => (name === 'react-native' ? join(root, 'packages/react-native/test/bridge.e2e.mjs') : join(here, `${name}.e2e.mjs`));

/**
 * CI parçaları için yaklaşık süreler (sn, Chromium). `--shard i/n` takımları buna göre dengeli dağıtır; burada olmayan
 * (yeni eklenmiş) bir takım varsayılan ağırlıkla yine bir parçaya düşer — CI'da hiçbir takım atlanmaz.
 */
const WEIGHTS = {
    monetization: 164,
    'content-ops': 56,
    interaction: 56,
    ads: 40,
    theme: 37,
    mobile: 33,
    audio: 32,
    'ad-triggers': 30,
    sources: 24,
    a11y: 19,
    cast: 17,
    live: 15,
    i18n: 8,
    'prebid-consent': 3,
    'react-native': 3,
};
const DEFAULT_WEIGHT = 30;

function shard(index, count) {
    const loads = Array.from({ length: count }, () => ({ total: 0, names: [] }));
    const sorted = [...all].sort((a, b) => (WEIGHTS[b] ?? DEFAULT_WEIGHT) - (WEIGHTS[a] ?? DEFAULT_WEIGHT) || a.localeCompare(b));
    for (const name of sorted) {
        const lightest = loads.reduce((min, l) => (l.total < min.total ? l : min));
        lightest.total += WEIGHTS[name] ?? DEFAULT_WEIGHT;
        lightest.names.push(name);
    }
    return loads[index - 1].names;
}

const args = process.argv.slice(2);
// --browser firefox|webkit → HOPE_BROWSER (alt süreçlere geçer); bkz. _browser.mjs.
const browserArg = args.indexOf('--browser');
if (browserArg !== -1) {
    process.env.HOPE_BROWSER = args[browserArg + 1];
    args.splice(browserArg, 2);
}
const shardArg = args.indexOf('--shard');
let names;
if (shardArg !== -1) {
    const m = /^(\d+)\/(\d+)$/.exec(args[shardArg + 1] ?? '');
    if (!m || +m[1] < 1 || +m[1] > +m[2]) {
        console.error('Kullanım: --shard <i>/<n>, ör. --shard 2/4');
        process.exit(2);
    }
    names = shard(+m[1], +m[2]);
    console.log(`Parça ${m[1]}/${m[2]}: ${names.join(', ')}`);
} else {
    names = args.length ? args : all;
}
const unknown = names.filter((n) => !all.includes(n));
if (unknown.length) {
    console.error(`Bilinmeyen takım: ${unknown.join(', ')} — mevcut: ${all.join(', ')}`);
    process.exit(2);
}

const results = [];
for (const name of names) {
    console.log(`\n━━━ ${name} (${process.env.HOPE_BROWSER ?? 'chromium'}) ━━━`);
    const start = Date.now();
    const r = spawnSync(process.execPath, [path(name)], { stdio: 'inherit', cwd: root, env: process.env });
    results.push({ name, ok: r.status === 0, secs: Math.round((Date.now() - start) / 1000) });
}

console.log('\n━━━ Özet ━━━');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(16)} ${String(r.secs).padStart(4)} sn`);
const failed = results.filter((r) => !r.ok);
process.exit(failed.length ? 1 : 0);
