// Kontrol çubuğu sıralaması: varsayılan sıra değişmez, controlsOrder (sıra, '...', gruplar arası taşıma, sıfırlama),
// eklenti butonları (yerleşik anahtarlar, eklenti API'si id / before / after), kompakt düzen.
import { launchBrowser } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

async function open(browser, width = 960) {
    const context = await browser.newContext({ viewport: { width, height: 600 } });
    const page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', (e) => page.__errors.push(e.message));
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => {
        // Eklenti API'si ile buton ekleyen iki eklenti.
        window.__a = { name: 'alpha', setup(p) { p.ui.addButton({ label: 'Alpha', icon: 'loop', before: 'settings' }); } };
        window.__b = {
            name: 'beta',
            setup(p) {
                p.ui.addButton({ id: 'beta-left', label: 'Beta', icon: 'loop', position: 'left', after: 'play' });
            },
        };
    });
    return { context, page };
}

/** Görünür sırayla grup içindeki anahtarlar (yükleme halkası, rozet, gizli "daha fazla" hariç). */
const keys = (page) =>
    page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const group = (el) => Array.from(el?.children ?? []).map((c) => c.dataset.ctrl).filter(Boolean);
        return { left: group(r.querySelector('.hp-group-left')), right: group(r.querySelector('[data-ctrl="settings"]')?.parentElement) };
    });
const setOptions = (page, extra) =>
    page.evaluate(async (extra) => {
        const el = document.getElementById('player');
        el.options = { src: '/sample.mp4', muted: true, share: true, snapshot: true, plugins: [window.__a, window.__b], ...extra };
        await new Promise((x) => setTimeout(x, 900));
    }, extra);

async function testOrder(browser) {
    console.log('\n[1] Varsayılan sıra, eklenti butonları, controlsOrder');
    const { context, page } = await open(browser);
    await setOptions(page, {});
    let k = await keys(page);
    ok(k.left.join(',') === 'play,beta-left,skipBack,skipForward,volume,time', `varsayılan sol + eklenti after:'play' (${k.left.join(',')})`);
    ok(k.right.at(-3) === 'settings' && k.right.at(-2) === 'pip' && k.right.at(-1) === 'fullscreen', `varsayılan sağ: … settings, pip, fullscreen (${k.right.join(',')})`);
    ok(k.right.includes('share') && k.right.includes('snapshot') && k.right.indexOf('alpha') === k.right.indexOf('settings') - 1, `yerleşik (share, snapshot) ve eklenti (alpha, before:'settings') anahtarları (${k.right.join(',')})`);

    await setOptions(page, { controlsOrder: { left: ['play', 'time', 'volume'], right: ['fullscreen', 'settings', '...', 'share'] } });
    k = await keys(page);
    ok(k.left.slice(0, 3).join(',') === 'play,time,volume' && k.left.includes('beta-left'), `sol: play, time, volume, sonra kalanlar (${k.left.join(',')})`);
    ok(k.right[0] === 'fullscreen' && k.right[1] === 'settings' && k.right.at(-1) === 'share', `sağ: fullscreen, settings, '...', share (${k.right.join(',')})`);
    const live = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const t = r.querySelector('[data-ctrl="time"]');
        return t.nextElementSibling?.getAttribute('part');
    });
    ok(live === 'live-badge', `canlı rozeti süre etiketiyle birlikte taşındı (${live})`);

    await setOptions(page, { controlsOrder: { left: ['play', 'fullscreen', 'volume', 'time'], right: ['snapshot', 'alpha', '...'] } });
    k = await keys(page);
    ok(k.left[1] === 'fullscreen' && !k.right.includes('fullscreen'), `tam ekran sol gruba taşındı (${k.left.join(',')})`);
    ok(k.right[0] === 'snapshot' && k.right[1] === 'alpha', `eklenti id'si ile sıralandı (${k.right.join(',')})`);

    await setOptions(page, { controlsOrder: { left: ['play', 'beta-left'], right: [] } });
    k = await keys(page);
    ok(k.left.slice(0, 2).join(',') === 'play,beta-left', `eklenti API butonu id ile sol listede (${k.left.join(',')})`);

    await setOptions(page, {});
    k = await keys(page);
    ok(k.left.join(',') === 'play,beta-left,skipBack,skipForward,volume,time' && k.right.at(-1) === 'fullscreen', `controlsOrder kaldırılınca varsayılana döndü (${k.left.join(',')} | ${k.right.join(',')})`);
    ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    await context.close();
}

async function testCompact(browser) {
    console.log('\n[2] Kompakt düzen (dar player): tam ekran kendi yerinde, sıra korunur');
    const { context, page } = await open(browser, 380);
    await setOptions(page, { controlsOrder: { right: ['settings', 'share', '...'] } });
    const r = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const fs = root.querySelector('[data-ctrl="fullscreen"]');
        const settings = root.querySelector('[data-ctrl="settings"]');
        return { fsInRight: fs.parentElement === settings.parentElement, firstRight: settings.parentElement.querySelector('[data-ctrl]')?.dataset.ctrl, compact: !!root.querySelector('[data-compact]') };
    });
    ok(r.compact && !r.fsInRight, `kompaktta tam ekran sağ grubun dışında (${JSON.stringify(r)})`);
    ok(r.firstRight === 'settings', `kompaktta da sıra geçerli (${r.firstRight})`);
    ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    await context.close();
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testOrder(browser);
        await testCompact(browser);
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
