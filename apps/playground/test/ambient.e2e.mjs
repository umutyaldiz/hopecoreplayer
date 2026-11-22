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
            if (src instanceof HTMLVideoElement) {
                window.__draws++;
                window.__last = { w: rest[2], filter: this.filter };
            }
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
            on: layer?.hasAttribute('data-on') ? 1 : 0,
            draws: window.__draws,
            fade: layer?.querySelector('canvas:last-child').getAnimations()[0]?.effect.getTiming().duration ?? null,
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
    const fade = (await state(page)).fade;
    ok(fade === 450, `geçiş bir sonraki kareye kadar sürüyor (500 ms → ${fade} ms)`);
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
    ok((await state(page)).fade === 1800, 'varsayılan geçiş 1.8 sn');
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

async function testLookOptions(browser) {
    console.log('\n[8] blur / saturation / brightness kareye uygulanır; duraklatılmışken değişince hemen yansır');
    const { context, page } = await open(browser, { ambient: { blur: 20, saturation: 2, brightness: 1.3 } });
    const a = await page.evaluate(() => window.__last);
    ok(a?.w === 4, `blur 20 → 4 px kare (${a?.w})`);
    ok(a?.filter === 'saturate(2) brightness(1.3)', `filtre uygulandı (${a?.filter})`);
    const before = (await state(page)).draws;
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { ...el.options, ambient: { blur: 1 } };
    });
    await page.waitForTimeout(300);
    const b = await page.evaluate(() => window.__last);
    ok((await state(page)).draws === before + 1 && b?.w === 64, `değişince bir kez yeniden çizildi (blur 1 → ${b?.w} px)`);
    ok(b?.filter === 'saturate(1.4) brightness(1)', `varsayılanlara döndü (${b?.filter})`);
    await context.close();
}

/** Ayarlar menüsündeki "Ortam ışığı" satırı: { found, value } ve istenirse tıklar. */
const menuRow = (page, click = false) =>
    page.evaluate(async (click) => {
        const r = document.getElementById('player').shadowRoot;
        r.querySelector('[aria-label="Ayarlar"]').click();
        await new Promise((x) => setTimeout(x, 100));
        const row = [...r.querySelectorAll('button, [role="menuitem"], [role="menuitemcheckbox"]')].find((b) => b.textContent.includes('Ortam ışığı'));
        const value = row?.textContent.replace('Ortam ışığı', '').trim() ?? null;
        if (row && click) row.click();
        r.querySelector('[aria-label="Ayarlar"]').click();
        return { found: !!row, value };
    }, click);

async function testMenuToggle(browser) {
    console.log('\n[9] Ayarlar menüsünden aç-kapa; tercih hatırlanır; menu: false satırı gizler');
    const { context, page } = await open(browser, { ambient: { updateMs: 500 } });
    const a = await menuRow(page);
    ok(a.found && a.value === 'Açık', `menüde satır var (${JSON.stringify(a)})`);
    await play(page);
    await menuRow(page, true);
    await page.waitForTimeout(200);
    const s = await state(page);
    const stored = await page.evaluate(() => localStorage.getItem('hp-ambient'));
    ok(s.on === 0 && stored === '0', `kapatıldı, ışık gizli, tercih saklandı (${stored})`);
    ok((await drawsDuring(page, 1500)) === 0, 'kapalıyken oynarken kare alınmıyor');
    ok((await menuRow(page)).value === 'Kapalı', 'menü "Kapalı" gösteriyor');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => { document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, ambient: { updateMs: 500 } }; });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2);
    await page.waitForTimeout(400);
    await play(page);
    ok((await drawsDuring(page, 1200)) === 0 && (await menuRow(page)).value === 'Kapalı', 'yeniden yüklenince kapalı kaldı');
    await menuRow(page, true);
    await page.waitForTimeout(200);
    ok((await state(page)).on === 1 && (await drawsDuring(page, 1200)) >= 2, 'menüden yeniden açıldı, güncelleniyor');
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { ...el.options, ambient: { menu: false } };
    });
    await page.waitForTimeout(200);
    ok(!(await menuRow(page)).found, 'menu: false → satır yok');
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
        await testLookOptions(browser);
        await testMenuToggle(browser);
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
