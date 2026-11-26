// Installs WordPress in the compose stack (docker-compose.yml) and activates the plugin.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const compose = join(dirname(fileURLToPath(import.meta.url)), 'docker-compose.yml');
const wp = (...args) => {
    const r = spawnSync('docker', ['compose', '-f', compose, 'run', '--rm', '-T', 'cli', ...args], {
        encoding: 'utf8',
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
    return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

// Database / files may need a few seconds after `up -d`.
let ready = false;
for (let i = 0; i < 30 && !ready; i++) {
    ready = wp('core', 'version').ok && wp('db', 'query', 'SELECT 1').ok;
    if (!ready) await new Promise((r) => setTimeout(r, 2000));
}
if (!ready) throw new Error('WordPress container not ready');

if (!wp('core', 'is-installed').ok) {
    const r = wp('core', 'install', '--url=http://localhost:8890', '--title=HopeCorePlayer test', '--admin_user=admin', '--admin_password=admin', '--admin_email=admin@example.com', '--skip-email');
    if (!r.ok) throw new Error(r.err || r.out);
}
// WP_VERSION=6.5 → oldest supported WordPress (the image may ship another version).
if (process.env.WP_VERSION) {
    const up = wp('core', 'update', `--version=${process.env.WP_VERSION}`, '--force');
    if (!up.ok) throw new Error(up.err || up.out);
    wp('core', 'update-db');
}
const act = wp('plugin', 'activate', 'hopecoreplayer');
if (!act.ok) throw new Error(act.err || act.out);
wp('rewrite', 'structure', '/%postname%/');
console.log(`WordPress ${wp('core', 'version').out}, PHP ${wp('eval', 'echo PHP_VERSION;').out} — plugin active`);
