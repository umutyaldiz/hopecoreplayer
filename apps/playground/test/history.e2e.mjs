// HopeCorePlayer — options.history (zaman ve ses geçmişi) doğrulaması: sayfa yenilenince kaldığı yerden devam +
// bildirim + "Baştan başla", kısa izleme / sona yakın konum kaydedilmez, ses seviyesi hatırlanır (sessiz otomatik oynatma
// korunur), QR ile devam linki (?vtime=) kayıtlı konumu ezer, `id` ile farklı adresler aynı video sayılır.
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

/** Sayfayı (yeniden) yükle, seçenekleri ver, meta veri gelene kadar bekle. */
async function load(page, options, path = '/') {
    await page.goto(`${BASE}${path}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((options) => {
        const el = document.getElementById('player');
        window.__history = [];
        el.addEventListener('hp:history', (e) => window.__history.push(e.detail));
        el.options = { src: '/sample-30s.mp4', ...options };
    }, options);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
    // Eklenti parçası + kayıtlı konuma sarma.
    await page.waitForTimeout(700);
}

const state = (page) =>
    page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const v = root.querySelector('video');
        const n = root.querySelector('[part="history-notice"]');
        return { t: v.currentTime, volume: v.volume, muted: v.muted, notice: n?.textContent ?? null, events: window.__history.map((e) => `${e.state}@${Math.round(e.time)}`) };
    });

const seek = (page, t) =>
    page.evaluate(
        (t) =>
            new Promise((r) => {
                const v = document.getElementById('player').shadowRoot.querySelector('video');
                v.addEventListener('seeked', () => setTimeout(r, 100), { once: true });
                v.currentTime = t;
            }),
        t
    );

async function newPage(browser) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    await page.goto(`${BASE}/`);
    await page.evaluate(() => {
        localStorage.removeItem('hp-history-positions');
        localStorage.removeItem('hp-history-volume');
    });
    return page;
}

async function testOffByDefault(browser) {
    console.log('\n[1] history verilmezse hiçbir şey hatırlanmıyor');
    const page = await newPage(browser);
    try {
        await load(page, { muted: true });
        await seek(page, 12);
        await load(page, { muted: true });
        const s = await state(page);
        ok(s.t < 1 && s.notice === null, `yenileyince baştan (t=${s.t.toFixed(2)})`);
        const stored = await page.evaluate(() => localStorage.getItem('hp-history-positions'));
        ok(stored === null, 'localStorage\'a yazılmadı');
    } finally {
        await page.close();
    }
}

async function testResume(browser) {
    console.log('\n[2] Kaldığı yerden devam + bildirim; "Baştan başla" başa alıyor ve kaydı siliyor');
    const page = await newPage(browser);
    try {
        await load(page, { muted: true, history: true });
        await seek(page, 12);
        await load(page, { muted: true, history: true });
        let s = await state(page);
        ok(s.t >= 11.5 && s.t < 13, `yenileyince 12. sn'den (t=${s.t.toFixed(2)})`);
        ok(s.notice?.startsWith('Kaldığınız yerden devam: 0:12') && s.notice.includes('Baştan başla'), `bildirim: "${s.notice}"`);
        ok(s.events.includes('resumed@12'), `hp:history ${JSON.stringify(s.events)}`);

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-history-restart').click());
        await page.waitForTimeout(300);
        s = await state(page);
        ok(s.t < 0.5 && s.notice === null && s.events.includes('restart@0'), `Baştan başla → t=${s.t.toFixed(2)}, bildirim kalktı ${JSON.stringify(s.events)}`);
        await load(page, { muted: true, history: true });
        s = await state(page);
        ok(s.t < 1, `kayıt silindi — yenileyince baştan (t=${s.t.toFixed(2)})`);
    } finally {
        await page.close();
    }
}

async function testThresholds(browser) {
    console.log('\n[3] minWatched altı ve sona yakın konum kaydedilmiyor (izlenmiş sayılıyor)');
    const page = await newPage(browser);
    try {
        await load(page, { muted: true, history: true });
        await seek(page, 5);
        await load(page, { muted: true, history: true });
        let s = await state(page);
        ok(s.t < 1, `5 sn (< 10) → baştan (t=${s.t.toFixed(2)})`);

        await seek(page, 12);
        await seek(page, 27); // 30 sn'lik videoda sona 15 sn'den az kaldı → kayıt silinir
        await load(page, { muted: true, history: true });
        s = await state(page);
        ok(s.t < 1, `sona yakın (27 / 30) → kayıt silindi, baştan (t=${s.t.toFixed(2)})`);
    } finally {
        await page.close();
    }
}

async function testVolume(browser) {
    console.log('\n[4] Ses seviyesi ve sessiz durumu hatırlanıyor; muted: true (sessiz otomatik oynatma) her zaman kazanıyor');
    const page = await newPage(browser);
    try {
        await load(page, { history: true });
        await page.evaluate(() => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.volume = 0.3;
            v.muted = false;
        });
        await page.waitForTimeout(150);
        await load(page, { history: true });
        let s = await state(page);
        ok(Math.abs(s.volume - 0.3) < 0.01 && !s.muted, `yenileyince ses %30, sesli (${s.volume}, muted=${s.muted})`);
        await load(page, { history: true, muted: true });
        s = await state(page);
        ok(Math.abs(s.volume - 0.3) < 0.01 && s.muted, `muted: true → sessiz kaldı, seviye yine %30 (${s.volume}, muted=${s.muted})`);
        await load(page, { history: { volume: false } });
        s = await state(page);
        ok(Math.abs(s.volume - 1) < 0.01, `volume: false → hatırlanmadı (${s.volume})`);
    } finally {
        await page.close();
    }
}

async function testLinkWinsAndId(browser) {
    console.log('\n[5] QR ile devam linki (?vtime=20) kayıtlı konumu (12) ezer; id ile farklı adres aynı video');
    const page = await newPage(browser);
    try {
        await load(page, { muted: true, history: true, qrResume: {} });
        await seek(page, 12);
        await load(page, { muted: true, history: true, qrResume: {} }, '/?vtime=20');
        let s = await state(page);
        ok(s.t >= 19.5 && s.t < 21 && !s.events.includes('resumed@12'), `link kazandı (t=${s.t.toFixed(2)}, ${JSON.stringify(s.events)})`);

        await load(page, { muted: true, history: { id: 'bolum-1' } });
        await seek(page, 13);
        // Aynı video, farklı (ör. yeniden imzalanmış) adres.
        await load(page, { src: '/sample-30s.mp4?token=yeni-imza', muted: true, history: { id: 'bolum-1' } });
        s = await state(page);
        ok(s.t >= 12.5 && s.t < 14, `aynı id, farklı adres → 13. sn'den (t=${s.t.toFixed(2)})`);
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testOffByDefault(browser);
        await testResume(browser);
        await testThresholds(browser);
        await testVolume(browser);
        await testLinkWinsAndId(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
