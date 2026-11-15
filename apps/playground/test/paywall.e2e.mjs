// HopeCorePlayer — ödeme duvarı (paywall) ve kişiye özel filigran (watermark) doğrulaması.
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

/** Sayfayı aç; `setup` sayfada çalışır ve `el.options`'ı kurar (fonksiyon içeren seçenekler için). */
async function open(browser, setup, arg) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => {
        window.__ev = [];
        document.getElementById('player').addEventListener('hp:paywall', (e) => window.__ev.push(e.detail));
    });
    await page.evaluate(setup, arg);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    return page;
}

const state = (page) =>
    page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const v = root.querySelector('video');
        const wall = root.querySelector('[part="paywall"]');
        const badge = root.querySelector('[part="paywall-badge"]');
        return {
            t: v.currentTime,
            paused: v.paused,
            wall: !!wall,
            title: wall?.querySelector('.hp-paywall-title')?.textContent ?? null,
            buttons: wall ? [...wall.querySelectorAll('.hp-paywall-btn')].map((b) => b.textContent) : [],
            badge: badge && !badge.hidden ? badge.textContent : null,
            events: window.__ev.map((e) => `${e.state}${e.action ? ':' + e.action : ''}`),
        };
    });

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
const play = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {}));
const waitWall = (page) => page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('[part="paywall"]'), null, { timeout: 6000 }).then(() => true, () => false);

async function testPreviewEnds(browser) {
    console.log('\n[1] Önizleme bitince duvar çıkıyor, video duruyor, rozet kalan süreyi gösteriyor; tekrar oynatma engelleniyor');
    const page = await open(browser, () => {
        document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, paywall: { previewSeconds: 3, subscribe: { url: '#subscribe' } } };
    });
    try {
        await seek(page, 1.5);
        await play(page);
        await page.waitForTimeout(300);
        let s = await state(page);
        ok(s.badge && /Önizleme · 0:0[12]/.test(s.badge), `önizleme rozeti: "${s.badge}"`);
        ok(await waitWall(page), 'süre dolunca duvar çıktı');
        s = await state(page);
        ok(s.paused && s.t <= 3.3 && s.t >= 2.6, `video durdu, sınırda (t=${s.t.toFixed(2)})`);
        ok(s.title === 'Devamını izlemek için abone olun' && s.buttons.join('|') === 'Abone ol|Giriş yap', `başlık ve butonlar: ${s.buttons.join(', ')}`);
        ok(s.events.includes('shown') && s.badge === null, `hp:paywall shown, rozet gizli ${JSON.stringify(s.events)}`);
        await play(page);
        await page.waitForTimeout(400);
        ok((await state(page)).paused, 'kilitliyken play() engellendi');
        const chrome = await page.evaluate(() => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('.hp-chrome, [part="chrome"]') ?? document.body).opacity);
        ok(chrome === '0', `duvar varken kontrol çubuğu gizli (opacity ${chrome})`);
    } finally {
        await page.close();
    }
}

async function testSeekPast(browser) {
    console.log('\n[2] Önizleme sınırının ötesine sarma sınıra çekiliyor ve duvar açılıyor');
    const page = await open(browser, () => {
        document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, paywall: { previewSeconds: 4 } };
    });
    try {
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 20));
        ok(await waitWall(page), 'sarma sonrası duvar');
        const s = await state(page);
        ok(s.t <= 4.2, `konum sınıra çekildi (t=${s.t.toFixed(2)})`);
    } finally {
        await page.close();
    }
}

async function testCallbacks(browser) {
    console.log('\n[3] subscribe.onClick true döndürünce kilit açılıyor, video kaldığı yerden sürüyor; adres açılmıyor');
    const page = await open(browser, () => {
        window.__clicked = 0;
        document.getElementById('player').options = {
            src: '/sample-30s.mp4',
            muted: true,
            paywall: {
                previewSeconds: 2,
                subscribe: { url: '/should-not-open', onClick: () => new Promise((r) => setTimeout(() => r(++window.__clicked > 0), 200)) },
                login: false,
            },
        };
    });
    try {
        await seek(page, 1.4);
        await play(page);
        ok(await waitWall(page), 'duvar çıktı');
        let s = await state(page);
        ok(s.buttons.length === 1, `login: false → tek buton (${s.buttons.join(', ')})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="paywall-subscribe"]').click());
        await page.waitForTimeout(900);
        s = await state(page);
        ok(!s.wall && !s.paused && s.t > 1.9, `kilit açıldı, oynatma sürüyor (t=${s.t.toFixed(2)})`);
        ok(s.events.join(',') === 'shown,click:subscribe,unlock', `olaylar ${JSON.stringify(s.events)}`);
        ok(new URL(page.url()).pathname === '/', `sayfa değişmedi (${page.url()})`);
    } finally {
        await page.close();
    }
}

async function testCheckAccess(browser) {
    console.log('\n[4] checkAccess true → duvar çıkmıyor; false → çıkıyor; unlockPaywall() ve preventDefault');
    const page = await open(browser, () => {
        document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, paywall: { previewSeconds: 2, checkAccess: async () => true } };
    });
    try {
        await seek(page, 1.4);
        await play(page);
        await page.waitForTimeout(1500);
        let s = await state(page);
        ok(!s.wall && !s.paused && s.t > 2.3 && s.events.includes('unlock'), `erişim var → kesintisiz (t=${s.t.toFixed(2)}, ${JSON.stringify(s.events)})`);
    } finally {
        await page.close();
    }
    const p2 = await open(browser, () => {
        document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, paywall: { previewSeconds: 2, checkAccess: () => false, subscribe: { url: '#abone' } } };
        document.getElementById('player').addEventListener('hp:paywall', (e) => e.detail.state === 'click' && e.preventDefault());
    });
    try {
        await seek(p2, 1.4);
        await play(p2);
        ok(await waitWall(p2), 'erişim yok → duvar');
        await p2.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="paywall-subscribe"]').click());
        await p2.waitForTimeout(200);
        ok((await p2.evaluate(() => location.hash)) === '', 'preventDefault → bağlantı açılmadı');
        await p2.evaluate(() => document.getElementById('player').unlockPaywall());
        await p2.waitForTimeout(600);
        const s = await state(p2);
        ok(!s.wall && !s.paused, 'unlockPaywall() → duvar kalktı, oynuyor');
    } finally {
        await p2.close();
    }
}

async function testUnlockedAndLocale(browser) {
    console.log('\n[5] unlocked: true → hiç devreye girmiyor; İngilizce metinler ve özel başlık');
    const page = await open(browser, () => {
        document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, paywall: { previewSeconds: 1, unlocked: true } };
    });
    try {
        await seek(page, 5);
        await page.waitForTimeout(300);
        const s = await state(page);
        ok(!s.wall && s.t > 4.5 && s.badge === null, 'unlocked → duvar / rozet yok');
    } finally {
        await page.close();
    }
    const p2 = await open(browser, () => {
        document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, locale: 'en', paywall: { previewSeconds: 1, title: '<b>Premium</b> only' } };
    });
    try {
        await seek(p2, 3);
        ok(await waitWall(p2), 'duvar');
        const s = await state(p2);
        ok(s.title === '<b>Premium</b> only' && s.buttons.join('|') === 'Subscribe|Sign in', `özel başlık düz metin, İngilizce butonlar (${s.buttons.join(', ')})`);
        ok(!p2.__errors.length, `sayfa hatası yok ${JSON.stringify(p2.__errors)}`);
    } finally {
        await p2.close();
    }
}

async function testWatermark(browser) {
    console.log('\n[6] Filigran: metin görünüyor, yer değiştiriyor, silinirse / gizlenirse geri geliyor');
    const page = await open(browser, () => {
        document.getElementById('player').options = { src: '/sample-30s.mp4', muted: true, watermark: { text: 'ali@example.com · #42', moveEvery: 1, opacity: 0.4 } };
    });
    try {
        const read = () =>
            page.evaluate(() => {
                const el = document.getElementById('player').shadowRoot.querySelector('.hp-watermark');
                return el ? { text: el.textContent, left: el.style.left, top: el.style.top, opacity: getComputedStyle(el).opacity, display: getComputedStyle(el).display } : null;
            });
        const a = await read();
        ok(a && a.text === 'ali@example.com · #42' && Math.abs(Number(a.opacity) - 0.4) < 0.05, `filigran: ${JSON.stringify(a)}`);
        await page.waitForTimeout(2300);
        const b = await read();
        ok(b && (b.left !== a.left || b.top !== a.top), `yer değiştirdi (${a.left},${a.top} → ${b.left},${b.top})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-watermark').remove());
        await page.waitForTimeout(100);
        ok(!!(await read()), 'silinince geri kondu');
        await page.evaluate(() => {
            const el = document.getElementById('player').shadowRoot.querySelector('.hp-watermark');
            el.style.display = 'none';
            el.textContent = 'x';
        });
        await page.waitForTimeout(100);
        const c = await read();
        ok(c && c.display !== 'none' && c.text === 'ali@example.com · #42', `gizleme / metin değişikliği geri alındı (${JSON.stringify(c)})`);
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, watermark: undefined };
        });
        await page.waitForTimeout(300);
        ok(!(await read()), 'seçenek kaldırılınca filigran gitti');
    } finally {
        await page.close();
    }
}

const browser = await launchBrowser();
try {
    await testPreviewEnds(browser);
    await testSeekPast(browser);
    await testCallbacks(browser);
    await testCheckAccess(browser);
    await testUnlockedAndLocale(browser);
    await testWatermark(browser);
} finally {
    await browser.close();
}
console.log(failures ? `\n${failures} hata` : '\nTümü geçti');
process.exit(failures ? 1 : 0);
