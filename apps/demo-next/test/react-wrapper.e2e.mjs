// HopeCorePlayer — Faz 8 (@hopeplayer/react + apps/demo-next) Playwright
// doğrulama scripti. Diğer e2e'lerden farklı olarak bir Vite dev server
// değil, gerçek bir Next.js (App Router) prod build'i hedefler — bu yüzden
// çalıştırmadan önce elle `npm run build --workspace=apps/demo-next &&
// npm run start --workspace=apps/demo-next` (port 5190) başlatılmış olmalı
// (bkz. README "Faz 8" bölümü).
//
// En kritik senaryo burada "SSR çökmüyor" — @hopeplayer/core bir
// HTMLElement alt sınıfı tanımlıyor, bu yüzden Next'in sunucu render
// zincirinde STATİK import edilirse (document/HTMLElement olmayan bir
// ortamda) çöker. @hopeplayer/react bunu yalnızca client-side bir
// useEffect içindeki dynamic import() ile çözüyor (bkz.
// packages/react/src/HopePlayer.tsx) — bu test hem ham SSR HTML'de hem de
// gerçek tarayıcıda bunu doğruluyor.
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.env.HOPE_DEMO_NEXT_PORT ?? 5190}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

async function testSsrDoesNotCrash() {
    console.log('\n[1] SSR: ham HTML yanıtında çöküş yok, düz <hope-player> markup\'ı var mı?');
    const res = await fetch(`${BASE}/`);
    const html = await res.text();
    ok(res.status === 200, `GET / → ${res.status}`);
    ok(html.includes('<hope-player'), '<hope-player> SSR çıktısında mevcut');
    ok(!html.toLowerCase().includes('application error'), 'Next.js hata sayfası yok');
}

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

async function testCustomElementUpgrades(browser) {
    console.log('\n[2] Client-side hydration sonrası <hope-player>, SSR\'da basılan plain tag\'den gerçek sınıfa upgrade oluyor mu?');
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
    console.log('\n[3] ref üzerinden play()/pause() — HopePlayerHandle çalışıyor mu?');
    const { page } = await openPage(browser);
    await page.locator('button:has-text("play()")').click();
    await page.waitForFunction(() => !document.querySelector('hope-player').shadowRoot.querySelector('video').paused);
    ok(true, 'play() sonrası <video>.paused === false');

    await page.locator('button:has-text("pause()")').click();
    await page.waitForFunction(() => document.querySelector('hope-player').shadowRoot.querySelector('video').paused);
    ok(true, 'pause() sonrası <video>.paused === true');
    await page.close();
}

async function testEventCallbacksReachReact(browser) {
    console.log('\n[4] hp:* CustomEvent\'leri callback prop\'lara ulaşıp olay günlüğüne yazılıyor mu?');
    const { page } = await openPage(browser);
    const log = await page.locator('pre').first().textContent();
    ok(log.includes('hp:ready'), 'onReady → hp:ready günlükte');
    await page.close();
}

async function testThemeSwitchUpdatesOptions(browser) {
    console.log('\n[5] Tema seçici değişince <hope-player data-theme> gerçekten güncelleniyor mu?');
    const { page } = await openPage(browser);
    await page.locator('select').selectOption('neo-dark');
    const dataTheme = await page.evaluate(() => document.querySelector('hope-player').getAttribute('data-theme'));
    ok(dataTheme === 'neo-dark', `select "neo-dark" → data-theme="${dataTheme}"`);
    await page.close();
}

async function testPlaylistItemChangeEvent(browser) {
    console.log('\n[6] playlist prop\'u ile kurulan ikinci player hp:itemchange yayıyor mu?');
    const { page } = await openPage(browser);
    const log = await page.locator('pre').first().textContent();
    ok(log.includes('hp:itemchange'), 'onItemChange → hp:itemchange günlükte');
    await page.close();
}

(async () => {
    await testSsrDoesNotCrash();
    const browser = await chromium.launch();
    try {
        await testCustomElementUpgrades(browser);
        await testImperativeRefApi(browser);
        await testEventCallbacksReachReact(browser);
        await testThemeSwitchUpdatesOptions(browser);
        await testPlaylistItemChangeEvent(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
