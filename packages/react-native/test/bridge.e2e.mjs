// @hopeplayer/react-native köprü testi: WebView'da çalışan sayfayı (buildPlayerHtml) gerçek core ile tarayıcıda açar,
// React Native'in WebView'a verdiği window.ReactNativeWebView'ı taklit eder; komutlar ve olaylar uçtan uca doğrulanır.
// Önce: npm run build --workspace=packages/core && npm run build --workspace=packages/react-native
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildPlayerHtml, commandScript } from '../dist/player-html.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE_DIST = path.resolve(here, '../../core/dist');
const MEDIA = path.resolve(here, '../../../apps/playground/public');
const VERSION = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')).version;
const TYPES = { '.js': 'application/javascript', '.html': 'text/html', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.css': 'text/css' };

let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

const pages = new Map();
const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (pages.has(url)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(pages.get(url));
    }
    const file = url.startsWith('/core/') ? path.join(CORE_DIST, url.slice(6)) : url.startsWith('/media/') ? path.join(MEDIA, url.slice(7)) : null;
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const data = fs.readFileSync(file);
    const headers = { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
    const range = req.headers.range;
    if (range) {
        const [s, e] = range.replace('bytes=', '').split('-');
        const start = Number(s), end = e ? Math.min(Number(e), data.length - 1) : data.length - 1;
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
        return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { ...headers, 'Content-Length': data.length });
    res.end(data);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

// React Native'in WebView'a enjekte ettiği köprü nesnesi.
const MOCK_RN = () => {
    window.__msgs = [];
    window.ReactNativeWebView = { postMessage: (m) => window.__msgs.push(JSON.parse(m)) };
};
const messages = (page, type) => page.evaluate((type) => window.__msgs.filter((m) => !type || m.type === type), type);
const waitFor = (page, type, timeout = 10000) =>
    page.waitForFunction((type) => window.__msgs.some((m) => m.type === type), type, { timeout }).then(() => true, () => false);
const send = (page, cmd) => page.evaluate((script) => eval(script), commandScript(cmd));

const browser = await chromium.launch();
try {
    console.log('\n[1] Köprü: sayfa + core yükleniyor, "ready" geliyor, hazır olmadan gelen komut sıraya alınıyor');
    pages.set('/player.html', buildPlayerHtml({
        coreUrl: `${BASE}/core/hope-player.js`,
        options: { src: '/media/sample.mp4', muted: true, skipButtons: true, subtitles: [{ src: '/media/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true }] },
    }));
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.addInitScript(MOCK_RN);
    // Sayfa yüklenir yüklenmez (core gelmeden) komut ver — kuyruktan sonra uygulanmalı.
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => window.__hopeCommand && window.__hopeCommand({ type: 'seek', time: 4 }));
    });
    await page.goto(`${BASE}/player.html`);
    ok(await waitFor(page, 'ready'), '"ready" mesajı geldi');
    const ready = (await messages(page, 'ready'))[0];
    ok(ready?.data?.version === VERSION, `ready içinde player sürümü (${ready?.data?.version})`);
    ok(await waitFor(page, 'loadedmetadata'), '"loadedmetadata" geldi');
    const meta = (await messages(page, 'loadedmetadata')).at(-1);
    ok(meta?.data?.width === 1280 && meta?.data?.duration > 9.9, `video bilgisi ${JSON.stringify(meta?.data)}`);
    await page.waitForTimeout(400);
    const t0 = await page.evaluate(() => document.getElementById('hope-player').shadowRoot.querySelector('video').currentTime);
    ok(Math.abs(t0 - 4) < 0.5, `hazır olmadan gönderilen seek kuyruktan uygulandı (${t0.toFixed(2)} sn)`);
    const opts = await page.evaluate(() => { const el = document.getElementById('hope-player'); return { skip: !!el.shadowRoot.querySelector('[part="skip-forward-button"]:not([style*="none"])'), tracks: el.shadowRoot.querySelector('video').textTracks.length }; });
    ok(opts.skip && opts.tracks >= 1, `başlangıç seçenekleri uygulandı (sarma butonları, altyazı) ${JSON.stringify(opts)}`);

    console.log('\n[2] Komutlar: play / pause / seek / muted → player olayları React Native\'e dönüyor');
    await send(page, { type: 'play' });
    ok(await waitFor(page, 'play'), '"play" olayı geldi');
    await page.waitForTimeout(1200);
    const tus = await messages(page, 'timeupdate');
    ok(tus.length >= 2 && tus.length <= 8, `timeupdate seyreltiliyor (1,2 sn'de ${tus.length} mesaj, ~250 ms aralık)`);
    ok(tus.at(-1).data.paused === false && tus.at(-1).data.currentTime > 4, `timeupdate içeriği ${JSON.stringify(tus.at(-1).data)}`);
    await send(page, { type: 'pause' });
    ok(await waitFor(page, 'pause'), '"pause" olayı geldi');
    await send(page, { type: 'seek', time: 10 });
    await page.waitForTimeout(400);
    const afterSeek = (await messages(page, 'timeupdate')).at(-1).data;
    ok(Math.abs(afterSeek.currentTime - 10) < 0.3 && afterSeek.paused, `seek → 10 sn, seeked sonrası timeupdate hemen geldi ${JSON.stringify(afterSeek)}`);
    await send(page, { type: 'muted', value: false });
    const muted = await page.evaluate(() => document.getElementById('hope-player').shadowRoot.querySelector('video').muted);
    ok(muted === false, 'muted komutu uygulandı');

    console.log('\n[3] Seçenek güncellemesi sayfayı yeniden yüklemeden uygulanıyor; istatistik paneli komutla açılıyor');
    await page.evaluate(() => { window.__reloadMarker = 1; });
    await send(page, { type: 'options', options: { src: '/media/sample.mp4', muted: true, theme: 'glass-dark', skipButtons: { back: false, forward: 30 } } });
    await page.waitForTimeout(300);
    const updated = await page.evaluate(() => {
        const el = document.getElementById('hope-player');
        const fwd = el.shadowRoot.querySelector('[part="skip-forward-button"]');
        return { marker: window.__reloadMarker, theme: el.getAttribute('data-theme'), fwd: fwd.querySelector('.hp-skip-num').textContent, back: getComputedStyle(el.shadowRoot.querySelector('[part="skip-back-button"]')).display };
    });
    ok(updated.marker === 1 && updated.theme === 'glass-dark' && updated.fwd === '30' && updated.back === 'none', `yeni seçenekler uygulandı, sayfa yeniden yüklenmedi ${JSON.stringify(updated)}`);
    await send(page, { type: 'toggleStats', force: true });
    await page.waitForFunction(() => document.getElementById('hope-player').shadowRoot.querySelector('[part="stats-panel"]'), { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate(() => !!document.getElementById('hope-player').shadowRoot.querySelector('[part="stats-panel"]')), 'toggleStats komutu istatistik panelini açtı');
    await page.close();

    console.log('\n[4] Core yüklenemezse (yanlış coreUrl) React Native\'e hata olayı gidiyor');
    pages.set('/broken.html', buildPlayerHtml({ coreUrl: `${BASE}/core/yok.js`, options: { src: '/media/sample.mp4' } }));
    const broken = await browser.newPage();
    await broken.addInitScript(MOCK_RN);
    await broken.goto(`${BASE}/broken.html`);
    ok(await waitFor(broken, 'error', 5000), '"error" olayı geldi');
    const err = (await messages(broken, 'error'))[0];
    ok(err?.data?.code === 'core-load' && /could not be loaded/.test(err.data.message), `hata içeriği ${JSON.stringify(err?.data)}`);
    await broken.close();

    console.log('\n[5] Güvenlik: seçeneklerdeki "</script>" sayfayı bozmuyor');
    pages.set('/inject.html', buildPlayerHtml({ coreUrl: `${BASE}/core/hope-player.js`, options: { src: '/media/sample.mp4', poster: '</script><script>window.__pwned=1</script>' } }));
    const inj = await browser.newPage();
    await inj.addInitScript(MOCK_RN);
    await inj.goto(`${BASE}/inject.html`);
    const injReady = await waitFor(inj, 'ready');
    const pwned = await inj.evaluate(() => window.__pwned === 1);
    ok(injReady && !pwned, `JSON güvenle gömüldü (ready: ${injReady}, enjeksiyon: ${pwned})`);
    await inj.close();

    console.log('\n[6] css: token\'lar player\'a uygulanıyor, "</style>" sayfayı bozmuyor');
    pages.set('/css.html', buildPlayerHtml({
        coreUrl: `${BASE}/core/hope-player.js`,
        options: { src: '/media/sample.mp4' },
        css: 'hope-player { --hp-color-accent: rgb(1, 2, 3); } /* </style><script>window.__pwned=1</script> */',
    }));
    const styled = await browser.newPage();
    await styled.addInitScript(MOCK_RN);
    await styled.goto(`${BASE}/css.html`);
    const styledReady = await waitFor(styled, 'ready');
    const accent = await styled.evaluate(() => getComputedStyle(document.getElementById('hope-player')).getPropertyValue('--hp-color-accent').trim());
    const cssPwned = await styled.evaluate(() => window.__pwned === 1);
    ok(styledReady && accent === 'rgb(1, 2, 3)' && !cssPwned, `css uygulandı (accent: ${accent}, enjeksiyon: ${cssPwned})`);
    await styled.close();
} finally {
    await browser.close();
    server.close();
}
console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
process.exit(failures === 0 ? 0 : 1);
