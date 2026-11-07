// HopeCorePlayer — options.accessibility ("Erişilebilirlik" alt menüsü) doğrulaması: yakınlaştırma (menü, klavye,
// sürükleme), görüntü filtreleri (renk körlüğü dahil — ekranda gerçekten uygulanıyor mu), mono ses / ses güçlendirme
// (CORS'suz kaynakta kullanılamaz), büyük kontroller, kısayol paneli (?), seçimlerin hatırlanması.
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

async function open(browser, accessibility = true, { src = '/sample.mp4', clearStorage = true, page: existing } = {}) {
    const page = existing ?? (await browser.newPage({ viewport: { width: 900, height: 560 } }));
    if (!existing) {
        await page.goto(`${BASE}/`);
        if (clearStorage) await page.evaluate(() => localStorage.removeItem('hp-accessibility'));
    }
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(
        ({ accessibility, src }) => {
            const el = document.getElementById('player');
            window.__a11y = [];
            el.addEventListener('hp:accessibility', (e) => window.__a11y.push(e.detail));
            el.options = { src, muted: true, accessibility };
        },
        { accessibility, src }
    );
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    return page;
}

/** Ayarlar menüsünde satırların yolunu izler (["Erişilebilirlik", "Görüntü filtresi", "Siyah-beyaz"]); son panelin satırlarını döndürür. */
async function menu(page, path, { closeAfter = true } = {}) {
    return page.evaluate(
        async ({ path, closeAfter }) => {
            const root = document.getElementById('player').shadowRoot;
            const wait = () => new Promise((r) => setTimeout(r, 120));
            const panel = () => root.querySelector('.hp-chip-panel');
            if (panel().classList.contains('hp:hidden')) root.querySelector('[aria-label="Ayarlar"]').click();
            await wait();
            let rows = [];
            for (const step of path) {
                const btn = Array.from(panel().querySelectorAll('button')).find((b) => b.textContent.trim().startsWith(step));
                if (!btn) return { missing: step, rows: Array.from(panel().querySelectorAll('button')).map((b) => b.textContent.trim()) };
                btn.click();
                await wait();
            }
            rows = Array.from(panel().querySelectorAll('button')).map((b) => b.textContent.trim());
            if (closeAfter && !panel().classList.contains('hp:hidden')) root.querySelector('[aria-label="Ayarlar"]').click();
            return { rows, open: !panel().classList.contains('hp:hidden') };
        },
        { path, closeAfter }
    );
}

const videoStyle = (page) =>
    page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        return { transform: v.style.transform, filter: v.style.filter, t: v.currentTime, paused: v.paused };
    });

const press = async (page, key) => {
    await page.evaluate(() => document.getElementById('player').focus());
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
};

async function testMenuOnlyWhenEnabled(browser) {
    console.log('\n[1] "Erişilebilirlik" yalnızca accessibility açıkken menüde; alt menüde tüm satırlar');
    const page = await open(browser, false);
    try {
        let r = await menu(page, []);
        ok(!r.rows.some((x) => x.startsWith('Erişilebilirlik')), `kapalıyken satır yok ${JSON.stringify(r.rows)}`);
        await open(browser, true, { page });
        r = await menu(page, ['Erişilebilirlik']);
        const want = ['Yakınlaştırma', 'Görüntü filtresi', 'Mono ses', 'Ses güçlendirme', 'Büyük kontroller', 'Klavye kısayolları'];
        ok(want.every((w) => r.rows.some((x) => x.startsWith(w))), `alt menü: ${JSON.stringify(r.rows)}`);
        await open(browser, { zoom: false, audio: false, shortcuts: false }, { page });
        r = await menu(page, ['Erişilebilirlik']);
        ok(!r.rows.some((x) => /Yakınlaştırma|Mono|güçlendirme|kısayol/.test(x)) && r.rows.some((x) => x.startsWith('Görüntü filtresi')), `kapatılan satırlar yok ${JSON.stringify(r.rows)}`);
    } finally {
        await page.close();
    }
}

async function testFilters(browser) {
    console.log('\n[2] Filtreler: siyah-beyaz / gün ışığı / gece ışığı CSS ile, renk körlüğü SVG matrisiyle ekranda uygulanıyor; olay + hatırlama');
    const page = await open(browser);
    try {
        const r = await menu(page, ['Erişilebilirlik', 'Görüntü filtresi'], { closeAfter: true });
        ok(JSON.stringify(r.rows.slice(1)) === JSON.stringify(['Doğal', 'Siyah-beyaz', 'Gün ışığı', 'Gece ışığı', 'Yüksek kontrast', 'Kırmızı körlüğü', 'Yeşil körlüğü', 'Mavi körlüğü']), `filtre listesi ${JSON.stringify(r.rows.slice(1))}`);
        await menu(page, ['Erişilebilirlik', 'Görüntü filtresi', 'Siyah-beyaz']);
        let s = await videoStyle(page);
        ok(s.filter === 'grayscale(1)', `siyah-beyaz → ${s.filter}`);
        const ev = await page.evaluate(() => window.__a11y.at(-1));
        ok(ev?.changed === 'filter' && ev.filter === 'grayscale', `hp:accessibility ${JSON.stringify(ev)}`);
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hp-accessibility')));
        ok(stored?.filter === 'grayscale', `localStorage'a yazıldı ${JSON.stringify(stored)}`);

        // Ekranda gerçekten uygulanıyor mu: aynı karenin ekran görüntüsü filtreyle farklı olmalı.
        const video = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('video'));
        const shot = async () => (await video.screenshot()).toString('base64');
        await menu(page, ['Erişilebilirlik', 'Görüntü filtresi', 'Doğal']);
        await page.mouse.move(5, 5);
        await page.waitForTimeout(1500);
        const natural = await shot();
        for (const name of ['Gün ışığı', 'Gece ışığı', 'Kırmızı körlüğü', 'Yeşil körlüğü', 'Mavi körlüğü']) {
            await menu(page, ['Erişilebilirlik', 'Görüntü filtresi', name]);
            await page.mouse.move(5, 5);
            await page.waitForTimeout(1500);
            s = await videoStyle(page);
            const differs = (await shot()) !== natural;
            ok(differs && s.filter, `${name}: ekranda farklı (filter=${s.filter.slice(0, 40)}…)`);
        }

        // Yeniden yükleyince filtre geri geliyor (yakınlaştırma bilerek hatırlanmaz).
        await page.reload();
        await open(browser, true, { page, clearStorage: false });
        s = await videoStyle(page);
        ok(s.filter.includes('url('), `sayfa yenilenince son filtre (mavi körlüğü) geri geldi (${s.filter.slice(0, 30)}…)`);
    } finally {
        await page.close();
    }
}

async function testZoom(browser) {
    console.log('\n[3] Yakınlaştırma: menü, + / − / 0, Shift+ok ile gezinme (sarmaz), fareyle sürükleme (oynat/duraklat yok)');
    const page = await open(browser);
    try {
        await menu(page, ['Erişilebilirlik', 'Yakınlaştırma', '200%']);
        let s = await videoStyle(page);
        ok(/scale\(2\)/.test(s.transform), `200% → ${s.transform}`);
        await press(page, '+');
        s = await videoStyle(page);
        ok(/scale\(3\)/.test(s.transform), `+ → ${s.transform}`);
        await press(page, '-');
        s = await videoStyle(page);
        ok(/scale\(2\)/.test(s.transform), `− → ${s.transform}`);

        const t0 = s.t;
        await press(page, 'Shift+ArrowRight');
        s = await videoStyle(page);
        ok(/translate\(-\d/.test(s.transform) && Math.abs(s.t - t0) < 0.01, `Shift+→ görüntüyü kaydırdı, sarmadı (${s.transform}, t ${t0}→${s.t})`);
        await press(page, 'ArrowRight');
        s = await videoStyle(page);
        ok(s.t > t0 + 1, `düz → yine sarıyor (t=${s.t.toFixed(2)})`);

        // Fareyle sürükleme: görüntü kayar, tık sayılmaz (oynatma başlamaz).
        const box = await (await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('video'))).boundingBox();
        const before = (await videoStyle(page)).transform;
        const diag = await page.evaluate(
            ({ x, y }) => {
                const root = document.getElementById('player').shadowRoot;
                const el = root.elementFromPoint(x, y);
                return { paused: root.querySelector('video').paused, at: el ? `${el.tagName}.${el.className}`.slice(0, 80) : null };
            },
            { x: box.x + box.width * 0.3, y: box.y + box.height * 0.35 }
        );
        // Ortadaki oynat butonunun dışından başla (butonun üstünde başlayan sürükleme kaydırmaz).
        await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.3 + 120, box.y + box.height * 0.35 + 40, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        s = await videoStyle(page);
        ok(s.transform !== before && s.paused, `sürükleme kaydırdı, oynatma başlamadı (${before} → ${s.transform}, paused=${s.paused}, önce ${JSON.stringify(diag)})`);

        await press(page, '0');
        s = await videoStyle(page);
        ok(s.transform === '', `0 → sıfırlandı (${JSON.stringify(s.transform)})`);
    } finally {
        await page.close();
    }
}

async function testAudio(browser) {
    console.log('\n[4] Mono ses / ses güçlendirme: aynı origin kaynakta açılıyor (oynatma sürüyor); CORS\'suz başka alan adında "Kullanılamaz"');
    const page = await open(browser);
    try {
        // Web Audio olmayan motor (Playwright'ın WebKit derlemesi): satırlar "Kullanılamaz", seçilemez.
        if (!(await page.evaluate(() => typeof AudioContext !== 'undefined'))) {
            const r = await menu(page, ['Erişilebilirlik']);
            ok(r.rows.some((x) => x === 'Mono sesKullanılamaz'), `Web Audio yok → "Kullanılamaz" ${JSON.stringify(r.rows)}`);
            console.log('  SKIP mono / güçlendirme açma — bu motorda Web Audio yok');
            return;
        }
        let r = await menu(page, ['Erişilebilirlik', 'Mono ses'], { closeAfter: false });
        ok(r.rows.some((x) => x.startsWith('Mono ses') && x.endsWith('Açık')) && r.open, `mono açıldı, menü açık kaldı ${JSON.stringify(r.rows)}`);
        await menu(page, ['Ses güçlendirme', '200%']);
        const ev = await page.evaluate(() => window.__a11y.slice(-2).map((e) => `${e.changed}:${e.changed === 'mono' ? e.mono : e.boost}`));
        ok(JSON.stringify(ev) === '["mono:true","boost:2"]', `olaylar ${JSON.stringify(ev)}`);
        const playing = await page.evaluate(async () => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            await v.play().catch(() => {});
            const t0 = v.currentTime;
            await new Promise((res) => setTimeout(res, 800));
            return { adv: v.currentTime - t0, err: v.error?.code ?? null };
        });
        ok(playing.adv > 0.3 && playing.err === null, `Web Audio açıkken oynatma sürüyor ${JSON.stringify(playing)}`);
    } finally {
        await page.close();
    }

    const page2 = await browser.newPage({ viewport: { width: 900, height: 560 } });
    try {
        // Başka alan adından CORS başlığı olmadan gelen MP4.
        await page2.route('https://media.other-origin.test/**', async (route) => {
            const res = await route.fetch({ url: `${BASE}/sample.mp4` });
            await route.fulfill({ response: res, headers: { 'content-type': 'video/mp4' } });
        });
        await page2.goto(`${BASE}/`);
        await open(browser, true, { page: page2, src: 'https://media.other-origin.test/v.mp4' });
        const r = await menu(page2, ['Erişilebilirlik']);
        const mono = r.rows.find((x) => x.startsWith('Mono ses'));
        ok(mono?.endsWith('Kullanılamaz'), `CORS'suz başka origin → "${mono}"`);
    } finally {
        await page2.close();
    }
}

async function testLargeControlsAndShortcuts(browser) {
    console.log('\n[5] Büyük kontroller (butonlar 48 px); ? ile kısayol paneli (diyalog, Esc kapatır, odak geri döner)');
    const page = await open(browser);
    try {
        const size = () => page.evaluate(() => Math.round(document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').getBoundingClientRect().width));
        const before = await size();
        await menu(page, ['Erişilebilirlik', 'Büyük kontroller']);
        const after = await size();
        ok(after === 48 && before < 48, `ayarlar butonu ${before} → ${after} px`);

        await press(page, '?');
        let d = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const dlg = root.querySelector('[part="shortcuts"]');
            return { open: !!dlg, role: dlg?.getAttribute('role'), focus: root.activeElement?.className ?? null, rows: dlg ? dlg.querySelectorAll('dd').length : 0, text: dlg?.textContent ?? '' };
        });
        ok(d.open && d.role === 'dialog' && d.focus === 'hp-shortcuts-close' && d.rows >= 7, `panel açıldı, odak Kapat'ta (${d.rows} satır)`);
        ok(d.text.includes('5 sn geri / ileri'), 'sarma adımı (5 sn) listede');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        d = await page.evaluate(() => ({ open: !!document.getElementById('player').shadowRoot.querySelector('[part="shortcuts"]'), focused: document.activeElement?.id }));
        ok(!d.open && d.focused === 'player', `Esc kapattı, odak player'a döndü ${JSON.stringify(d)}`);

        // Menü satırından da açılıyor.
        await menu(page, ['Erişilebilirlik', 'Klavye kısayolları']);
        await page.waitForTimeout(100);
        const viaMenu = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="shortcuts"]'));
        ok(viaMenu, 'menüden açıldı');
    } finally {
        await page.close();
    }
}

async function testQuickButtons(browser) {
    console.log('\n[6] Hızlı erişim: açık özelliğin butonu ayarların sağında, basınca doğrudan o ayarlar; kapatınca buton kalkıyor');
    const page = await open(browser);
    try {
        const quick = () =>
            page.evaluate(() => {
                const root = document.getElementById('player').shadowRoot;
                const settings = root.querySelector('[aria-label="Ayarlar"]');
                return Array.from(root.querySelectorAll('[data-a11y]')).map((b) => ({
                    id: b.getAttribute('data-a11y'),
                    label: b.getAttribute('aria-label'),
                    afterSettings: !!(settings.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
                }));
            });
        ok((await quick()).length === 0, 'hiçbir özellik açık değilken hızlı buton yok');

        await menu(page, ['Erişilebilirlik', 'Yakınlaştırma', '200%']);
        await menu(page, ['Erişilebilirlik', 'Görüntü filtresi', 'Siyah-beyaz']);
        await menu(page, ['Erişilebilirlik', 'Büyük kontroller']);
        let q = await quick();
        ok(
            JSON.stringify(q.map((b) => b.id)) === '["zoom","filter","largeControls"]' && q.every((b) => b.afterSettings),
            `zoom + filtre + büyük kontroller → ayarların sağında 3 buton ${JSON.stringify(q)}`
        );
        ok(q[0].label === 'Yakınlaştırma: 200%' && q[1].label === 'Görüntü filtresi: Siyah-beyaz', 'buton adları değeri söylüyor');

        // Butona basınca doğrudan yakınlaştırma seviyeleri; tekrar basınca kapanıyor.
        const openVia = (id) =>
            page.evaluate(async (id) => {
                const root = document.getElementById('player').shadowRoot;
                root.querySelector(`[data-a11y="${id}"]`).click();
                await new Promise((r) => setTimeout(r, 120));
                const panel = root.querySelector('.hp-chip-panel');
                return { open: !panel.classList.contains('hp:hidden'), rows: Array.from(panel.querySelectorAll('button')).map((b) => b.textContent.trim()) };
            }, id);
        let r = await openVia('zoom');
        ok(r.open && r.rows[0] === 'Yakınlaştırma' && r.rows.includes('300%'), `büyüteç → yakınlaştırma seviyeleri ${JSON.stringify(r.rows)}`);
        r = await openVia('zoom');
        ok(!r.open, 'aynı butona tekrar basınca kapandı');

        // "Geri" Erişilebilirlik menüsüne dönüyor.
        await openVia('filter');
        const back = await page.evaluate(async () => {
            const root = document.getElementById('player').shadowRoot;
            root.querySelector('.hp-chip-panel button').click();
            await new Promise((r) => setTimeout(r, 120));
            return Array.from(root.querySelectorAll('.hp-chip-panel button')).map((b) => b.textContent.trim())[0];
        });
        ok(back === 'Erişilebilirlik', `geri → "${back}"`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').click());

        // Hızlı butondan kapatınca buton kalkıyor.
        r = await openVia('filter');
        await page.evaluate(async () => {
            const root = document.getElementById('player').shadowRoot;
            Array.from(root.querySelectorAll('.hp-chip-panel button')).find((b) => b.textContent.trim() === 'Doğal').click();
            await new Promise((r) => setTimeout(r, 120));
        });
        r = await openVia('largeControls');
        ok(JSON.stringify(r.rows) === '["Büyük kontroller","Açık","Kapalı"]', `aç/kapa özelliği → Açık / Kapalı ${JSON.stringify(r.rows)}`);
        await page.evaluate(async () => {
            const root = document.getElementById('player').shadowRoot;
            Array.from(root.querySelectorAll('.hp-chip-panel button')).find((b) => b.textContent.trim() === 'Kapalı').click();
            await new Promise((r) => setTimeout(r, 120));
        });
        await press(page, '0');
        q = await quick();
        ok(q.length === 0, `filtre "Doğal", büyük kontroller "Kapalı", zoom 0 → butonlar kalktı ${JSON.stringify(q)}`);
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testMenuOnlyWhenEnabled(browser);
        await testFilters(browser);
        await testZoom(browser);
        await testAudio(browser);
        await testLargeControlsAndShortcuts(browser);
        await testQuickButtons(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
