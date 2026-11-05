// HopeCorePlayer — birden fazla biçimde kaynak: biçim grupları, sourcePriority ve ölümcül hatada yedek gruba geçiş.
// Playground çalışıyor olmalı (npm run dev --workspace=apps/playground, port HOPE_TEST_PORT ya da 5183).
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

/** `routes`: sayfa açılmadan önce kurulacak ağ engelleri, ör. HLS'i 404'e düşürmek. */
async function open(browser, query, routes) {
    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const page = await context.newPage();
    if (routes) await routes(context);
    await page.addInitScript(() => {
        window.__fb = [];
        document.addEventListener('DOMContentLoaded', () =>
            document.getElementById('player')?.addEventListener('hp:sourcefallback', (e) => window.__fb.push(e.detail))
        );
    });
    await page.goto(`${BASE}/?feature=fallback${query}`);
    await page.waitForTimeout(1500);
    return { page, context };
}

const state = (page) =>
    page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const v = r.querySelector('video');
        const src = v.currentSrc.startsWith('blob:') ? 'hls.js' : v.currentSrc.split('/').pop();
        return {
            src,
            readyState: v.readyState,
            time: v.currentTime,
            error: r.querySelector('[part="error-screen"]')?.hasAttribute('data-visible') ?? false,
            fallbacks: window.__fb.slice(),
        };
    });

const qualityRows = (page) =>
    page.evaluate(async () => {
        const r = document.getElementById('player').shadowRoot;
        r.querySelector('button[aria-label="Ayarlar"]').click();
        await new Promise((res) => setTimeout(res, 120));
        const q = [...r.querySelector('.hp-chip-panel').querySelectorAll('button')].find((b) => /^Kalite/.test(b.textContent));
        if (!q) {
            r.querySelector('button[aria-label="Ayarlar"]').click();
            return [];
        }
        q.click();
        await new Promise((res) => setTimeout(res, 120));
        const rows = [...r.querySelector('.hp-chip-panel').querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => !/Geri|Kalite/.test(t));
        r.querySelector('button[aria-label="Ayarlar"]').click();
        return rows;
    });

const hls404 = (ctx) => ctx.route(/\.m3u8/, (r) => r.fulfill({ status: 404, body: 'nope' }));
const mp4404 = (ctx) => ctx.route(/\.mp4(\?|$)/, (r) => r.fulfill({ status: 404, body: 'nope' }));

async function testDefaultOrder(browser) {
    console.log('\n[1] sourcePriority yok → listedeki ilk biçim (MP4); menüde yalnızca MP4 kaliteleri');
    const { page, context } = await open(browser, '');
    const s = await state(page);
    const rows = await qualityRows(page);
    ok(s.src === 'sample.mp4' && !s.error, `MP4 grubu çalıyor (${s.src})`);
    ok(rows.some((r) => r.startsWith('720p')) && rows.some((r) => r.startsWith('240p')) && !rows.some((r) => r.startsWith('Oto')), `menü: ${rows.join(', ')}`);
    await context.close();
}

async function testHlsPriority(browser) {
    console.log('\n[2] sourcePriority: hls,mp4 → HLS çalıyor; menüde HLS seviyeleri, MP4 etiketleri yok');
    if (!only(['chromium', 'firefox'], 'Playwright WebKit derlemesinde HLS yok (MSE de Apple yerel HLS oynatıcısı da yok); gerçek Safari ayrıca doğrulanır')) return;
    const { page, context } = await open(browser, '&priority=hls,mp4');
    const s = await state(page);
    const rows = await qualityRows(page);
    ok(s.src === 'hls.js' && !s.error && s.fallbacks.length === 0, `HLS grubu çalıyor (${s.src})`);
    ok(rows.some((r) => r.startsWith('360p')) && rows.some((r) => r.startsWith('240p')) && !rows.some((r) => r.startsWith('720p')), `menü (HLS seviyeleri): ${rows.join(', ')}`);
    await context.close();
}

async function testHlsFailsToMp4(browser) {
    console.log('\n[3] HLS yüklenemedi (404) → hata ekranı yok, MP4 kalitelerine geçildi');
    if (!only(['chromium', 'firefox'], 'Playwright WebKit derlemesinde HLS yok (MSE de Apple yerel HLS oynatıcısı da yok); gerçek Safari ayrıca doğrulanır')) return;
    const { page, context } = await open(browser, '&priority=hls,mp4', hls404);
    await page.waitForTimeout(1500);
    const s = await state(page);
    const rows = await qualityRows(page);
    ok(s.src === 'sample.mp4' && !s.error, `MP4'e düşüldü (${s.src}), hata ekranı: ${s.error}`);
    ok(s.fallbacks.length === 1 && s.fallbacks[0].from === 'hls' && s.fallbacks[0].to === 'mp4', `hp:sourcefallback ${JSON.stringify(s.fallbacks)}`);
    ok(rows.some((r) => r.startsWith('720p')) && rows.some((r) => r.startsWith('240p')) && !rows.some((r) => r.startsWith('360p')), `menü MP4: ${rows.join(', ')}`);
    await context.close();
}

async function testMp4FailsToHls(browser) {
    console.log('\n[4] Ters öncelik: MP4 yüklenemedi → HLS');
    if (!only(['chromium', 'firefox'], 'Playwright WebKit derlemesinde HLS yok (MSE de Apple yerel HLS oynatıcısı da yok); gerçek Safari ayrıca doğrulanır')) return;
    const { page, context } = await open(browser, '&priority=mp4,hls', mp4404);
    await page.waitForTimeout(1500);
    const s = await state(page);
    ok(s.src === 'hls.js' && !s.error && s.fallbacks[0]?.to === 'hls' && s.fallbacks[0]?.code === 4, `HLS'e düşüldü (${s.src}) ${JSON.stringify(s.fallbacks)}`);
    await context.close();
}

async function testMidPlayback(browser) {
    console.log('\n[5] Oynarken HLS koptu → MP4\'e geçildi, konum ve oynatma korundu');
    if (!only(['chromium', 'firefox'], 'Playwright WebKit derlemesinde HLS yok (MSE de Apple yerel HLS oynatıcısı da yok); gerçek Safari ayrıca doğrulanır')) return;
    const { page, context } = await open(browser, '&priority=hls,mp4');
    await page.evaluate(() => document.getElementById('player').play());
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime > 2, null, { timeout: 8000 });
    const before = await state(page);
    // Yayın koptu: hls.js'in yeniden denemeleri tükendi (örnek 10 sn, tamamı tamponda — ağdan düşürmek yerine olayı tetikle).
    await page.evaluate(() => {
        const hls = document.getElementById('player').hls;
        hls.trigger('hlsError', { type: 'networkError', details: 'fragLoadError', fatal: true });
    });
    await page.waitForTimeout(1500);
    const s = await state(page);
    const playing = await page.evaluate(() => !document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(before.src === 'hls.js' && s.src === 'sample.mp4' && !s.error, `HLS → ${s.src}, hata ekranı: ${s.error}`);
    ok(Math.abs(s.time - before.time) < 1.5 && playing, `konum korundu (${before.time.toFixed(1)} → ${s.time.toFixed(1)} sn), oynuyor: ${playing}`);
    await context.close();
}

async function testAllFail(browser) {
    console.log('\n[6] Tüm gruplar düştü → hata ekranı; "Tekrar dene" en öncelikli gruptan başlar');
    if (!only(['chromium', 'firefox'], 'Playwright WebKit derlemesinde HLS yok (MSE de Apple yerel HLS oynatıcısı da yok); gerçek Safari ayrıca doğrulanır')) return;
    let down = true;
    const { page, context } = await open(browser, '&priority=hls,mp4', async (ctx) => {
        await ctx.route(/\.m3u8|\.mp4(\?|$)/, (r) => (down ? r.fulfill({ status: 404, body: 'nope' }) : r.fallback()));
    });
    await page.waitForTimeout(1500);
    const s = await state(page);
    ok(s.error && s.fallbacks.length === 1, `hata ekranı açık, ${s.fallbacks.length} geçiş denendi`);
    down = false;
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-error-retry').click());
    await page.waitForTimeout(2000);
    const after = await state(page);
    ok(!after.error && after.src === 'hls.js', `tekrar dene → ${after.src} (HLS), hata ekranı kapandı`);
    await context.close();
}

async function testSkipUnsupported(browser) {
    console.log('\n[7] Tarayıcının oynatamadığı biçim denenmeden atlanır');
    const { page, context } = await open(browser, '');
    const unsupported = await page.evaluate(() => document.createElement('video').canPlayType('video/quicktime') === '');
    if (!unsupported) {
        console.log('  (bu tarayıcı video/quicktime diyor — atlandı)');
        await context.close();
        return;
    }
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { ...el.options, sources: [{ src: '/clip.mov', label: 'MOV' }, ...el.options.sources.map((s) => ({ ...s, src: s.src + '?fresh' }))], sourcePriority: ['mov', 'mp4'] };
    });
    await page.waitForTimeout(1200);
    const s = await state(page);
    ok(/^sample\.mp4/.test(s.src) && !s.error && s.fallbacks.some((f) => f.skipped && f.from === 'mov'), `mov atlandı → ${s.src} ${JSON.stringify(s.fallbacks)}`);
    await context.close();
}

(async () => {
    const browser = await launchBrowser({ autoplay: true });
    try {
        await testDefaultOrder(browser);
        await testHlsPriority(browser);
        await testHlsFailsToMp4(browser);
        await testMp4FailsToHls(browser);
        await testMidPlayback(browser);
        await testAllFail(browser);
        await testSkipUnsupported(browser);
    } finally {
        await browser.close();
    }
    console.log(failures ? `\n${failures} test başarısız` : '\nTümü geçti');
    process.exit(failures ? 1 : 0);
})();
