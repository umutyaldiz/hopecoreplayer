// Hız paneli (−/+, kaydırıcı, hazır hızlar), sabit ses, anlık görüntü, dokunma kilidi.
import { readFileSync } from 'node:fs';
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

async function open(browser, options) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, acceptDownloads: true });
    const page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', (e) => page.__errors.push(e.message));
    await page.addInitScript(() => {
        window.__chunks = [];
        window.__ev = [];
        window.__comp = 0;
        const AC = window.AudioContext;
        if (AC) {
            const orig = AC.prototype.createDynamicsCompressor;
            AC.prototype.createDynamicsCompressor = function () {
                window.__comp++;
                return orig.call(this);
            };
        }
    });
    page.on('request', (r) => {
        const m = /chunks\/(stableVolume|snapshot|touchLock|settingsPanels)-/.exec(r.url());
        if (m) page.evaluate((n) => window.__chunks.push(n), m[1]).catch(() => {});
    });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((options) => {
        const el = document.getElementById('player');
        for (const t of ['hp:snapshot', 'hp:touchlock', 'hp:stablevolume']) el.addEventListener(t, (e) => window.__ev.push({ t, d: e.detail }));
        el.options = { src: '/sample-30s.mp4', muted: true, ...options };
    }, options);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2);
    await page.waitForTimeout(400);
    return { context, page };
}

const root = 'document.getElementById("player").shadowRoot';
const openMenu = (page) => page.evaluate(`${root}.querySelector('[aria-label="Ayarlar"]').click()`);
const menuRows = (page) => page.evaluate(`Array.from(${root}.querySelectorAll('.hp-chip-panel button')).map((b) => b.textContent.trim())`);
const clickRow = (page, start) =>
    page.evaluate((start) => {
        const b = Array.from(document.getElementById('player').shadowRoot.querySelectorAll('.hp-chip-panel button')).find((x) => x.textContent.trim().startsWith(start));
        b?.click();
        return !!b;
    }, start);
const menuOpen = (page) => page.evaluate(`!${root}.querySelector('.hp-chip-panel').classList.contains('hp:hidden')`);

async function testSpeedPanel(browser) {
    console.log('\n[1] Hız paneli: değer, −/+ (0.05 adım), kaydırıcı, hazır hızlar; menü açık kalır');
    const { context, page } = await open(browser, {});
    await openMenu(page);
    await page.waitForTimeout(150);
    await clickRow(page, 'Oynatma Hızı');
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-speed'));
    const s = () =>
        page.evaluate(() => {
            const r = document.getElementById('player').shadowRoot;
            return {
                value: r.querySelector('.hp-speed-value').textContent,
                rate: r.querySelector('video').playbackRate,
                active: r.querySelector('.hp-speed-chip[data-active]')?.textContent ?? null,
                down: r.querySelector('.hp-speed-step').disabled,
                range: r.querySelector('.hp-speed-range').value,
            };
        });
    let a = await s();
    ok(a.value === '1.00x' && a.active === 'Normal', `açılışta 1.00x, Normal seçili (${JSON.stringify(a)})`);
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-speed-step')[1].click());
    a = await s();
    ok(a.rate === 1.05 && a.value === '1.05x' && a.active === null, `+ → 1.05x (${a.value})`);
    await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-speed-chip')].find((c) => c.textContent === '1.5').click());
    a = await s();
    ok(a.rate === 1.5 && a.active === '1.5' && a.range === '1.5', `hazır hız 1.5 (${JSON.stringify(a)})`);
    await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot.querySelector('.hp-speed-range');
        r.value = '0.5';
        r.dispatchEvent(new Event('input', { bubbles: true }));
    });
    a = await s();
    ok(a.rate === 0.5 && a.down, `kaydırıcı en alta → 0.5x, − pasif (${JSON.stringify(a)})`);
    ok(await menuOpen(page), 'menü açık kaldı');
    // Klavyeyle / dışarıdan hız değişince panel güncellenir.
    await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').playbackRate = 2));
    await page.waitForTimeout(300);
    a = await s();
    ok(a.value === '2.00x' && a.active === '2', `dışarıdan değişince panel güncellendi (${a.value})`);
    await clickRow(page, 'Oynatma Hızı'); // geri
    await page.waitForTimeout(100);
    const rows = await menuRows(page);
    ok(rows.some((r) => r.startsWith('Oynatma Hızı') && r.endsWith('2x')), `geri → ana menü, değer 2x (${rows[0]})`);
    ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    await context.close();
}

async function testStableVolume(browser) {
    console.log('\n[2] Sabit ses: menüde aç-kapa, seçim hatırlanır, kompresör yalnızca açılınca kurulur');
    {
        const { context, page } = await open(browser, {});
        await openMenu(page);
        await page.waitForTimeout(150);
        const rows = await menuRows(page);
        const chunks = await page.evaluate(() => window.__chunks);
        ok(!rows.some((r) => r.startsWith('Sabit ses')) && !chunks.includes('stableVolume'), 'varsayılan kapalı: satır yok, parça inmedi');
        await context.close();
    }
    const { context, page } = await open(browser, { stableVolume: true });
    await openMenu(page);
    await page.waitForTimeout(150);
    let rows = await menuRows(page);
    ok(rows.includes('Sabit sesKapalı'), `satır var, kapalı (${rows.find((r) => r.startsWith('Sabit'))})`);
    ok((await page.evaluate(() => window.__comp)) === 0, 'kapalıyken Web Audio kurulmadı');
    await clickRow(page, 'Sabit ses');
    await page.waitForTimeout(150);
    rows = await menuRows(page);
    const hasAudio = await page.evaluate(() => typeof AudioContext !== 'undefined');
    const row = rows.find((r) => r.startsWith('Sabit'));
    ok(row === (hasAudio ? 'Sabit sesAçık' : 'Sabit sesKullanılamaz'), `açıldı (${row})`);
    ok((await page.evaluate(() => localStorage.getItem('hp-stable-volume'))) === '1', 'seçim saklandı');
    if (hasAudio) ok((await page.evaluate(() => window.__comp)) === 1, 'kompresör kuruldu');
    ok((await page.evaluate(() => window.__ev.filter((e) => e.t === 'hp:stablevolume').map((e) => e.d.on))).join() === 'true', 'hp:stablevolume yayıldı');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => (document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, stableVolume: true }));
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2);
    await page.waitForTimeout(300);
    await openMenu(page);
    await page.waitForTimeout(150);
    rows = await menuRows(page);
    ok(rows.some((r) => r === (hasAudio ? 'Sabit sesAçık' : 'Sabit sesKullanılamaz')), 'yeniden yüklenince açık hatırlandı');
    if (hasAudio) ok((await page.evaluate(() => window.__comp)) === 1, 'hatırlanan seçimle kompresör kuruldu');
    ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    await context.close();
}

/** PNG başlığından genişlik / yükseklik. */
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

async function testSnapshot(browser) {
    console.log('\n[3] Anlık görüntü: buton, dosya adı penceresi, videonun kendi çözünürlüğünde PNG');
    const { context, page } = await open(browser, { snapshot: true });
    const btn = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="snapshot-button"]'));
    ok(btn, 'kontrol çubuğunda buton var');
    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        v.currentTime = 62 % v.duration;
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="snapshot-button"]').click());
    await page.waitForTimeout(200);
    const d = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const v = r.querySelector('video');
        const box = r.querySelector('[part="snapshot-dialog"]');
        return box && { name: box.querySelector('input').value, size: box.querySelector('.hp-snapshot-size').textContent, vw: v.videoWidth, vh: v.videoHeight, focused: r.activeElement === box.querySelector('input') };
    });
    ok(!!d && /^sample-30s-00m\d\ds$/.test(d.name) && d.focused, `pencere açıldı, ad önerildi ve seçili (${d?.name})`);
    ok(!!d && d.size === `${d.vw} × ${d.vh}`, `çözünürlük gösterildi (${d?.size})`);
    // Yazarken boşluk tuşu videoyu oynatmaz.
    const paused0 = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('kare 1');
    const paused1 = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(paused0 === paused1, 'yazarken player kısayolları çalışmadı');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    const file = await dl.path();
    const size = pngSize(readFileSync(file));
    ok(dl.suggestedFilename() === 'kare 1.png', `Enter ile indi: ${dl.suggestedFilename()}`);
    ok(size.w === d.vw && size.h === d.vh, `PNG videonun kendi çözünürlüğünde (${size.w}×${size.h})`);
    ok(!(await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="snapshot-dialog"]'))), 'pencere kapandı');
    const ev = await page.evaluate(() => window.__ev.find((e) => e.t === 'hp:snapshot')?.d);
    ok(ev?.width === d.vw && ev?.name === 'kare 1.png', `hp:snapshot yayıldı (${JSON.stringify(ev)})`);

    // Esc vazgeçer.
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="snapshot-button"]').click());
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    ok(!(await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="snapshot-dialog"]'))), 'Esc ile kapandı');

    // askName: false + jpeg → sormadan .jpg iner.
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { ...el.options, snapshot: { askName: false, format: 'jpeg', fileName: 'ekran' } };
    });
    await page.waitForTimeout(200);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="snapshot-button"]').click())]);
    const head = readFileSync(await dl2.path()).subarray(0, 3);
    ok(dl2.suggestedFilename() === 'ekran.jpg' && head[0] === 0xff && head[1] === 0xd8, `askName: false, jpeg → sormadan ${dl2.suggestedFilename()}`);
    ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    await context.close();
}

async function testTouchLock(browser) {
    console.log('\n[4] Dokunma kilidi: varsayılan yok; kilitliyken dokunuşlar yok sayılır, basılı tutunca açılır');
    {
        const { context, page } = await open(browser, {});
        await openMenu(page);
        await page.waitForTimeout(150);
        ok(!(await menuRows(page)).some((r) => r.startsWith('Ekranı kilitle')), 'varsayılan kapalı: satır yok');
        await context.close();
    }
    const { context, page } = await open(browser, { touchLock: { holdMs: 600 } });
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await openMenu(page);
    await page.waitForTimeout(150);
    ok(await clickRow(page, 'Ekranı kilitle'), 'menüde "Ekranı kilitle" var');
    await page.waitForTimeout(200);
    const st = () =>
        page.evaluate(() => {
            const r = document.getElementById('player').shadowRoot;
            const l = r.querySelector('[part="touch-lock"]');
            return { locked: !!l, hint: !!l?.hasAttribute('data-hint'), paused: r.querySelector('video').paused, menu: !r.querySelector('.hp-chip-panel').classList.contains('hp:hidden') };
        });
    let a = await st();
    ok(a.locked && !a.menu && !a.paused, `kilitlendi, menü kapandı, video sürüyor (${JSON.stringify(a)})`);
    const box = await page.evaluate(() => {
        const r = document.getElementById('player').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 3 };
    });
    await page.mouse.click(box.x, box.y);
    await page.mouse.dblclick(box.x, box.y);
    await page.waitForTimeout(300);
    a = await st();
    ok(a.locked && !a.paused && a.hint, `tıklama / çift tıklama yok sayıldı, rozet göründü (${JSON.stringify(a)})`);
    // Kısa basış açmaz.
    const badge = await page.evaluate(() => {
        const b = document.getElementById('player').shadowRoot.querySelector('.hp-touch-lock-badge').getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.move(badge.x, badge.y);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.up();
    ok((await st()).locked, 'kısa basış kilidi açmadı');
    await page.mouse.down();
    await page.waitForTimeout(750);
    await page.mouse.up();
    a = await st();
    ok(!a.locked && !a.paused, 'basılı tutunca açıldı, video sürüyor');
    const ev = await page.evaluate(() => window.__ev.filter((e) => e.t === 'hp:touchlock').map((e) => e.d.locked).join());
    ok(ev === 'true,false', `hp:touchlock yayıldı (${ev})`);
    ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    await context.close();
}

async function testTouchLockTouch(browser) {
    console.log('\n[5] Dokunma kilidi telefonda: dokunuşlar yok sayılır, sayfa kaymaz');
    if (!only(['chromium'], 'CDP ile dokunma olayları')) return;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => (document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, touchLock: true }));
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2);
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
        const r = document.getElementById('player').shadowRoot;
        r.querySelector('[aria-label="Ayarlar"]').click();
        await new Promise((x) => setTimeout(x, 150));
        [...r.querySelectorAll('.hp-chip-panel button')].find((b) => b.textContent.startsWith('Ekranı kilitle')).click();
    });
    await page.waitForTimeout(200);
    const cdp = await context.newCDPSession(page);
    const p = await page.evaluate(() => {
        const r = document.getElementById('player').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 3 };
    });
    for (let i = 0; i < 2; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(80);
    }
    await page.waitForTimeout(400);
    const a = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        return { locked: !!r.querySelector('[part="touch-lock"]'), paused: r.querySelector('video').paused, seek: r.querySelector('video').currentTime };
    });
    ok(a.locked && !a.paused, `çift dokunuş oynatmayı / sarmayı tetiklemedi (${JSON.stringify(a)})`);
    await context.close();
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testSpeedPanel(browser);
        await testStableVolume(browser);
        await testSnapshot(browser);
        await testTouchLock(browser);
        await testTouchLockTouch(browser);
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
