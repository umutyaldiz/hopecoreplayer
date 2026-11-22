// Ortam ışığı (options.ambient): varsayılan kapalı; kare yalnızca oynarken, görünürken, tam ekran dışında
// ve pil düşük değilken seyrek alınır. Kare alımı drawImage(video) çağrıları sayılarak ölçülür.
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

async function open(browser, options, { battery } = {}) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const page = await context.newPage();
    await page.addInitScript((battery) => {
        window.__draws = 0;
        window.__chunks = [];
        const orig = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
            if (src instanceof HTMLVideoElement) window.__draws++;
            return orig.call(this, src, ...rest);
        };
        if (battery) {
            const b = Object.assign(new EventTarget(), battery);
            navigator.getBattery = () => Promise.resolve(b);
            window.__battery = b;
        }
    }, battery ?? null);
    page.on('request', (r) => {
        if (/ambient-/.test(r.url())) page.evaluate(() => window.__chunks.push('ambient')).catch(() => {});
    });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((options) => {
        document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, ...options };
    }, options);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2);
    await page.waitForTimeout(400);
    return { context, page };
}

const state = (page) =>
    page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const layer = r.querySelector('.hp-ambient');
        return {
            layer: !!layer,
            shown: !!layer && getComputedStyle(layer).display !== 'none',
            on: r.querySelectorAll('.hp-ambient canvas[data-on]').length,
            draws: window.__draws,
        };
    });
const play = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
const pause = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
const drawsDuring = async (page, ms) => {
    const a = (await state(page)).draws;
    await page.waitForTimeout(ms);
    return (await state(page)).draws - a;
};

async function testDefaultOff(browser) {
    console.log('\n[1] Varsayılan kapalı: katman yok, parça indirilmiyor, kare alınmıyor');
    const { context, page } = await open(browser, {});
    await play(page);
    await page.waitForTimeout(1200);
    const s = await state(page);
    const chunks = await page.evaluate(() => window.__chunks);
    ok(!s.layer && s.draws === 0 && chunks.length === 0, `kapalı ${JSON.stringify({ ...s, chunks })}`);
    await context.close();
}

async function testPlayingOnly(browser) {
    console.log('\n[2] Açık: duraklatılmışken bir kare, oynarken seyrek güncelleme, duraklatınca durur');
    const { context, page } = await open(browser, { ambient: { updateMs: 500 } });
    const s0 = await state(page);
    ok(s0.layer && s0.shown && s0.on === 1, `katman kuruldu, ilk kare çizildi ${JSON.stringify(s0)}`);
    ok((await drawsDuring(page, 1200)) === 0, 'duraklatılmışken kare alınmıyor');
    await play(page);
    const playing = await drawsDuring(page, 2000);
    ok(playing >= 3 && playing <= 6, `oynarken 500 ms'de bir (2 sn'de ${playing} kare)`);
    await pause(page);
    await page.waitForTimeout(100);
    ok((await drawsDuring(page, 1200)) === 0, 'duraklatınca durdu');
    await page.evaluate(() => { document.getElementById('player').shadowRoot.querySelector('video').currentTime = 20; });
    await page.waitForTimeout(400);
    ok((await state(page)).draws > s0.draws, 'sarınca (duraklatılmışken) bir kez güncellendi');
    await context.close();
}

async function testDefaultInterval(browser) {
    console.log('\n[3] Varsayılan aralık 2 sn');
    const { context, page } = await open(browser, { ambient: true });
    await play(page);
    await page.waitForTimeout(200);
    const n = await drawsDuring(page, 4100);
    ok(n >= 1 && n <= 3, `4 sn'de ${n} kare`);
    await context.close();
}

async function testOutOfView(browser) {
    console.log('\n[4] Player ekran dışındayken güncelleme durur, dönünce sürer');
    const { context, page } = await open(browser, { ambient: { updateMs: 500 } });
    await page.evaluate(() => {
        const spacer = document.createElement('div');
        spacer.style.height = '3000px';
        document.body.appendChild(spacer);
    });
    await play(page);
    await page.evaluate(() => window.scrollTo(0, 2500));
    await page.waitForTimeout(300);
    ok((await drawsDuring(page, 1500)) === 0, 'ekran dışında kare alınmıyor');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    ok((await drawsDuring(page, 1500)) >= 2, 'görünür olunca yeniden güncelleniyor');
    await context.close();
}

async function testFullscreen(browser) {
    console.log('\n[5] Tam ekranda ışık gizli ve güncelleme yok');
    const { context, page } = await open(browser, { ambient: { updateMs: 500 }, fullscreenMode: 'browser' });
    await page.evaluate(() => {
        const host = document.getElementById('player');
        Object.defineProperty(host, 'requestFullscreen', { value: undefined, configurable: true });
        Object.defineProperty(host, 'webkitRequestFullscreen', { value: undefined, configurable: true });
    });
    await play(page);
    await page.keyboard.press('Tab');
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Tam ekran"]').click());
    await page.waitForTimeout(400);
    const s = await state(page);
    ok(!s.shown, 'tam ekranda katman gizli');
    ok((await drawsDuring(page, 1500)) === 0, 'tam ekranda kare alınmıyor');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok((await state(page)).shown && (await drawsDuring(page, 1500)) >= 2, 'çıkınca geri geldi');
    await context.close();
}

async function testLowBattery(browser) {
    console.log('\n[6] Düşük pilde (şarjda değil, %10) güncelleme durur; şarja takınca sürer');
    const { context, page } = await open(browser, { ambient: { updateMs: 500 } }, { battery: { charging: false, level: 0.1 } });
    await play(page);
    await page.waitForTimeout(300);
    ok((await drawsDuring(page, 1500)) === 0, 'düşük pilde kare alınmıyor');
    await page.evaluate(() => {
        window.__battery.charging = true;
        window.__battery.dispatchEvent(new Event('chargingchange'));
    });
    ok((await drawsDuring(page, 1500)) >= 2, 'şarja takılınca güncelleniyor');
    await context.close();
}

async function testToggleOff(browser) {
    console.log('\n[7] Seçenek kapatılınca katman kalkıyor, kontroller tıklanabilir kalıyor');
    const { context, page } = await open(browser, { ambient: true });
    const hit = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const b = r.querySelector('[part="play-pause-button"]').getBoundingClientRect();
        return !!r.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('[part="play-pause-button"]');
    });
    ok(hit, 'ışık açıkken oynat butonu tıklanabilir');
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { ...el.options, ambient: false };
    });
    await page.waitForTimeout(300);
    await play(page);
    const s = await state(page);
    ok(!s.layer && (await drawsDuring(page, 2500)) === 0, 'katman kaldırıldı, kare alınmıyor');
    await context.close();
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testDefaultOff(browser);
        await testPlayingOnly(browser);
        await testDefaultInterval(browser);
        await testOutOfView(browser);
        await testFullscreen(browser);
        await testLowBattery(browser);
        await testToggleOff(browser);
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
