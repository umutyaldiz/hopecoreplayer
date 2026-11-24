// Dublaj: dil başına kaynaklar (HLS + MP4 kaliteleri), dil başına yedeğe düşme, biçim / kalite / konum korunması.
import { launchBrowser, only } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

/** Dil başına kaynaklar — aynı dosyalar, dil sorgu parametresiyle ayırt edilir. */
const langSources = (lang) => [
    { src: `/hls/master.m3u8?lang=${lang}`, label: 'Auto' },
    { src: `/sample.mp4?lang=${lang}`, label: '1080p' },
    { src: `/sample-30s.mp4?lang=${lang}`, label: '720p', selected: true },
    { src: `/sample-240p.mp4?lang=${lang}`, label: '360p' },
];
const TRACKS = [
    { label: 'Türkçe', srclang: 'tr', default: true, sources: langSources('tr') },
    { label: 'English', srclang: 'en', sources: langSources('en') },
];

async function open(browser, options, routes) {
    const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
    if (routes) await routes(context);
    const page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', (e) => page.__errors.push(e.message));
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((options) => {
        const el = document.getElementById('player');
        window.__ev = [];
        for (const t of ['hp:dubbing', 'hp:sourcefallback']) el.addEventListener(t, (e) => window.__ev.push({ t, d: e.detail }));
        el.options = { muted: true, ...options };
    }, options);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    return { context, page };
}

/** Çalan kaynak: dil ve biçim / kalite. */
const playing = (page) =>
    page.evaluate(() => {
        const el = document.getElementById('player');
        const v = el.shadowRoot.querySelector('video');
        const src = el.sourceManager.currentSrc ?? '';
        const u = new URL(src, location.href);
        return { file: u.pathname.split('/').pop(), lang: u.searchParams.get('lang'), t: v.currentTime, paused: v.paused, engine: el.sourceManager.engine.engine };
    });

/** Ayarlar menüsünde bir satırı açıp alt satırları okur; `pick` verilirse onu seçer. */
const menu = (page, row, pick) =>
    page.evaluate(
        async ({ row, pick }) => {
            const r = document.getElementById('player').shadowRoot;
            const wait = () => new Promise((x) => setTimeout(x, 150));
            const btns = () => [...r.querySelectorAll('.hp-chip-panel button')];
            r.querySelector('button[aria-label="Ayarlar"]').click();
            await wait();
            const head = btns().find((b) => b.textContent.trim().startsWith(row));
            const value = head?.textContent.trim().slice(row.length) ?? null;
            if (!head) {
                r.querySelector('button[aria-label="Ayarlar"]').click();
                return { found: false, value, rows: [] };
            }
            head.click();
            await wait();
            const rows = btns().map((b) => b.textContent.trim()).slice(1);
            if (pick) btns().find((b) => b.textContent.trim().startsWith(pick))?.click();
            else r.querySelector('button[aria-label="Ayarlar"]').click();
            return { found: true, value, rows };
        },
        { row, pick }
    );

const events = (page, t) => page.evaluate((t) => window.__ev.filter((e) => e.t === t).map((e) => e.d), t);

async function testLegacy(browser) {
    console.log('\n[1] Eski kullanım (src + iz başına src): dil değişince kaynak değişir, konum korunur, hp:dubbing yayılır');
    const { context, page } = await open(browser, {
        src: '/sample-30s.mp4',
        dubbing: {
            tracks: [
                { src: '/sample-30s.mp4', label: 'Türkçe', srclang: 'tr', default: true },
                { src: '/sample.mp4?lang=en', label: 'English', srclang: 'en' },
            ],
        },
    });
    await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 4));
    await page.waitForTimeout(400);
    const m = await menu(page, 'Ses / Dil', 'English');
    ok(m.found && m.value === 'TR', `"Ses / Dil" menüsü, değer TR (${m.value})`);
    await page.waitForFunction(() => document.getElementById('player').sourceManager.currentSrc?.includes('lang=en'), null, { timeout: 5000 });
    await page.waitForTimeout(600);
    const p = await playing(page);
    ok(p.file === 'sample.mp4' && p.lang === 'en' && Math.abs(p.t - 4) < 0.6, `İngilizce kaynağa geçildi, konum korundu (${p.file}?lang=${p.lang}, t=${p.t.toFixed(1)})`);
    const ev = await events(page, 'hp:dubbing');
    ok(ev.length === 1 && ev[0].index === 1 && ev[0].srclang === 'en', `hp:dubbing ${JSON.stringify(ev)}`);
    ok((await menu(page, 'Ses / Dil')).value === 'EN', 'menü değeri EN');
    ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    await context.close();
}

async function testPerLanguageSources(browser) {
    console.log('\n[2] Dil başına sources: açılışta varsayılan dilin HLS\'i, dil değişince o dilin HLS\'i; seçenek yeniden uygulanınca dil korunur');
    const { context, page } = await open(browser, { sourcePriority: ['hls', 'mp4'], dubbing: { tracks: TRACKS } });
    let p = await playing(page);
    ok(p.file === 'master.m3u8' && p.lang === 'tr' && p.engine === 'hls.js', `açılış: Türkçe HLS (${p.file}?lang=${p.lang}, ${p.engine})`);
    await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 3));
    await page.waitForTimeout(500);
    await menu(page, 'Ses / Dil', 'English');
    await page.waitForFunction(() => document.getElementById('player').sourceManager.currentSrc?.includes('lang=en'), null, { timeout: 8000 });
    await page.waitForTimeout(1200);
    p = await playing(page);
    ok(p.file === 'master.m3u8' && p.lang === 'en' && Math.abs(p.t - 3) < 1, `İngilizce HLS, konum korundu (${p.file}?lang=${p.lang}, t=${p.t.toFixed(1)})`);
    const q = await menu(page, 'Kalite');
    ok(q.rows.some((r) => /^\d+p/.test(r)) && !q.rows.some((r) => r.startsWith('1080p')), `kalite menüsü HLS seviyeleri (${q.rows.join(', ')})`);
    // Seçenekler yeniden uygulanınca (ör. React yeniden çizimi) seçili dil kalır.
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { ...el.options };
    });
    await page.waitForTimeout(1000);
    p = await playing(page);
    ok(p.lang === 'en' && (await menu(page, 'Ses / Dil')).value === 'EN', `yeniden uygulamada İngilizce korundu (lang=${p.lang})`);
    ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    await context.close();
}

const failHls = (lang) => async (context) =>
    context.route(`**/hls/master.m3u8?lang=${lang}`, (r) => r.fulfill({ status: 404, body: '' }));

async function testPerLanguageFallback(browser) {
    console.log('\n[3] Dil başına yedek: İngilizce HLS çökükse İngilizceye geçince İngilizce MP4\'e düşülür, menüde MP4 kaliteleri');
    const { context, page } = await open(browser, { sourcePriority: ['hls', 'mp4'], dubbing: { tracks: TRACKS } }, failHls('en'));
    ok((await playing(page)).lang === 'tr', 'açılış Türkçe HLS');
    await menu(page, 'Ses / Dil', 'English');
    await page.waitForFunction(() => /sample.*lang=en/.test(document.getElementById('player').sourceManager.currentSrc ?? ''), null, { timeout: 10000 });
    await page.waitForTimeout(800);
    const p = await playing(page);
    ok(p.file === 'sample-30s.mp4' && p.lang === 'en', `İngilizce MP4 720p (seçili) (${p.file}?lang=${p.lang})`);
    const q = await menu(page, 'Kalite');
    ok(['1080p', '720p', '360p'].every((l) => q.rows.some((r) => r.startsWith(l))), `kalite menüsü MP4 (${q.rows.join(', ')})`);
    const fb = await events(page, 'hp:sourcefallback');
    ok(fb.some((e) => e.from === 'hls' && e.to === 'mp4'), `hp:sourcefallback ${JSON.stringify(fb)}`);
    ok(!(await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="error-screen"]')?.hasAttribute('data-visible'))), 'hata ekranı yok');
    await context.close();
}

async function testKeepFormatAndQuality(browser) {
    console.log('\n[4] MP4\'e düşülmüşken dil değişince yeni dilde de MP4, aynı kalite; konum korunur');
    const { context, page } = await open(browser, { sourcePriority: ['hls', 'mp4'], dubbing: { tracks: TRACKS } }, failHls('tr'));
    await page.waitForFunction(() => /sample.*lang=tr/.test(document.getElementById('player').sourceManager.currentSrc ?? ''), null, { timeout: 10000 });
    await page.waitForTimeout(500);
    await menu(page, 'Kalite', '1080p');
    await page.waitForFunction(() => /\/sample\.mp4\?lang=tr/.test(document.getElementById('player').sourceManager.currentSrc ?? ''), null, { timeout: 5000 });
    await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 5));
    await page.waitForTimeout(500);
    await menu(page, 'Ses / Dil', 'English');
    await page.waitForFunction(() => document.getElementById('player').sourceManager.currentSrc?.includes('lang=en'), null, { timeout: 8000 });
    await page.waitForTimeout(800);
    const p = await playing(page);
    ok(p.file === 'sample.mp4' && p.lang === 'en' && Math.abs(p.t - 5) < 0.8, `İngilizce MP4 1080p'den devam (${p.file}?lang=${p.lang}, t=${p.t.toFixed(1)})`);
    ok((await menu(page, 'Kalite')).value === '1080p', 'kalite menüsü 1080p');
    await context.close();
}

async function testNewFilm(browser) {
    console.log('\n[5] Başka film (dubbing değişti): varsayılan dile dönülür, menü yeni dillerle kurulur');
    const { context, page } = await open(browser, { sourcePriority: ['mp4'], dubbing: { tracks: TRACKS } });
    await menu(page, 'Ses / Dil', 'English');
    await page.waitForFunction(() => document.getElementById('player').sourceManager.currentSrc?.includes('lang=en'), null, { timeout: 8000 });
    await page.evaluate(() => {
        const el = document.getElementById('player');
        const film = (lang) => [{ src: `/sample-240p.mp4?film=2&lang=${lang}`, label: '360p' }];
        el.options = { ...el.options, dubbing: { tracks: [{ label: 'Deutsch', srclang: 'de', sources: film('de') }, { label: 'Français', srclang: 'fr', default: true, sources: film('fr') }] } };
    });
    await page.waitForFunction(() => document.getElementById('player').sourceManager.currentSrc?.includes('film=2'), null, { timeout: 8000 });
    await page.waitForTimeout(500);
    const p = await playing(page);
    const m = await menu(page, 'Ses / Dil');
    ok(p.lang === 'fr', `yeni filmin varsayılan dili (lang=${p.lang})`);
    ok(m.value === 'FR' && m.rows.some((r) => r.startsWith('Deutsch')) && !m.rows.some((r) => r.startsWith('English')), `menü yeni dillerle (${m.value}: ${m.rows.join(', ')})`);
    await context.close();
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testLegacy(browser);
        await testNewFilm(browser);
        if (only(['chromium', 'firefox'], 'Playwright WebKit derlemesinde HLS yok')) {
            await testPerLanguageSources(browser);
            await testPerLanguageFallback(browser);
            await testKeepFormatAndQuality(browser);
        }
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
