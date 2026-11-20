// HopeCorePlayer — reklam sırasında üstte yalnızca kontrol çubuğu kalır: devam bildirimi ve eklenti katmanları gizlenir.
import { readFileSync } from 'node:fs';
import { launchBrowser } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
const MOCK_IMA = readFileSync(new URL('./_mock-ima.js', import.meta.url), 'utf8');
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

/** Kayıtlı konumla (5. sn) ve preroll'lu açar; ileride eklenecek bir eklentiyi taklit eden katman da ekler. */
async function open(browser) {
    const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.addInitScript(MOCK_IMA);
    await page.addInitScript(() => {
        localStorage.setItem('hp-history-positions', JSON.stringify({ 'id:resume-demo': { t: 5, d: 10, at: Date.now() } }));
        window.__ev = [];
        for (const t of ['hp:adstart', 'hp:adend', 'hp:history']) document.addEventListener(t, (e) => window.__ev.push(t), true);
    });
    await page.goto(`${BASE}/?feature=resume&ads=preroll`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('.hp-history-notice'), null, { timeout: 8000 });
    await page.evaluate(() => {
        const area = document.getElementById('player').shadowRoot.querySelector('.video-area');
        const fake = document.createElement('div');
        fake.className = 'hp-fake-plugin';
        fake.style.cssText = 'position:absolute;top:10px;right:10px;z-index:24;width:80px;height:30px;background:red';
        area.appendChild(fake);
    });
    return page;
}

const state = (page) =>
    page.evaluate(() => {
        const host = document.getElementById('player');
        const root = host.shadowRoot;
        const shown = (el) => !!el && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
        return {
            dataAd: host.hasAttribute('data-ad'),
            notice: shown(root.querySelector('.hp-history-notice')),
            noticeText: root.querySelector('.hp-history-notice span')?.textContent ?? null,
            fake: shown(root.querySelector('.hp-fake-plugin')),
            chrome: shown(root.querySelector('.hp-chrome')),
            adLayer: shown(root.querySelector('[part="ad-layer"]')),
            events: window.__ev.slice(),
        };
    });

const startAd = (page) =>
    page.evaluate(() => {
        document.getElementById('player').play();
        const loader = window.__mockIma.adsLoaderInstances[0];
        const mgr = new window.google.ima.AdsManager();
        window.__mockIma.adsManagerInstances.push(mgr);
        loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
        mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
    });
const endAd = (page) =>
    page.evaluate(() => window.__mockIma.adsManagerInstances[0].dispatch('contentResumeRequested', new window.google.ima.AdEvent('contentResumeRequested')));

async function testResumeNoticeDuringPreroll(browser) {
    console.log('\n[1] Kaldığı yerden devam + preroll: bildirim ve eklenti katmanları reklamın üstünde değil, reklam bitince geri geliyor');
    const page = await open(browser);
    try {
        let s = await state(page);
        ok(s.notice && /0:05/.test(s.noticeText ?? ''), `açılışta devam bildirimi (${s.noticeText})`);
        ok(!s.dataAd && s.fake, 'reklam yokken data-ad yok, katmanlar görünür');

        await startAd(page);
        await page.waitForTimeout(300);
        s = await state(page);
        ok(s.events.includes('hp:adstart') && s.adLayer, 'preroll başladı (reklam katmanı açık)');
        ok(s.dataAd, 'reklam süresince player\'da data-ad');
        ok(!s.notice, 'devam bildirimi reklamın üstünde değil');
        ok(!s.fake, 'diğer eklenti katmanı da reklam sırasında gizli');
        ok(s.chrome, 'kontrol çubuğu katmanı görünür kalıyor');

        // Bildirimin 8 sn'lik süresi reklam boyunca dolsa da reklam bitince yeniden çıkmalı.
        await page.waitForTimeout(400);
        await endAd(page);
        await page.waitForTimeout(400);
        s = await state(page);
        ok(!s.dataAd && s.events.includes('hp:adend'), 'reklam bitti, data-ad kalktı');
        ok(s.notice && /0:05/.test(s.noticeText ?? ''), `reklamdan sonra devam bildirimi yeniden göründü (${s.noticeText})`);
        ok(s.fake, 'eklenti katmanı reklamdan sonra geri geldi');
        ok(page.__errors.length === 0, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.context().close();
    }
}

async function testOverlayAdKeepsNotice(browser) {
    console.log('\n[2] Overlay (doğrusal olmayan) reklam bildirimi gizlemiyor; "Baştan başla" bekleyen bildirimi iptal ediyor');
    const page = await open(browser);
    try {
        await page.evaluate(() => document.getElementById('player').dispatchEvent(new CustomEvent('hp:adstart', { detail: { type: 'midroll', linear: false } })));
        await page.waitForTimeout(200);
        let s = await state(page);
        ok(s.notice && !s.dataAd, 'overlay reklamda bildirim yerinde, data-ad yok');

        // İzleyici reklamdan önce "Baştan başla" dedi: bildirim kapandı, reklam bitince geri gelmemeli.
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-history-restart')?.click());
        await startAd(page);
        await page.waitForTimeout(200);
        await endAd(page);
        await page.waitForTimeout(300);
        s = await state(page);
        ok(!s.notice && s.events.includes('hp:adend'), '"Baştan başla" sonrası reklam bitince bildirim geri gelmedi');
    } finally {
        await page.context().close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testResumeNoticeDuringPreroll(browser);
        await testOverlayAdKeepsNotice(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
