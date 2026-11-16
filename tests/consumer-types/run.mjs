// Derlenmiş paketlerin tiplerini kullanıcı projesi gibi node16 / nodenext / bundler ile denetler (önce 4 paket build edilmeli).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const MODES = ['node16', 'nodenext', 'bundler'];

let failed = 0;
for (const mode of MODES) {
    const r = spawnSync(process.execPath, [tsc, '-p', join(here, `tsconfig.${mode}.json`)], { encoding: 'utf8' });
    const ok = r.status === 0;
    console.log(`${ok ? '✓' : '✗'} moduleResolution: ${mode}`);
    if (!ok) {
        failed++;
        console.log((r.stdout + r.stderr).trim().replace(/^/gm, '    '));
    }
}
if (failed) {
    console.error(`\n${failed}/${MODES.length} mod başarısız — yayınlanan .d.ts'ler bu kullanıcılar için bozuk.`);
    process.exit(1);
}
console.log(`\nTüm modlar temiz (${MODES.length}/${MODES.length}).`);
