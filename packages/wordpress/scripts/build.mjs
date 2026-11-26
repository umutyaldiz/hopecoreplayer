// Copies the player build into the plugin and writes dist/hopecoreplayer-<version>.zip (WordPress.org upload).
//   node packages/wordpress/scripts/build.mjs          → assets + zip
//   node packages/wordpress/scripts/build.mjs --no-zip → assets only (wp-env / local testing)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..');
const root = join(plugin, '..', '..');
const coreDist = join(root, 'packages', 'core', 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'packages', 'core', 'package.json'), 'utf8'));

// Versions in the plugin must match the player it ships.
const header = readFileSync(join(plugin, 'hopecoreplayer.php'), 'utf8');
const readme = readFileSync(join(plugin, 'readme.txt'), 'utf8');
const checks = [
    [/\* Version:\s+(\S+)/, header, 'hopecoreplayer.php Version'],
    [/HOPECOREPLAYER_VERSION', '([^']+)'/, header, 'HOPECOREPLAYER_VERSION'],
    [/Stable tag:\s+(\S+)/, readme, 'readme.txt Stable tag'],
    [/"version": "([^"]+)"/, readFileSync(join(plugin, 'blocks', 'player', 'block.json'), 'utf8'), 'block.json version'],
];
for (const [re, text, name] of checks) {
    const found = text.match(re)?.[1];
    if (found !== version) throw new Error(`${name} is ${found}, core is ${version}`);
}

if (!existsSync(join(coreDist, 'hope-player.js'))) throw new Error('Build the core first: npm run build:core');

// Player: JS files only (no source maps / type declarations).
const target = join(plugin, 'assets', 'player');
rmSync(target, { recursive: true, force: true });
cpSync(coreDist, target, {
    recursive: true,
    filter: (src) => statSync(src).isDirectory() || (src.endsWith('.js') && !src.endsWith('.d.js')),
});
// Empty folders left by the filter.
const prune = (dir) => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) prune(p);
    }
    if (dir !== target && !readdirSync(dir).length) rmSync(dir, { recursive: true });
};
prune(target);
cpSync(join(root, 'LICENSE'), join(plugin, 'LICENSE'));

const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
const files = ['hopecoreplayer.php', 'uninstall.php', 'readme.txt', 'LICENSE', 'includes', 'blocks', 'assets']
    .flatMap((p) => (statSync(join(plugin, p)).isDirectory() ? walk(join(plugin, p)) : [join(plugin, p)]))
    .sort();
const size = files.reduce((n, f) => n + statSync(f).size, 0);
console.log(`plugin ${version}: ${files.length} files, ${(size / 1024 / 1024).toFixed(2)} MB`);
if (process.argv.includes('--no-zip')) process.exit(0);

// Minimal zip writer (deflate), entries under hopecoreplayer/.
const CRC = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
});
const crc32 = (buf) => {
    let c = -1;
    for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
};
const local = [];
const central = [];
let offset = 0;
for (const file of files) {
    const name = Buffer.from(`hopecoreplayer/${relative(plugin, file).split(sep).join('/')}`);
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0x21, 10); // 1980-01-01, stable output
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0x21, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + packed.length;
}
const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
const out = join(plugin, 'dist');
mkdirSync(out, { recursive: true });
const zip = join(out, `hopecoreplayer-${version}.zip`);
writeFileSync(zip, Buffer.concat([...local, ...central, end]));
console.log(`→ ${relative(root, zip)} (${(statSync(zip).size / 1024 / 1024).toFixed(2)} MB)`);
