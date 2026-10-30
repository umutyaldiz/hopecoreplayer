// src/'yi GERÇEK react-native + react-native-webview + React 19 tiplerine karşı derler (monorepo dışında, geçici klasörde).
// Monorepo'da src/shims.d.ts ile derleniyor (react-native React 19 istiyor, workspace React 18) — bu script shim'lerin
// gerçek API ile uyumlu kaldığını doğrular. Kullanım: node test/verify-types.mjs [geçici-klasör]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const repo = path.resolve(pkgDir, '../..');
const dir = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'hope-rn-types-'));
const DEPS = ['react@19.2.9', '@types/react@19.1.17', 'react-native@0.87.1', 'react-native-webview@14.0.1', 'typescript@5.7.3'];

fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
if (!fs.existsSync(path.join(dir, 'node_modules', 'react-native'))) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'hope-rn-types', private: true }));
    console.log(`Gerçek tipler kuruluyor (${dir})…`);
    execSync(`npm install --ignore-scripts --no-audit --no-fund ${DEPS.join(' ')}`, { cwd: dir, stdio: 'inherit' });
}
// shims.d.ts HARİÇ — gerçek tipler kullanılsın.
for (const f of fs.readdirSync(path.join(pkgDir, 'src'))) {
    if (f !== 'shims.d.ts') fs.copyFileSync(path.join(pkgDir, 'src', f), path.join(dir, 'src', f));
}
const slash = (p) => p.split(path.sep).join('/');
fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
        compilerOptions: {
            target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], strict: true,
            noUncheckedIndexedAccess: true, jsx: 'react-jsx', noEmit: true, skipLibCheck: true, esModuleInterop: true, baseUrl: '.',
            paths: {
                '@hopeplayer/core': [slash(path.join(repo, 'packages/core/dist/index.d.ts'))],
                'hls.js': [slash(path.join(repo, 'node_modules/hls.js/dist/hls.d.ts'))],
            },
        },
        include: ['src'],
    })
);
try {
    execSync(`"${path.join(dir, 'node_modules', '.bin', 'tsc')}" -p tsconfig.json`, { cwd: dir, stdio: 'inherit' });
    console.log('Gerçek react-native / react-native-webview tipleriyle derleme temiz.');
} catch {
    console.log('Gerçek tiplerle derleme HATALI — src/shims.d.ts gerçek API ile uyuşmuyor.');
    process.exit(1);
}
