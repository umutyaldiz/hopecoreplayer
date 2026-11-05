// Cross-browser testlerini GitHub Actions'taki Linux ortamıyla aynı koşullarda, yerelde Docker ile çalıştırır:
// Playwright'in resmi imajı (Ubuntu 24.04, kurulu Playwright sürümüyle aynı), ses aygıtı yok, cross-browser.yml'in adımları.
//
//   npm run test:linux                       → Firefox + WebKit, tüm takımlar
//   npm run test:linux -- webkit             → yalnızca WebKit
//   npm run test:linux -- firefox audio cast → Firefox'ta yalnızca audio ve cast
//
// Gerekli: Docker (Docker Desktop açık). İlk çalıştırmada imaj (~2 GB) ve bağımlılıklar iner; sonrakiler hızlı.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const { version } = createRequire(import.meta.url)('playwright/package.json');
const image = `mcr.microsoft.com/playwright:v${version}-noble`;

const ENGINES = ['firefox', 'webkit', 'chromium'];
const args = process.argv.slice(2);
const browsers = args.filter((a) => ENGINES.includes(a));
const suites = args.filter((a) => !ENGINES.includes(a));

const docker = (cmd, opts = {}) => spawnSync('docker', cmd, { stdio: 'inherit', ...opts });
if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    console.error('Docker çalışmıyor — Docker Desktop\'ı açıp tekrar deneyin.');
    process.exit(2);
}
console.log(`İmaj: ${image}`);
const r = docker(
    [
        'run', '--rm', '--ipc=host', '--init',
        '-v', `${root}:/src:ro`,
        '-v', 'hopecoreplayer-linux-work:/work',
        image,
        'bash', '/src/apps/playground/test/linux/in-container.sh',
        ...(browsers.length ? browsers : ['firefox', 'webkit']),
        '--', ...suites,
    ],
    { env: { ...process.env, MSYS_NO_PATHCONV: '1' } }
);
process.exit(r.status ?? 1);
