// @hopeplayer/vue: yalnızca verilen prop'lar .options'a geçmeli. Vue, verilmeyen `boolean` tipli prop'u `false` yapar
// (boolean casting) — eskiden bu yüzden Vue'da videoya tıklamak oynatmıyordu (tapToPlay: false), imleç gizlenmiyordu
// (cursorHideDelayMs: false), kalite rozeti çıkmıyordu (qualityBadge: false).
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

(async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    try {
        console.log('\n[1] Verilmeyen boolean prop\'lar options\'a false olarak geçmiyor; verilenler geçiyor; değişiklik izleniyor');
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(`${BASE}/vue-wrapper.html`);
        const ready = await page.waitForFunction(() => document.querySelector('hope-player')?.options?.src, null, { timeout: 15000 }).then(() => true, () => false);
        if (!ready) throw new Error(`player options almadı — sayfa hataları: ${JSON.stringify(errors).slice(0, 600)} · DOM: ${(await page.content()).slice(0, 300)}`);
        let opts = await page.evaluate(() => document.querySelector('hope-player').options);
        ok(JSON.stringify(Object.keys(opts).sort()) === '["muted","src"]', `yalnızca verilenler: ${JSON.stringify(Object.keys(opts))}`);
        ok(opts.src === '/sample.mp4' && opts.muted === true, 'src ve muted geçti');

        await page.evaluate(() => (window.__vueProps.qualityBadge = false));
        await page.waitForTimeout(200);
        opts = await page.evaluate(() => document.querySelector('hope-player').options);
        ok(opts.qualityBadge === false, `açıkça verilen false geçti (qualityBadge=${opts.qualityBadge})`);

        console.log('\n[2] Davranış: videoya tıklamak oynatıyor (tapToPlay varsayılanı), kalite rozeti görünüyor');
        await page.evaluate(() => delete window.__vueProps.qualityBadge);
        await page.waitForFunction(() => document.querySelector('hope-player').shadowRoot.querySelector('video').videoWidth > 0, null, { timeout: 10000 });
        await page.waitForTimeout(300);
        const badge = await page.evaluate(() => {
            const b = document.querySelector('hope-player').shadowRoot.querySelector('[part="quality-badge"]');
            return { hidden: b?.hidden, text: b?.textContent };
        });
        ok(badge.hidden === false && badge.text === 'HD', `rozet görünüyor ${JSON.stringify(badge)}`);
        const video = await page.evaluateHandle(() => document.querySelector('hope-player').shadowRoot.querySelector('video'));
        const box = await video.boundingBox();
        await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.3);
        await page.waitForTimeout(500);
        const paused = await page.evaluate(() => document.querySelector('hope-player').shadowRoot.querySelector('video').paused);
        ok(!paused, 'tıklayınca oynadı');
    } finally {
        await page.close();
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
