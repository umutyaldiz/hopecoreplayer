// HopeCorePlayer — skipSegments ("İntroyu atla" / "Özeti atla" / "Jeneriği atla") doğrulaması.
// Buton bölüm oynarken (showFrom → showUntil / end) görünür, basınca bölüm sonuna atlar; autoSkip, hideAfter,
// hp:skip (iptal edilebilir) ve jenerik (end yok → video sonu).
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

/** Sayfayı aç, `skipSegments` ile kaynağı ver, olayları `window.__skip`'e topla. */
async function open(browser, skipSegments, extra = {}) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(
        ({ skipSegments, extra }) => {
            const el = document.getElementById('player');
            window.__skip = [];
            el.addEventListener('hp:skip', (e) => {
                window.__skip.push(e.detail);
                if (window.__preventSkip && e.detail.state === 'skip') e.preventDefault();
            });
            el.options = { src: '/sample-30s.mp4', muted: true, skipSegments, ...extra };
        },
        { skipSegments, extra }
    );
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
    // Eklenti parçası (dinamik import) yüklensin.
    await page.waitForTimeout(300);
    return page;
}

const state = (page) =>
    page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const btn = root.querySelector('[part="skip-segment"]');
        const v = root.querySelector('video');
        return {
            t: v.currentTime,
            paused: v.paused,
            ended: v.ended,
            visible: !!btn,
            label: btn?.textContent.trim() ?? null,
            position: btn?.getAttribute('data-position') ?? null,
            faded: !!btn?.hasAttribute('data-faded'),
            auto: !!btn?.hasAttribute('data-auto'),
            events: window.__skip.map((e) => `${e.state}${e.reason ? ':' + e.reason : ''}`),
        };
    });

const seek = (page, t) =>
    page.evaluate(
        (t) =>
            new Promise((r) => {
                const v = document.getElementById('player').shadowRoot.querySelector('video');
                v.addEventListener('seeked', () => setTimeout(r, 80), { once: true });
                v.currentTime = t;
            }),
        t
    );

const play = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
const pause = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());

async function testShowAndClick(browser) {
    console.log('\n[1] Buton showFrom\'da çıkıyor (önce yok), konum ve varsayılan metin doğru, basınca bölüm sonuna atlıyor');
    const page = await open(browser, [{ start: 2, end: 12, showFrom: 4, position: 'top-left' }]);
    try {
        await seek(page, 3);
        let s = await state(page);
        ok(!s.visible, `start (2) ile showFrom (4) arasında buton yok (t=${s.t.toFixed(2)})`);
        await seek(page, 5);
        s = await state(page);
        ok(s.visible && s.label === 'İntroyu atla' && s.position === 'top-left', `showFrom sonrası buton: "${s.label}", ${s.position}`);
        ok(s.events.includes('shown'), `hp:skip shown geldi ${JSON.stringify(s.events)}`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="skip-segment"]').click());
        await page.waitForTimeout(400);
        s = await state(page);
        ok(s.t >= 11.9 && s.t < 12.6, `basınca end'e atladı (t=${s.t.toFixed(2)})`);
        ok(!s.visible && s.events.includes('skip:click'), `buton kalktı, hp:skip skip:click ${JSON.stringify(s.events)}`);
        ok(s.paused, `tıklama oynat/duraklat'a geçmedi (duraklatılmış kaldı)`);
        await seek(page, 13);
        ok(!(await state(page)).visible, 'bölüm dışında buton yok');
    } finally {
        await page.close();
    }
}

async function testShowUntilAndHideAfter(browser) {
    console.log('\n[2] showUntil butonu erken kaldırıyor; hideAfter süre dolunca butonu çekiyor (kontroller gizliyken)');
    const page = await open(browser, [{ start: 1, end: 20, showUntil: 6, hideAfter: 1, type: 'recap' }]);
    try {
        await seek(page, 2);
        let s = await state(page);
        ok(s.visible && s.label === 'Özeti atla' && !s.faded, `recap: "${s.label}", henüz solmadı`);
        await seek(page, 3.5);
        s = await state(page);
        ok(s.visible && s.faded, `hideAfter (1 sn) doldu → data-faded (faded=${s.faded})`);
        await seek(page, 7);
        s = await state(page);
        ok(!s.visible, `showUntil (6) sonrası buton yok, bölüm sürse de (t=${s.t.toFixed(2)})`);
    } finally {
        await page.close();
    }
}

async function testAutoSkip(browser) {
    console.log('\n[3] autoSkip: 1 — oynarken bölüme girince 1 sn geri sayım, sonra kendiliğinden atlıyor');
    const page = await open(browser, [{ start: 2, end: 10, autoSkip: 1 }]);
    try {
        await seek(page, 1.4);
        await play(page);
        const entered = await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('[part="skip-segment"][data-auto]'), null, { timeout: 5000 }).then(() => true, () => false);
        ok(entered, 'bölüme oynayarak girildi, geri sayım (data-auto) başladı');
        const skipped = await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime >= 9.9, null, { timeout: 6000 }).then(() => true, () => false);
        const s = await state(page);
        ok(skipped && s.events.includes('skip:auto'), `kendiliğinden atladı (t=${s.t.toFixed(2)}) ${JSON.stringify(s.events)}`);
        ok(!s.paused, 'oynatma sürüyor');
    } finally {
        await page.close();
    }
}

async function testAutoSkipCancelledBySeek(browser) {
    console.log('\n[4] autoSkip: kullanıcı bölüme sararak girerse otomatik atlama yok (buton kalır)');
    const page = await open(browser, [{ start: 2, end: 10, autoSkip: true }]);
    try {
        await seek(page, 4);
        await play(page);
        await page.waitForTimeout(1200);
        const s = await state(page);
        ok(s.visible && !s.auto && s.t < 9 && !s.events.some((e) => e.startsWith('skip')), `sarınca otomatik atlamadı (t=${s.t.toFixed(2)}, ${JSON.stringify(s.events)})`);
        await pause(page);
    } finally {
        await page.close();
    }
}

async function testPreventDefault(browser) {
    console.log('\n[5] hp:skip preventDefault() → atlanmıyor (entegratör kendisi halleder)');
    const page = await open(browser, [{ start: 0, end: 10 }]);
    try {
        await page.evaluate(() => (window.__preventSkip = true));
        await seek(page, 3);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="skip-segment"]').click());
        await page.waitForTimeout(300);
        const s = await state(page);
        ok(s.t < 4 && s.events.includes('skip:click'), `atlama iptal edildi (t=${s.t.toFixed(2)}) ${JSON.stringify(s.events)}`);
    } finally {
        await page.close();
    }
}

async function testCreditsToEnd(browser) {
    console.log('\n[6] Jenerik: end verilmezse buton video sonuna atlıyor (ended → playlist sıradakine geçer)');
    const page = await open(browser, [{ start: 25, type: 'credits', position: 'bottom-left' }]);
    try {
        await seek(page, 26);
        let s = await state(page);
        ok(s.visible && s.label === 'Jeneriği atla' && s.position === 'bottom-left', `"${s.label}", ${s.position}`);
        await play(page);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="skip-segment"]').click());
        const ended = await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').ended, null, { timeout: 5000 }).then(() => true, () => false);
        s = await state(page);
        ok(ended, `video sona geldi (t=${s.t.toFixed(2)}, ended=${s.ended})`);
    } finally {
        await page.close();
    }
}

async function testOptionsChangeAndKeyboard(browser) {
    console.log('\n[7] Klavyeyle (Enter) basılabiliyor; options değişince eski buton kalkıyor; label ve dil');
    const page = await open(browser, [{ start: 0, end: 8, label: 'Girişi geç' }]);
    try {
        await seek(page, 2);
        let s = await state(page);
        ok(s.label === 'Girişi geç', `özel label: "${s.label}"`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="skip-segment"]').focus());
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        s = await state(page);
        ok(s.t >= 7.9 && !s.visible, `Enter ile atladı (t=${s.t.toFixed(2)})`);

        await seek(page, 2);
        ok((await state(page)).visible, 'geri sarınca buton yeniden çıktı');
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, skipSegments: [{ start: 15, end: 20, type: 'custom' }], locale: 'en' };
        });
        await page.waitForTimeout(400);
        s = await state(page);
        ok(!s.visible, `yeni bölüm listesinde eski buton kalmadı (t=${s.t.toFixed(2)})`);
        await seek(page, 16);
        s = await state(page);
        ok(s.label === 'Skip', `custom + en: "${s.label}"`);
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testShowAndClick(browser);
        await testShowUntilAndHideAfter(browser);
        await testAutoSkip(browser);
        await testAutoSkipCancelledBySeek(browser);
        await testPreventDefault(browser);
        await testCreditsToEnd(browser);
        await testOptionsChangeAndKeyboard(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
