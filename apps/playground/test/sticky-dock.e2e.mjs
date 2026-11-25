// Sticky dock: tutup sürükleme (bırakınca en yakın köşeye oturur), köşeden boyutlandırma, tercih hatırlama.
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

/** ?feature=sticky sayfasını açar, oynatır ve player'ı köşeye yapıştırır. */
async function stuck(context, sticky, { play = true } = {}) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((sticky) => {
        const top = document.createElement('div');
        top.style.height = '1200px';
        document.body.insertBefore(top, document.body.firstChild);
        const bottom = document.createElement('div');
        bottom.style.height = '1200px';
        document.body.appendChild(bottom);
        const el = document.getElementById('player');
        // Sticky ilk verilişte kurulur — seçenekler baştan.
        el.options = { src: '/sample-30s.mp4', muted: true, sticky: { minPlayMs: 0, dismissMode: 'none', ...sticky } };
        el.scrollIntoView({ block: 'center' });
    }, sticky ?? {});
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2);
    await page.waitForTimeout(400);
    if (play) {
        await page.mouse.move(5, 5);
        await page.mouse.down();
        await page.mouse.up();
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
        await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused);
        await page.waitForTimeout(400);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.getElementById('player').hasAttribute('data-sticky'), null, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    return page;
}

const info = (page) =>
    page.evaluate(() => {
        const el = document.getElementById('player');
        const r = el.getBoundingClientRect();
        const v = el.shadowRoot.querySelector('video');
        const handles = [...el.shadowRoot.querySelectorAll('.hp-sticky-resize')].filter((h) => getComputedStyle(h).display !== 'none').map((h) => h.dataset.c);
        return { corner: el.getAttribute('data-sticky-corner'), left: r.left, top: r.top, right: innerWidth - r.right, bottom: innerHeight - r.bottom, width: r.width, ratio: r.width / r.height, paused: v.paused, handles };
    });

/** Player'ın üst-orta noktasından (kontrollerin dışından) sürükler. */
async function drag(page, toX, toY) {
    const r = await info(page);
    const x = r.left + r.width / 2;
    const y = r.top + 30;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (toX - x) / 2, y + (toY - y) / 2, { steps: 5 });
    await page.mouse.move(toX, toY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    // Köşeye kayma animasyonu yavaş makinede uzar — bitmesini bekle.
    await page.waitForFunction(() => !document.getElementById('player').getAnimations().length, null, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(50);
}

/** Köşe tutamacını (dx, dy) kadar çeker. */
async function pull(page, c, dx, dy) {
    // Duraklatıp oynatınca köşeden ayrılıp yeniden yapışır — tutamaç yavaş makinede biraz sonra gelir.
    await page.waitForFunction((c) => {
        const h = document.getElementById('player').shadowRoot.querySelector(`.hp-sticky-resize[data-c="${c}"]`);
        return !!h && getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().width > 0;
    }, c, { timeout: 5000 });
    const box = await page.evaluate((c) => {
        const h = document.getElementById('player').shadowRoot.querySelector(`.hp-sticky-resize[data-c="${c}"]`);
        const r = h.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, c);
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + dx / 2, box.y + dy / 2, { steps: 4 });
    await page.mouse.move(box.x + dx, box.y + dy, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(200);
}

async function testDragAndResize(browser) {
    console.log('\n[1] Sürükle-bırak köşeye oturur, oynatma sürer; köşeden boyutlandırma oranı korur; tercih hatırlanır');
    const context = await browser.newContext();
    const page = await stuck(context);
    const a = await info(page);
    ok(a.corner === 'br' && Math.round(a.right) === 16 && Math.round(a.bottom) === 16, `varsayılan sağ alt (${JSON.stringify(a)})`);
    ok(a.handles.sort().join() === 'bl,tl,tr', `ekrana yapışık köşe dışında üç tutamaç (${a.handles})`);

    await drag(page, 200, 150);
    const b = await info(page);
    ok(b.corner === 'tl' && Math.round(b.left) === 16 && Math.round(b.top) === 16, `sol üste bırakıldı → sol üst köşeye oturdu (${b.corner} ${b.left},${b.top})`);
    ok(!b.paused, 'sürüklemenin sonundaki tıklama oynatmayı durdurmadı');
    const ev = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
    ok(ev.includes('sticky:true'), 'köşe değişince hp:sticky yayıldı');

    await drag(page, 1100, 120);
    ok((await info(page)).corner === 'tr', 'sağ üste bırakıldı → sağ üst');
    await drag(page, 150, 700);
    ok((await info(page)).corner === 'bl', 'sol alta bırakıldı → sol alt');

    // Kısa tıklama hâlâ oynat / duraklat yapar.
    const c = await info(page);
    await page.mouse.click(c.left + c.width / 2, c.top + 30);
    await page.waitForTimeout(300);
    ok((await info(page)).paused, 'sürüklemeden tıklama duraklattı');
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    // Oynatma sürünce yeniden köşeye yapışması beklenir (requirePlaying: duraklatınca ayrılır).
    await page.waitForFunction(() => document.getElementById('player').hasAttribute('data-sticky') && !document.getElementById('player').shadowRoot.querySelector('video').paused, null, { timeout: 5000 });
    await page.waitForFunction(() => !document.getElementById('player').getAnimations().length, null, { timeout: 3000 }).catch(() => {});

    // Sol altta: sağ üst tutamaçla büyüt.
    const w0 = (await info(page)).width;
    await pull(page, 'tr', 150, -80);
    const d = await info(page);
    ok(d.width > w0 + 100 && Math.abs(d.ratio - 16 / 9) < 0.03, `büyüdü, oran korundu (${Math.round(w0)} → ${Math.round(d.width)}, oran ${d.ratio.toFixed(3)})`);
    ok(d.corner === 'bl' && Math.round(d.left) === 16 && Math.round(d.bottom) === 16, 'yapışık köşe yerinde kaldı');
    await pull(page, 'tr', -420, 200);
    ok(Math.round((await info(page)).width) === 200, `en küçük genişlik 200 (${Math.round((await info(page)).width)})`);
    await pull(page, 'tr', 900, -500);
    ok(Math.round((await info(page)).width) === 640, `en büyük genişlik 640 (${Math.round((await info(page)).width)})`);
    await pull(page, 'tr', -240, 0);
    const saved = Math.round((await info(page)).width);
    ok(Math.abs(saved - 400) <= 2, `yalnızca yatay çekişle de küçülüyor (640 → ${saved})`);

    // Kapat butonu tutamaçla örtülmüyor.
    const closeHit = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const b = r.querySelector('[part="sticky-close-button"]').getBoundingClientRect();
        return !!r.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('[part="sticky-close-button"]');
    });
    ok(closeHit, 'kapat butonu tıklanabilir (tutamaç örtmüyor)');
    const covered = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        return [...r.querySelectorAll('button')]
            .filter((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden' && b.getAttribute('part') !== 'center-play-button')
            .filter((b) => {
                const x = b.getBoundingClientRect();
                return r.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2)?.closest('button') !== b;
            })
            .map((b) => b.getAttribute('aria-label') || b.getAttribute('part'));
    });
    ok(covered.length === 0, `hiçbir buton örtülmüyor (${JSON.stringify(covered)})`);

    // Yeniden yükleyince köşe ve boyut hatırlanır.
    await page.close();
    const p2 = await stuck(context);
    const e = await info(p2);
    ok(e.corner === 'bl' && Math.round(e.width) === saved, `yeniden yüklenince sol alt ve ${saved}px hatırlandı (${e.corner}, ${Math.round(e.width)})`);
    await p2.close();
    await context.close();
}

async function testDisabled(browser) {
    console.log('\n[2] draggable: false / resizable: false → sürüklenmez, tutamaç yok; rememberPosition: false kaydetmez');
    const context = await browser.newContext();
    const page = await stuck(context, { draggable: false, resizable: false, rememberPosition: false });
    const a = await info(page);
    ok(a.handles.length === 0, 'tutamaç yok');
    await drag(page, 200, 150);
    ok((await info(page)).corner === 'br', 'sürükleme köşeyi değiştirmedi');
    await page.close();
    const p2 = await stuck(context, { rememberPosition: false });
    await drag(p2, 200, 150);
    const stored = await p2.evaluate(() => localStorage.getItem('hope_sticky_corner'));
    ok((await info(p2)).corner === 'tl' && stored === null, `sürüklendi ama kaydedilmedi (${stored})`);
    await p2.close();
    await context.close();
}

async function testTouch(browser) {
    console.log('\n[3] Telefonda parmakla sürükleme: köşeye oturur, sayfa kaymaz');
    if (!only(['chromium'], 'CDP ile dokunma olayları')) return;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await stuck(context);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const cdp = await context.newCDPSession(page);
    const a = await info(page);
    const scroll0 = await page.evaluate(() => scrollY);
    const x = a.left + a.width / 2;
    const y = a.top + 30;
    const touch = (type, px, py) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }] });
    await touch('touchStart', x, y);
    for (let i = 1; i <= 8; i++) await touch('touchMove', x - (x - 60) * (i / 8), y - (y - 120) * (i / 8));
    await touch('touchEnd');
    await page.waitForTimeout(400);
    const b = await info(page);
    ok(b.corner === 'tl', `parmakla sol üste sürüklendi (${a.corner} → ${b.corner})`);
    ok((await page.evaluate(() => scrollY)) === scroll0, 'sürüklerken sayfa kaymadı');
    ok(!b.paused, 'oynatma sürüyor');
    await page.close();
    await context.close();
}

const isSticky = (page) => page.evaluate(() => document.getElementById('player').hasAttribute('data-sticky'));
const scrollAway = async (page) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
};
const scrollBack = async (page) => {
    await page.evaluate(() => document.getElementById('player').parentElement.querySelector('[data-hope-sticky-placeholder]')?.scrollIntoView({ block: 'center' }) ?? document.getElementById('player').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
};

async function testRequirePlaying(browser) {
    console.log('\n[4] requirePlaying: false → oynamamış ve duraklatılmış player da köşeye yapışır; varsayılanda yapışmaz');
    const context = await browser.newContext();
    const page = await stuck(context, { requirePlaying: false }, { play: false });
    ok(await isSticky(page), 'hiç oynatılmamışken görünümden çıkınca yapıştı');
    ok(await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused), 'video oynamıyor');
    // Başlamamış player'da ortadaki oynat butonu tüm alanı kaplar — yine de sürüklenir, sürükleme oynatmaz.
    await drag(page, 200, 150);
    const d = await info(page);
    ok(d.corner === 'tl' && d.paused, `oynatılmamış player sürüklendi, video başlamadı (${d.corner}, paused ${d.paused})`);
    await page.mouse.click(d.left + d.width / 2, d.top + d.width / d.ratio / 2);
    await page.waitForTimeout(400);
    ok(!(await info(page)).paused, 'kısa tıklama oynattı');
    await scrollBack(page);
    ok(!(await isSticky(page)), 'geri dönünce yerine oturdu');
    await page.close();

    const p2 = await stuck(context, {}, { play: false });
    ok(!(await isSticky(p2)), 'varsayılan (requirePlaying: true): oynamayan player yapışmadı');
    await p2.close();

    // Oynatıp duraklat, sonra kaydır.
    const p3 = await stuck(context, { requirePlaying: false }, { play: false });
    await scrollBack(p3);
    await p3.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await p3.waitForTimeout(300);
    await p3.mouse.click(5, 5);
    await p3.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
    await scrollAway(p3);
    ok(await isSticky(p3), 'kullanıcı duraklattıktan sonra da yapıştı');
    await p3.close();
    await context.close();
}

async function testCloseOnEnd(browser) {
    console.log('\n[5] closeOnEnd: varsayılanda video bitince sticky kapanır; false iken köşede kalır');
    const context = await browser.newContext();
    for (const [closeOnEnd, expectSticky] of [[undefined, false], [false, true]]) {
        const page = await stuck(context, closeOnEnd === undefined ? {} : { closeOnEnd });
        ok(await isSticky(page), 'oynarken yapıştı');
        await page.evaluate(() => { const v = document.getElementById('player').shadowRoot.querySelector('video'); v.currentTime = v.duration - 0.5; });
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').ended, null, { timeout: 5000 });
        await page.waitForTimeout(300);
        ok((await isSticky(page)) === expectSticky, `closeOnEnd ${closeOnEnd ?? '(varsayılan)'} → bitince ${expectSticky ? 'köşede kaldı' : 'kapandı'}`);
        await page.close();
    }
    await context.close();
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testDragAndResize(browser);
        await testDisabled(browser);
        await testTouch(browser);
        await testRequirePlaying(browser);
        await testCloseOnEnd(browser);
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
