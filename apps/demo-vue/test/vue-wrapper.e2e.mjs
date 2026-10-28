// HopeCorePlayer — @hopeplayer/vue + apps/demo-vue Playwright doğrulama
// scripti. Gerçek bir Vite+Vue 3 prod build'i (preview server) hedefler —
// çalıştırmadan önce `npm run build --workspace=apps/demo-vue &&
// npm run preview --workspace=apps/demo-vue` (port 5193) başlatılmış olmalı.
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.env.HOPE_DEMO_VUE_PORT ?? 5193}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

async function openPage(browser) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
        const el = document.querySelector('hope-player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    return { page, consoleErrors };
}

async function testUpgradesAndNoErrors(browser) {
    console.log('\n[1] <hope-player> gerçek sınıfa upgrade oluyor, konsol hatası yok mu?');
    const { page, consoleErrors } = await openPage(browser);
    const upgraded = await page.evaluate(() => {
        const el = document.querySelector('hope-player');
        const Ctor = customElements.get('hope-player');
        return !!(el && Ctor && el instanceof Ctor);
    });
    ok(upgraded, 'hope-player instanceof customElements.get("hope-player")');
    ok(consoleErrors.length === 0, `konsol hatası yok (${consoleErrors.length})`);
    await page.close();
}

async function testImperativeRefApi(browser) {
    console.log('\n[2] Template ref üzerinden play()/pause() — defineExpose çalışıyor mu?');
    const { page } = await openPage(browser);
    await page.locator('button:has-text("play()")').click();
    await page.waitForFunction(() => !document.querySelector('hope-player').shadowRoot.querySelector('video').paused);
    ok(true, 'play() sonrası <video>.paused === false');

    await page.locator('button:has-text("pause()")').click();
    await page.waitForFunction(() => document.querySelector('hope-player').shadowRoot.querySelector('video').paused);
    ok(true, 'pause() sonrası <video>.paused === true');
    await page.close();
}

async function testEventEmitsReachVue(browser) {
    console.log('\n[3] hp:* CustomEvent\'leri Vue emit\'lerine ulaşıp olay günlüğüne yazılıyor mu?');
    const { page } = await openPage(browser);
    const log = await page.locator('pre').first().textContent();
    ok(log.includes('hp:ready'), '@ready → hp:ready günlükte');
    await page.close();
}

async function testThemePropReactivity(browser) {
    console.log('\n[4] Tema seçici (v-model) değişince prop reaktifliği <hope-player data-theme>\'i gerçekten güncelliyor mu?');
    const { page } = await openPage(browser);
    await page.locator('select').selectOption('neo-dark');
    const dataTheme = await page.evaluate(() => document.querySelector('hope-player').getAttribute('data-theme'));
    ok(dataTheme === 'neo-dark', `select "neo-dark" → data-theme="${dataTheme}"`);
    await page.close();
}

async function testPlaylistItemChangeEvent(browser) {
    console.log('\n[5] :playlist prop\'u ile kurulan ikinci player @itemchange yayıyor mu?');
    const { page } = await openPage(browser);
    const log = await page.locator('pre').first().textContent();
    ok(log.includes('hp:itemchange'), '@itemchange → hp:itemchange günlükte');
    await page.close();
}

(async () => {
    const browser = await chromium.launch();
    try {
        await testUpgradesAndNoErrors(browser);
        await testImperativeRefApi(browser);
        await testEventEmitsReachVue(browser);
        await testThemePropReactivity(browser);
        await testPlaylistItemChangeEvent(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
