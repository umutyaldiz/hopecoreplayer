// HopeCorePlayer — çoklu kamera: kamera değişiminde senkron (PROGRAM-DATE-TIME ve offset), önizleme hizası,
// oynat / duraklat, bölünmüş ekran, poster önizleme, henüz başlamamış kamera.
// Test yayınları: public/multiview (scripts/make-multiview.mjs) — kamera N etkinliğin [0, 2, 1, 3][N-1]. saniyesinde başlar.
import { launchBrowser } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
const OFFSET = { cam1: 0, cam2: 2, cam3: 1, cam4: 3 };
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

async function open(browser, feature, viewport = { width: 960, height: 540 }) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => !/ResizeObserver loop/.test(String(e)) && errors.push(String(e)));
    page.__errors = errors;
    await page.goto(`${BASE}/?feature=${feature}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('.hp-mv-tile'), null, { timeout: 10000, polling: 50 });
    await page.evaluate(() => {
        window.__mv = [];
        document.getElementById('player').addEventListener('hp:multiview', (e) => window.__mv.push(e.detail));
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2, null, { timeout: 10000, polling: 50 });
    return page;
}

/** Ana kameranın etkinlik saniyesi ve önizlemelerinki. */
const state = (page) =>
    page.evaluate((OFFSET) => {
        const r = document.getElementById('player').shadowRoot;
        const v = r.querySelector('video');
        const active = r.querySelector('.hp-mv-tile[data-active]')?.getAttribute('data-cam') ?? window.__mv.filter((e) => e.state === 'switch').at(-1)?.id ?? 'cam1';
        const tiles = [...r.querySelectorAll('.hp-mv-tile')].map((t) => {
            const tv = t.querySelector('video');
            const id = t.getAttribute('data-cam');
            return {
                id,
                active: t.hasAttribute('data-active'),
                video: !!tv,
                img: !!t.querySelector('img'),
                waiting: t.hasAttribute('data-waiting'),
                badge: t.querySelector('.hp-mv-badge')?.textContent ?? '',
                event: tv && tv.readyState >= 1 ? tv.currentTime + OFFSET[id] : null,
                paused: tv ? tv.paused : null,
                rect: (() => {
                    const b = t.getBoundingClientRect();
                    return { w: Math.round(b.width), h: Math.round(b.height) };
                })(),
            };
        });
        const area = r.querySelector('.video-area').getBoundingClientRect();
        const vr = v.getBoundingClientRect();
        return {
            active,
            mainEvent: v.currentTime + OFFSET[active],
            t: v.currentTime,
            paused: v.paused,
            tiles,
            grid: r.querySelector('.video-area').hasAttribute('data-mv-grid'),
            mainShare: Math.round((vr.width / area.width) * 100),
            ev: window.__mv.slice(),
        };
    }, OFFSET);

const play = (page) => page.evaluate(() => document.getElementById('player').play());
const waitTime = (page, t) =>
    page.waitForFunction((t) => document.getElementById('player').shadowRoot.querySelector('video').currentTime >= t, t, { timeout: 15000, polling: 50 }).catch(() => {});

/** Kamera değiştir; tıklama anındaki etkinlik saniyesi + geçen gerçek süre beklenen konumdur. */
async function switchAndMeasure(page, id) {
    const before = await page.evaluate(
        ({ id, OFFSET }) => {
            const r = document.getElementById('player').shadowRoot;
            const v = r.querySelector('video');
            const active = r.querySelector('.hp-mv-tile[data-active]')?.getAttribute('data-cam') ?? window.__mv.filter((e) => e.state === 'switch').at(-1)?.id ?? 'cam1';
            const event = v.currentTime + OFFSET[active];
            window.__clickAt = performance.now();
            r.querySelector(`.hp-mv-tile[data-cam="${id}"]`).click();
            return event;
        },
        { id, OFFSET }
    );
    await page.waitForFunction((id) => window.__mv.some((e) => e.state === 'switch' && e.id === id), id, { timeout: 15000, polling: 50 });
    await page.waitForTimeout(300);
    return page.evaluate(
        ({ id, before, OFFSET }) => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            const elapsed = (performance.now() - window.__clickAt) / 1000;
            return { expected: before + elapsed, got: v.currentTime + OFFSET[id], paused: v.paused };
        },
        { id, before, OFFSET }
    );
}

async function testFocus(browser) {
    console.log('\n[1] Odak görünümü: kamera değişince aynı andan devam (saat etiketi ve offset), önizlemeler hizalı');
    const page = await open(browser, 'multiview');
    try {
        let s = await state(page);
        ok(s.tiles.length === 4 && s.tiles[0].active && s.tiles.filter((t) => t.video).length === 3, `4 küçük ekran, kamera 1 seçili, 3 önizleme akışı (${s.tiles.map((t) => t.id + (t.active ? '*' : '')).join(' ')})`);
        await play(page);
        await waitTime(page, 6);

        // Önizlemeler ana kamerayla aynı etkinlik saniyesinde.
        await page.waitForTimeout(1500);
        s = await state(page);
        const drift = s.tiles.filter((t) => t.event !== null && !t.waiting).map((t) => Math.abs(t.event - s.mainEvent));
        ok(drift.length === 3 && Math.max(...drift) < 0.9, `önizlemeler hizalı (fark ${drift.map((d) => d.toFixed(2)).join(', ')} sn)`);

        // Saat etiketli → saat etiketli.
        let m = await switchAndMeasure(page, 'cam2');
        ok(Math.abs(m.got - m.expected) < 0.8 && !m.paused, `kamera 2 (saat etiketi): beklenen ${m.expected.toFixed(2)}, olan ${m.got.toFixed(2)} sn`);
        s = await state(page);
        ok(s.tiles.find((t) => t.id === 'cam2')?.active && s.tiles.find((t) => t.id === 'cam2')?.badge === 'İzleniyor', 'kamera 2 seçili, "İzleniyor"');
        ok(s.ev.some((e) => e.state === 'switch' && e.id === 'cam2' && e.from === 'cam1' && e.layout === 'focus'), 'hp:multiview switch (from cam1)');

        // Saat etiketli → yalnızca offset.
        await page.waitForTimeout(800);
        m = await switchAndMeasure(page, 'cam4');
        ok(Math.abs(m.got - m.expected) < 0.8, `kamera 4 (offset): beklenen ${m.expected.toFixed(2)}, olan ${m.got.toFixed(2)} sn`);

        // Kodla.
        await page.evaluate(() => document.getElementById('player').switchCamera('cam3'));
        await page.waitForFunction(() => window.__mv.some((e) => e.id === 'cam3'), null, { timeout: 15000, polling: 50 });
        ok((await state(page)).active === 'cam3', 'switchCamera("cam3")');

        // Duraklat → önizlemeler de durur.
        await page.evaluate(() => document.getElementById('player').pause());
        await page.waitForTimeout(300);
        s = await state(page);
        ok(s.paused && s.tiles.filter((t) => t.video).every((t) => t.paused), 'duraklatınca önizlemeler de durdu');
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await page.close();
    }
}

async function testNotStarted(browser) {
    console.log('\n[2] Henüz başlamamış kamera: etkinliğin 0.5. saniyesinde kamera 4 (3. sn\'de başlıyor) bekliyor');
    const page = await open(browser, 'multiview');
    try {
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 0.5));
        await page.waitForTimeout(1500);
        const s = await state(page);
        // Kamera 2 / 3 / 4 etkinliğin 2. / 1. / 3. saniyesinde başlıyor — 0.5. saniyede hepsi bekliyor.
        const others = s.tiles.filter((t) => !t.active);
        ok(others.length === 3 && others.every((t) => t.waiting && t.badge === 'Henüz başlamadı'), `diğer kameralar "Henüz başlamadı" (${others.map((t) => `${t.id}:${t.waiting}`).join(' ')})`);
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 2.5));
        await page.waitForTimeout(1500);
        const s2 = await state(page);
        const w = Object.fromEntries(s2.tiles.map((t) => [t.id, t.waiting]));
        ok(!w.cam2 && !w.cam3 && w.cam4, `2.5. saniyede kamera 2 ve 3 başladı, kamera 4 bekliyor (${JSON.stringify(w)})`);
    } finally {
        await page.close();
    }
}

async function testGrid(browser) {
    console.log('\n[3] Bölünmüş ekran: ana video bir hücrede, diğerleri yanında; tıklayınca yer değiştirir; görünüm butonu');
    const page = await open(browser, 'multiview-grid');
    try {
        let s = await state(page);
        ok(s.grid && s.mainShare > 45 && s.mainShare < 55, `ana video hücrede (genişliğin %${s.mainShare}'i)`);
        ok(s.tiles.length === 3 && s.tiles.every((t) => t.video && t.rect.w > 300), `3 hücre, hepsi akışlı (${s.tiles.map((t) => `${t.id} ${t.rect.w}×${t.rect.h}`).join(', ')})`);
        await play(page);
        await waitTime(page, 4);
        const m = await switchAndMeasure(page, 'cam3');
        s = await state(page);
        ok(Math.abs(m.got - m.expected) < 0.8 && s.tiles.some((t) => t.id === 'cam1') && !s.tiles.some((t) => t.id === 'cam3'), `kamera 3 ana hücreye geçti, kamera 1 hücreye (fark ${(m.got - m.expected).toFixed(2)} sn)`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Bölünmüş ekran"]').click());
        await page.waitForTimeout(300);
        s = await state(page);
        ok(!s.grid && s.mainShare > 95 && s.tiles.length === 4 && s.ev.some((e) => e.state === 'layout' && e.layout === 'focus'), 'görünüm butonu → odak görünümü (hp:multiview layout)');
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await page.close();
    }
}

async function testPoster(browser) {
    console.log('\n[4] Poster önizleme: akış yok, görsel var; mobilde (dar) otomatik poster');
    const page = await open(browser, 'multiview-poster');
    try {
        const s = await state(page);
        ok(s.tiles.every((t) => !t.video && t.img), `previews: 'poster' → yalnızca görsel (${s.tiles.map((t) => (t.img ? 'img' : '-')).join(' ')})`);
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        // Test yayınları HLS: MSE ve yerel HLS yoksa (Windows'taki Playwright WebKit) oynatılamaz.
        const probe = await browser.newPage();
        await probe.goto(`${BASE}/`);
        const hls = await probe.evaluate(() => typeof MediaSource !== 'undefined' || 'ManagedMediaSource' in window || !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl'));
        await probe.close();
        if (!hls) {
            console.log('\n(bu tarayıcıda HLS yok — MSE da yerel HLS de yok; çoklu kamera testleri atlandı)');
            return;
        }
        await testFocus(browser);
        await testNotStarted(browser);
        await testGrid(browser);
        await testPoster(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
