// HopeCorePlayer — güvenlik: dış kaynaklı metin HTML olarak çalışmaz, javascript: adresleri bağlantıya / yönlendirmeye dönüşmez.
import { launchBrowser } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
const XSS = '<img src=x onerror="window.__xss=1">';
const JS_URL = 'javascript:window.__xss=2';
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

async function open(browser, options) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((o) => (document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, ...o }), options);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    return page;
}

const seek = (page, t) =>
    page.evaluate(
        (t) =>
            new Promise((r) => {
                const v = document.getElementById('player').shadowRoot.querySelector('video');
                v.addEventListener('seeked', () => setTimeout(r, 150), { once: true });
                v.currentTime = t;
            }),
        t
    );

async function testSettingsLabels(browser) {
    console.log('\n[1] Ayarlar menüsü: altyazı adı (manifest / options) HTML olarak çalışmıyor, düz metin görünüyor');
    const page = await open(browser, { subtitles: [{ src: '/sample.vtt', label: XSS, srclang: 'tr' }] });
    try {
        const r = await page.evaluate(async (xss) => {
            const root = document.getElementById('player').shadowRoot;
            root.querySelector('[aria-label="Ayarlar"]').click();
            await new Promise((r) => setTimeout(r, 80));
            [...root.querySelectorAll('button')].find((b) => b.textContent.includes('Altyazı'))?.click();
            await new Promise((r) => setTimeout(r, 200));
            const row = [...root.querySelectorAll('button')].find((b) => b.textContent.includes(xss));
            return { row: !!row, img: !!row?.querySelector('img'), xss: window.__xss ?? null };
        }, XSS);
        ok(r.row && !r.img, `etiket düz metin satırı (satır=${r.row}, img=${r.img})`);
        ok(r.xss === null, 'onerror çalışmadı');
    } finally {
        await page.close();
    }
}

async function testInteractiveCard(browser) {
    console.log('\n[2] Interactive ürün kartı: javascript: adresi bağlantı olmuyor; https adresi oluyor');
    const items = [
        { id: 'bad', type: 'product', time: 2, duration: 3, title: 'Kötü', url: JS_URL },
        { id: 'good', type: 'link', time: 8, duration: 3, title: 'İyi', url: 'https://example.com/x' },
    ];
    const page = await open(browser, { interactive: { items } });
    try {
        const href = async () => {
            await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('.hp-ia-card'), null, { timeout: 3000 }).catch(() => {});
            return page.evaluate(() => {
                const card = document.getElementById('player').shadowRoot.querySelector('.hp-ia-card');
                return card ? card.getAttribute('href') : 'yok';
            });
        };
        // Eklenti parçası yüklensin (işaretler çizilince hazır).
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-ia-marker').length === 2, null, { timeout: 5000 });
        await seek(page, 2.5);
        const bad = await href();
        ok(bad === null, `kart çıktı, javascript: → href yok (${bad})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-ia-card')?.click());
        await page.waitForTimeout(150);
        ok((await page.evaluate(() => window.__xss ?? null)) === null, 'kart tıklaması kod çalıştırmadı');
        await seek(page, 8.5);
        ok((await href()) === 'https://example.com/x', 'https adresi bağlantı');
    } finally {
        await page.close();
    }
}

async function testRedirect(browser) {
    console.log('\n[3] Bitiş ekranı: javascript: önerisi bağlantı olmuyor, javascript: url ile yönlendirme yapılmıyor');
    const page = await open(browser, {
        redirectScreen: {
            mode: 'endScreen',
            url: JS_URL,
            duration: 1,
            suggestions: [
                { url: JS_URL, title: 'Kötü' },
                { url: '/?ok=1', title: 'İyi' },
            ],
        },
    });
    try {
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').dispatchEvent(new Event('ended')));
        await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('[part="redirect-suggestions"]'), null, { timeout: 3000 }).catch(() => {});
        const hrefs = await page.evaluate(() =>
            [...document.getElementById('player').shadowRoot.querySelectorAll('[part="redirect-suggestions"] a')].map((a) => a.getAttribute('href'))
        );
        ok(hrefs.length === 2 && hrefs[0] === null && hrefs[1] === '/?ok=1', `öneri adresleri ${JSON.stringify(hrefs)}`);
        await page.waitForTimeout(2500);
        ok((await page.evaluate(() => [window.__xss ?? null, location.protocol])).join() === ',http:', 'geri sayım sonunda kod çalışmadı, sayfa yerinde');
    } finally {
        await page.close();
    }
}

const browser = await launchBrowser();
try {
    await testSettingsLabels(browser);
    await testInteractiveCard(browser);
    await testRedirect(browser);
} finally {
    await browser.close();
}
console.log(failures ? `\n${failures} hata` : '\nTümü geçti');
process.exit(failures ? 1 : 0);
