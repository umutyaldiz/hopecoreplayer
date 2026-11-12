// HopeCorePlayer — izlenme araçları: bitiş ekranı (redirectScreen mode: 'endScreen'), transkript paneli, ısı haritası.
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

async function open(browser, feature) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.goto(`${BASE}/${feature ? `?feature=${feature}` : ''}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => {
        window.__ev = [];
        const el = document.getElementById('player');
        for (const t of ['hp:redirect', 'hp:transcript']) el.addEventListener(t, (e) => window.__ev.push({ t, ...e.detail }));
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000, polling: 50 });
    // Eklenti parçası (dinamik import) yüklensin.
    await page.waitForTimeout(400);
    return page;
}

const root = 'document.getElementById("player").shadowRoot';

async function chunkUrls(browser, feature) {
    const page = await browser.newPage();
    const urls = new Set();
    page.on('request', (r) => {
        if (/\/chunks\//.test(r.url())) urls.add(r.url());
    });
    await page.goto(`${BASE}/${feature ? `?feature=${feature}` : ''}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.waitForTimeout(400);
    await page.close();
    return urls;
}

async function testIsolation(browser) {
    console.log('\n[1] Transkript ve ısı haritası yalnızca açıkken ayrı parça indiriyor mu?');
    const base = await chunkUrls(browser, null);
    for (const f of ['transcript', 'heatmap']) {
        const extra = [...(await chunkUrls(browser, f))].filter((u) => !base.has(u));
        ok(extra.length > 0, `?feature=${f} → yeni parça (${extra.length})`);
    }
}

async function testEndScreen(browser) {
    console.log('\n[2] Bitiş ekranı (mode: endScreen): video bitince öneri ızgarası, tıklama olayı, tekrar izle, kapat');
    const page = await open(browser, 'endscreen');
    try {
        const end = () => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').dispatchEvent(new Event('ended')));
        await end();
        await page.waitForFunction(`!!${root}.querySelector('[part="redirect-suggestions"]')`, null, { timeout: 3000, polling: 50 }).catch(() => {});
        const s = await page.evaluate(() => {
            const r = document.getElementById('player').shadowRoot;
            const w = r.querySelector('[part="redirect-suggestions"]');
            return {
                shown: !!w,
                countdown: !!r.querySelector('[part="redirect-screen"]'),
                title: w?.querySelector('.hp-redirect-grid-title')?.textContent,
                cards: w?.querySelectorAll('.hp-redirect-suggestion').length,
                sub: w?.querySelector('.hp-redirect-suggestion .hp-redirect-sub')?.textContent,
                replay: !!w?.querySelector('.hp-redirect-replay'),
                ev: window.__ev.map((e) => `${e.state}:${e.mode}`),
            };
        });
        ok(s.shown && !s.countdown, 'video bitti → geri sayım yok, doğrudan öneri ızgarası');
        ok(s.title === 'Bunları da izleyin' && s.cards === 3, `başlık + 3 kart (${s.title}, ${s.cards})`);
        ok(s.sub === 'Kanal · 2 gün önce' && s.replay, `kart alt metni + "Tekrar izle" (${s.sub})`);
        ok(s.ev.includes('shown:endScreen'), `hp:redirect shown (mode endScreen) (${s.ev.join(', ')})`);

        // SPA: preventDefault → sayfa değişmez, olayda öneri adresi + sıra.
        await page.evaluate(() => {
            document.getElementById('player').addEventListener('hp:redirect', (e) => {
                if (e.detail.state === 'redirect') e.preventDefault();
            });
            document.getElementById('player').shadowRoot.querySelectorAll('.hp-redirect-suggestion')[1].click();
        });
        await page.waitForTimeout(200);
        const click = await page.evaluate(() => ({ href: location.href, ev: window.__ev.find((e) => e.state === 'redirect') }));
        ok(click.href.includes('feature=endscreen'), 'preventDefault → sayfa değişmedi');
        ok(click.ev?.reason === 'suggestion' && click.ev?.index === 1 && click.ev?.url === 'https://example.com/s2', `olay: suggestion #1 s2 (${JSON.stringify(click.ev)})`);

        // Tekrar izle → başa sarıp oynatır, ızgara kalkar.
        await page.evaluate(() => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.currentTime = 9;
        });
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-redirect-replay').click());
        await page.waitForTimeout(400);
        const r = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const v = root.querySelector('video');
            return { gone: !root.querySelector('[part="redirect-suggestions"]'), t: v.currentTime, paused: v.paused, ev: window.__ev.some((e) => e.state === 'replay') };
        });
        ok(r.gone && r.t < 2 && !r.paused && r.ev, `tekrar izle: başa sardı ve oynuyor (t=${r.t.toFixed(2)}, paused=${r.paused})`);

        // Kapat (X) → ızgara kalkar.
        await end();
        await page.waitForFunction(`!!${root}.querySelector('[part="redirect-suggestions"]')`, null, { timeout: 3000, polling: 50 }).catch(() => {});
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="redirect-suggestions"] .hp-redirect-close').click());
        const closed = await page.evaluate(() => !document.getElementById('player').shadowRoot.querySelector('[part="redirect-suggestions"]'));
        ok(closed, 'X → öneriler kapandı');
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await page.close();
    }
}

const panel = (page) =>
    page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const p = r.querySelector('[part="transcript"]');
        const rows = [...(p?.querySelectorAll('.hp-transcript-line') ?? [])];
        const visible = rows.filter((l) => !l.hidden);
        return {
            exists: !!p,
            open: !!p && !p.hidden,
            btn: !!r.querySelector('.hp-transcript-btn'),
            pressed: r.querySelector('.hp-transcript-btn')?.getAttribute('aria-pressed'),
            rows: rows.length,
            visible: visible.length,
            texts: visible.map((l) => l.querySelector('.hp-transcript-text').textContent),
            active: rows.findIndex((l) => l.hasAttribute('data-active')),
            options: [...(p?.querySelectorAll('.hp-transcript-select option') ?? [])].map((o) => o.value),
            selected: p?.querySelector('.hp-transcript-select')?.value,
            mark: p?.querySelector('mark')?.textContent ?? null,
            status: p?.querySelector('.hp-transcript-status')?.hidden ? '' : p?.querySelector('.hp-transcript-status')?.textContent,
            t: r.querySelector('video').currentTime,
            paused: r.querySelector('video').paused,
        };
    });

async function testTranscript(browser) {
    console.log('\n[3] Transkript: buton, satırlar, tıklayınca o ana gitme, vurgulama, arama, dil değiştirme, klavye');
    const page = await open(browser, 'transcript');
    try {
        const expected = await page.evaluate(async () => {
            const txt = await (await fetch('/sample.vtt')).text();
            return txt.split(/\r?\n/).filter((l) => l.includes('-->')).length;
        });
        let s = await panel(page);
        ok(s.btn && s.exists && !s.open, 'kontrol çubuğunda buton var, panel kapalı');

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-transcript-btn').click());
        await page.waitForTimeout(150);
        s = await panel(page);
        ok(s.open && s.pressed === 'true', 'butona basınca panel açıldı (aria-pressed)');
        ok(s.rows === expected && expected > 3, `tüm satırlar listelendi (${s.rows}/${expected})`);
        ok(s.options.join(',') === 'Türkçe,English' && s.selected === 'Türkçe', `dil seçici + seçili altyazı izlendi (${s.options}, ${s.selected})`);
        ok(await page.evaluate(() => window.__ev.some((e) => e.t === 'hp:transcript' && e.state === 'open')), 'hp:transcript open');

        // 3. satıra tıkla → o ana gider, satır vurgulanır.
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-transcript-line button')[2].click());
        await page.waitForFunction(`${root}.querySelectorAll('.hp-transcript-line')[2]?.hasAttribute('data-active')`, null, { timeout: 3000, polling: 50 }).catch(() => {});
        s = await panel(page);
        ok(Math.abs(s.t - 2.25) < 0.1 && s.active === 2, `satır 3 → t=2.25 ve vurgulu (t=${s.t.toFixed(2)}, aktif=${s.active})`);
        ok(await page.evaluate(() => window.__ev.some((e) => e.state === 'seek' && Math.abs(e.time - 2.25) < 0.01)), 'hp:transcript seek (time)');

        // Videoyu sarınca vurgu takip eder.
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 5));
        await page.waitForTimeout(300);
        s = await panel(page);
        ok(s.active > 2, `sarınca vurgu ilerledi (aktif=${s.active})`);

        // Arama: aksan / büyük-küçük harf duyarsız, vurgulu.
        const search = async (q) => {
            await page.evaluate((q) => {
                const i = document.getElementById('player').shadowRoot.querySelector('.hp-transcript-search');
                i.value = q;
                i.dispatchEvent(new Event('input'));
            }, q);
            return panel(page);
        };
        s = await search('CAY');
        ok(s.visible === 1 && /çay/i.test(s.texts[0] ?? '') && s.mark?.toLowerCase() === 'çay', `"CAY" → "çay" satırı + <mark> (${s.texts}, ${s.mark})`);
        s = await search('zzzz');
        ok(s.visible === 0 && s.status === 'Sonuç bulunamadı.', `eşleşme yok → durum metni (${s.status})`);
        s = await search('');
        ok(s.visible === s.rows, 'arama temizlenince tüm satırlar');

        // Arama kutusunda Space oynatmayı tetiklemez.
        const before = (await panel(page)).paused;
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-transcript-search').focus());
        await page.keyboard.press('Space');
        await page.waitForTimeout(150);
        ok((await panel(page)).paused === before, 'arama kutusunda Space oynat/duraklat yapmadı');

        // Dil değiştir → İngilizce satırlar.
        await page.evaluate(() => {
            const sel = document.getElementById('player').shadowRoot.querySelector('.hp-transcript-select');
            sel.value = 'English';
            sel.dispatchEvent(new Event('change'));
        });
        s = await panel(page);
        ok(s.rows > 3 && /[a-z]/i.test(s.texts[0]) && !s.texts.some((t) => /çay/i.test(t)), `İngilizce izine geçti (${s.texts[1]})`);

        // Escape → kapanır.
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-transcript-search').focus());
        await page.keyboard.press('Escape');
        s = await panel(page);
        ok(!s.open && s.pressed === 'false', 'Escape → panel kapandı');

        // Kod ile aç / kapat.
        await page.evaluate(() => document.getElementById('player').toggleTranscript(true));
        ok((await panel(page)).open, 'toggleTranscript(true) → açık');

        // Dil İngilizce'ye çevrilince metinler güncellenir.
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, locale: 'en' };
        });
        await page.waitForTimeout(300);
        const label = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-transcript-title').textContent);
        ok(label === 'Transcript', `locale en → "${label}"`);
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await page.close();
    }

    const p2 = await open(browser, 'transcript-open');
    try {
        const s = await panel(p2);
        ok(s.open && s.rows > 3, `open: true + track: 'tr' → altyazı kapalıyken de satırlar dolu (${s.rows})`);
    } finally {
        await p2.close();
    }
}

async function testHeatmap(browser) {
    console.log('\n[4] Isı haritası: seek bar üstünde eğri, izlenen kısım dolar, ayar kaldırılınca gider');
    const page = await open(browser, 'heatmap');
    try {
        const read = () =>
            page.evaluate(() => {
                const r = document.getElementById('player').shadowRoot;
                const h = r.querySelector('.hp-seekbar [part="heatmap"]');
                return {
                    exists: !!h,
                    hidden: h?.hidden,
                    show: h?.getAttribute('data-show'),
                    d: h?.querySelector('.hp-heatmap-base path')?.getAttribute('d')?.length ?? 0,
                    opacity: h ? getComputedStyle(h).opacity : null,
                    p: h?.style.getPropertyValue('--hp-heatmap-p'),
                    height: h?.getBoundingClientRect().height,
                };
            });
        let s = await read();
        ok(s.exists && !s.hidden && s.d > 50, `eğri çizildi (d=${s.d} karakter)`);
        ok(s.show === 'always' && s.opacity === '1' && s.height > 20, `show: always → görünür (opacity=${s.opacity}, h=${s.height})`);
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 5));
        await page.waitForTimeout(300);
        s = await read();
        ok(Math.abs(parseFloat(s.p) - 50) < 3, `t=5/10 → izlenen kısım %50 (${s.p})`);

        // Dizi kısayolu + varsayılan 'hover' → üzerine gelmeden gizli.
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, heatmap: [1, 5, 2, 8] };
        });
        await page.waitForTimeout(400);
        s = await read();
        ok(s.exists && s.show === 'hover' && s.opacity === '0', `heatmap: number[] → hover modunda gizli (opacity=${s.opacity})`);
        await page.locator('#player .hp-seekbar').hover();
        await page.waitForTimeout(400);
        s = await read();
        ok(s.opacity === '1', `seek bar üzerine gelince görünür (opacity=${s.opacity})`);
        await page.mouse.move(5, 5);

        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, heatmap: undefined };
        });
        await page.waitForTimeout(300);
        ok(!(await read()).exists, 'ayar kaldırılınca eğri silindi');
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testIsolation(browser);
        await testEndScreen(browser);
        await testTranscript(browser);
        await testHeatmap(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
