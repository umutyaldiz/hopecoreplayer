// HopeCorePlayer — ads.notices: "Reklam yükleniyor…", "Reklam yok", dolu gelince geri sayım + geçiş; varsayılan kapalı.
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

async function open(browser, scenario) {
    const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.addInitScript(MOCK_IMA);
    await page.addInitScript(() => {
        window.__ev = [];
        for (const t of ['hp:adstart', 'hp:aderror']) document.addEventListener(t, (e) => window.__ev.push({ t, d: e.detail }), true);
    });
    await page.goto(`${BASE}/?ads=${scenario}`);
    await page.waitForFunction(() => window.__mockIma.adsLoaderInstances.length > 0, null, { timeout: 8000 });
    return page;
}

const state = (page) =>
    page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const n = root.querySelector('.hp-ad-notice');
        const c = root.querySelector('.hp-ad-curtain');
        return {
            visible: !!n?.hasAttribute('data-visible'),
            kind: n?.getAttribute('data-kind') ?? null,
            text: n?.textContent ?? null,
            position: n?.getAttribute('data-position') ?? null,
            curtain: c ? { kind: c.getAttribute('data-kind'), closed: c.hasAttribute('data-closed') } : null,
            starts: window.__adsLog.filter((e) => e.ev === 'adsManager.start').length,
            requests: window.__adsLog.filter((e) => e.ev === 'requestAds').length,
            paused: document.getElementById('player').shadowRoot.querySelector('video').paused,
            events: window.__ev.slice(),
        };
    });

const play = (page) => page.evaluate(() => document.getElementById('player').play());
const waitRequest = (page) => page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), null, { timeout: 5000 });
const loadAd = (page) =>
    page.evaluate(() => {
        const mgr = new window.google.ima.AdsManager();
        window.__mockIma.adsManagerInstances.push(mgr);
        window.__mockIma.adsLoaderInstances[0].dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
    });
const adStarts = (page) =>
    page.evaluate(() => {
        const mgr = window.__mockIma.adsManagerInstances[0];
        mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
        mgr.dispatch('started', new window.google.ima.AdEvent('started'));
    });

async function testCountdown(browser) {
    console.log('\n[1] Oynat → "Reklam yükleniyor…"; dolu gelince 3 sn geri sayım, perde (fade), sonra reklam; perde reklamla açılır');
    const page = await open(browser, 'notices');
    try {
        let s = await state(page);
        ok(!s.visible, 'oynatmadan önce bildirim yok');
        await play(page);
        await waitRequest(page);
        await page.waitForTimeout(150);
        s = await state(page);
        ok(s.visible && s.kind === 'loading' && s.text === 'Reklam yükleniyor…', `yükleniyor (${s.text})`);
        ok(s.position === 'bottom-right', 'varsayılan konum sağ alt');

        await loadAd(page);
        await page.waitForTimeout(150);
        s = await state(page);
        ok(s.kind === 'countdown' && s.text.includes('Reklama 3 saniye kaldı') && s.starts === 0, `geri sayım başladı, reklam bekliyor (${s.text})`);
        await page.waitForTimeout(1000);
        s = await state(page);
        ok(s.text.includes('Reklama 2 saniye kaldı') && s.starts === 0, `sayıyor (${s.text})`);
        await page.waitForTimeout(2100);
        s = await state(page);
        ok(!s.visible && s.curtain?.kind === 'fade' && s.curtain.closed, 'sayım bitti: bildirim kalktı, perde kapandı');
        await page.waitForTimeout(500);
        s = await state(page);
        ok(s.starts === 1, 'perde kapandıktan sonra reklam başlatıldı');
        ok(!s.events.some((e) => e.d?.message === 'preroll-timeout'), 'geri sayım preroll zaman aşımına sayılmadı');

        await adStarts(page);
        await page.waitForTimeout(600);
        s = await state(page);
        ok(!s.curtain, 'reklam başlayınca perde açıldı ve kaldırıldı');
        ok(page.__errors.length === 0, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.context().close();
    }
}

async function testNoFill(browser) {
    console.log('\n[2] Reklam gelmedi (no-fill) → "Reklam yok, video başlıyor", içerik başlar, bildirim kendiliğinden kalkar');
    const page = await open(browser, 'notices');
    try {
        await play(page);
        await waitRequest(page);
        await page.evaluate(() => window.__mockIma.adsLoaderInstances[0].dispatch('adError', new window.google.ima.AdErrorEvent('no-fill')));
        await page.waitForTimeout(300);
        let s = await state(page);
        ok(s.visible && s.kind === 'empty' && s.text === 'Reklam yok, video başlıyor', `reklam yok (${s.text})`);
        ok(!s.paused, 'içerik başladı');
        await page.waitForTimeout(2800);
        s = await state(page);
        ok(!s.visible, 'bildirim kalktı');
    } finally {
        await page.context().close();
    }
}

async function testTimeout(browser) {
    console.log('\n[3] Preroll zaman aşımı → "Reklam yok"');
    const page = await open(browser, 'notices-timeout');
    try {
        await play(page);
        await waitRequest(page);
        await page.waitForTimeout(1100);
        const s = await state(page);
        ok(s.kind === 'empty' && s.visible, `zaman aşımında reklam yok (${s.text})`);
        ok(s.events.some((e) => e.d?.message === 'preroll-timeout'), 'hp:aderror preroll-timeout');
    } finally {
        await page.context().close();
    }
}

async function testCustomAndPause(browser) {
    console.log('\n[4] countdown: 2, transition: wipe, position: top-left; geri sayımda duraklat → reklam bekler, oynatınca yeniden sayar');
    const page = await open(browser, 'notices-custom');
    try {
        await play(page);
        await waitRequest(page);
        await loadAd(page);
        await page.waitForTimeout(150);
        let s = await state(page);
        ok(s.position === 'top-left' && s.text.includes('Reklama 2 saniye kaldı'), `özel konum ve süre (${s.position}, ${s.text})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"]').click());
        await page.waitForTimeout(2700);
        s = await state(page);
        ok(s.starts === 0 && !s.curtain, 'duraklatıldı: reklam başlamadı, perde açık');
        await play(page);
        await page.waitForTimeout(150);
        s = await state(page);
        ok(s.kind === 'countdown' && s.visible, 'yeniden oynat: geri sayım baştan');
        await page.waitForTimeout(2200);
        s = await state(page);
        ok(s.curtain?.kind === 'wipe', 'geçiş: wipe');
        await page.waitForTimeout(500);
        s = await state(page);
        ok(s.starts === 1, 'reklam başlatıldı');
    } finally {
        await page.context().close();
    }
}

async function testDefaultOff(browser) {
    console.log('\n[5] notices verilmedi → bildirim yok, reklam beklemeden başlar');
    const page = await open(browser, 'preroll-play');
    try {
        await play(page);
        await waitRequest(page);
        await loadAd(page);
        await page.waitForTimeout(200);
        const s = await state(page);
        ok(s.starts === 1, 'reklam hemen başladı');
        const has = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('.hp-ad-notice, .hp-ad-curtain'));
        ok(!has, 'bildirim / perde öğesi yok');
    } finally {
        await page.context().close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testCountdown(browser);
        await testNoFill(browser);
        await testTimeout(browser);
        await testCustomAndPause(browser);
        await testDefaultOff(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
