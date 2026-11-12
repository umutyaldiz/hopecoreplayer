// HopeCorePlayer — etkileşimli içerik (anket, quiz, ürün kartı) ve Document Picture-in-Picture.
// Document PiP API'si testte window.open ile açılan aynı kökenli bir pencereyle taklit edilir.
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

async function open(browser, feature, init) {
    const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
    const page = await context.newPage();
    const errors = [];
    // Pencereler arası taşımada tarayıcının zararsız ResizeObserver uyarısı hata sayılmaz.
    page.on('pageerror', (e) => !/ResizeObserver loop/.test(String(e)) && errors.push(String(e)));
    page.__errors = errors;
    if (init) await page.addInitScript(init);
    await page.goto(`${BASE}/${feature ? `?feature=${feature}` : ''}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => {
        window.__ev = [];
        const el = document.getElementById('player');
        for (const t of ['hp:interactive', 'hp:pip']) el.addEventListener(t, (e) => window.__ev.push({ t, ...e.detail }));
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000, polling: 50 });
    await page.waitForTimeout(400);
    return { page, context };
}

const seekPlay = (page, t) =>
    page.evaluate((t) => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        v.currentTime = t;
        return v.play().catch(() => {});
    }, t);

const ia = (page) =>
    page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const box = r.querySelector('.hp-ia');
        const v = r.querySelector('video');
        return {
            type: box?.getAttribute('data-type') ?? null,
            question: box?.querySelector('.hp-ia-question')?.textContent ?? null,
            pcts: [...(box?.querySelectorAll('.hp-ia-pct') ?? [])].map((e) => e.textContent),
            correct: [...(box?.querySelectorAll('.hp-ia-choice') ?? [])].findIndex((b) => b.hasAttribute('data-correct')),
            wrong: [...(box?.querySelectorAll('.hp-ia-choice') ?? [])].findIndex((b) => b.hasAttribute('data-wrong')),
            status: box?.querySelector('.hp-ia-status')?.textContent ?? '',
            price: box?.querySelector('.hp-ia-price')?.textContent ?? null,
            label: box?.querySelector('.hp-ia-label')?.textContent ?? null,
            markers: r.querySelectorAll('.hp-ia-marker').length,
            paused: v.paused,
            t: v.currentTime,
            ev: (window.__ev ?? []).filter((e) => e.t === "hp:interactive"),
        };
    });

const waitType = (page, type, timeout = 4000) =>
    page
        .waitForFunction((type) => document.getElementById('player').shadowRoot.querySelector('.hp-ia')?.getAttribute('data-type') === (type ?? undefined), type, { timeout, polling: 50 })
        .catch(() => {});
const waitGone = (page, timeout = 6000) =>
    page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('.hp-ia'), null, { timeout, polling: 50 }).catch(() => {});
const click = (page, sel, i = 0) => page.evaluate(({ sel, i }) => document.getElementById('player').shadowRoot.querySelectorAll(sel)[i]?.click(), { sel, i });

async function testIsolation(browser) {
    console.log('\n[1] Etkileşimli içerik ve Document PiP yalnızca açıkken ayrı parça indiriyor mu?');
    const urls = async (feature) => {
        const { page, context } = await open(browser, feature, feature === 'docpip' ? PIP_MOCK : undefined);
        const set = new Set(await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/chunks/'))));
        await context.close();
        return set;
    };
    const base = await urls(null);
    for (const f of ['interactive', 'docpip']) {
        const extra = [...(await urls(f))].filter((u) => !base.has(u));
        ok(extra.length > 0, `?feature=${f} → yeni parça (${extra.map((u) => u.split('/').pop()).join(', ')})`);
    }
}

async function testPoll(browser) {
    console.log('\n[2] Anket: zamanında açılır, oy → yüzdeler, kendiliğinden kapanır, bir daha sorulmaz');
    const { page, context } = await open(browser, 'interactive');
    try {
        let s = await ia(page);
        ok(s.markers === 3, `seek bar'da 3 nokta (${s.markers})`);
        await seekPlay(page, 0.6);
        await waitType(page, 'poll');
        s = await ia(page);
        ok(s.type === 'poll' && s.question === 'En sevdiğiniz semt?' && s.label === 'Anket', `1. sn → anket (${s.question})`);
        ok(s.ev.some((e) => e.state === 'shown' && e.id === 'pg-poll'), 'hp:interactive shown');
        await click(page, '.hp-ia-choice', 1);
        await page.waitForTimeout(200);
        s = await ia(page);
        // [5, 3, 2] + bu oy (1) → [5, 4, 2] / 11
        ok(s.pcts.join(',') === '%45,%36,%18', `oy → yüzdeler (${s.pcts.join(',')})`);
        ok(s.ev.some((e) => e.state === 'answer' && e.choice === 1 && e.choiceId === '1'), 'hp:interactive answer (choice 1)');
        // Sonuç gösterilirken 3. sn'deki quiz gelirse anket ona yer açar — anketin kapanması yeterli.
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-ia')?.getAttribute('data-type') !== 'poll', null, { timeout: 6000, polling: 50 }).catch(() => {});
        ok((await ia(page)).type !== 'poll', 'sonuçtan sonra anket kapandı');
        const stored = await page.evaluate(() => localStorage.getItem('hp-interactive:pg-poll'));
        ok(stored === '1', `cevap hatırlandı (${stored})`);

        await page.reload();
        await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video')?.readyState >= 1, null, { timeout: 10000, polling: 50 });
        await page.waitForTimeout(400);
        await seekPlay(page, 0.6);
        await page.waitForTimeout(1500);
        ok((await ia(page)).type !== 'poll', 'yeniden yükleyince aynı anket sorulmadı');
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await context.close();
    }
}

async function testQuizAndCard(browser) {
    console.log('\n[3] Quiz (pause): video durur, yanlış cevap → doğru gösterilir, sonra devam eder; ürün kartı; ileri sarma');
    const { page, context } = await open(browser, 'interactive');
    try {
        await page.evaluate(() => localStorage.clear());
        await seekPlay(page, 2.7);
        await waitType(page, 'quiz');
        let s = await ia(page);
        ok(s.type === 'quiz' && s.paused, `3. sn → quiz, video duraklatıldı (paused=${s.paused})`);
        await page.waitForTimeout(600);
        ok((await ia(page)).type === 'quiz', 'duraklıyken süre işlemiyor, quiz açık kaldı');
        await click(page, '.hp-ia-choice', 0);
        await page.waitForTimeout(200);
        s = await ia(page);
        ok(s.wrong === 0 && s.correct === 1 && s.status === 'Yanlış Nevşehir çevresi.', `yanlış → doğru şık işaretlendi + açıklama (${s.status})`);
        ok(s.ev.some((e) => e.state === 'answer' && e.correct === false), 'hp:interactive answer correct=false');
        await waitGone(page, 7000);
        await page.waitForTimeout(300);
        s = await ia(page);
        ok(s.type === null && !s.paused, `quiz kapandı, oynatma devam ediyor (paused=${s.paused})`);

        // Ürün kartı: 6. sn.
        await seekPlay(page, 5.7);
        await waitType(page, 'product');
        s = await ia(page);
        ok(s.type === 'product' && s.price === '₺349₺429' && s.label === 'Sponsorlu', `ürün kartı: fiyat + eski fiyat + Sponsorlu (${s.price})`);
        await page.evaluate(() => {
            document.getElementById('player').addEventListener('hp:interactive', (e) => {
                if (e.detail.state === 'click') e.preventDefault();
            });
        });
        const pages = context.pages().length;
        await click(page, '.hp-ia-card');
        await page.waitForTimeout(300);
        s = await ia(page);
        ok(s.ev.some((e) => e.state === 'click' && e.url === 'https://example.com/urun') && context.pages().length === pages, 'tıklama olayı (url), preventDefault → sekme açılmadı');
        await click(page, '.hp-ia-close');
        s = await ia(page);
        ok(s.type === null && s.ev.some((e) => e.state === 'dismiss' && e.reason === 'user' && e.id === 'pg-product'), 'X → dismiss (user)');

        // İleri sarıp geçilen öğe gösterilmez.
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video')?.readyState >= 1, null, { timeout: 10000, polling: 50 });
        await page.waitForTimeout(400);
        await page.evaluate(() => {
            window.__ev = [];
            document.getElementById('player').addEventListener('hp:interactive', (e) => window.__ev.push({ t: 'hp:interactive', ...e.detail }));
        });
        await seekPlay(page, 8);
        await page.waitForTimeout(800);
        s = await ia(page);
        ok(s.type === null && !s.ev.some((e) => e.state === 'shown'), '8. sn\'ye atlandı → geçilen öğeler gösterilmedi');

        // Süre dolunca kapanır (ürün kartı 3 sn).
        await seekPlay(page, 5.8);
        await waitType(page, 'product');
        await waitGone(page, 6000);
        s = await ia(page);
        ok(s.ev.some((e) => e.state === 'dismiss' && e.reason === 'timeout'), 'süre doldu → dismiss (timeout)');
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await context.close();
    }
}

// documentPictureInPicture taklidi: aynı kökenli açılır pencere.
const PIP_MOCK = () => {
    window.documentPictureInPicture = {
        window: null,
        async requestWindow({ width, height } = {}) {
            const w = window.open('', '', `popup,width=${width},height=${height}`);
            this.window = w;
            w.addEventListener('pagehide', () => (this.window = null));
            return w;
        },
    };
};

async function testDocumentPip(browser) {
    console.log('\n[4] Document PiP: video alanı pencereye taşınır, oynatma sürer, kısayollar çalışır, geri al');
    const { page, context } = await open(browser, 'docpip', PIP_MOCK);
    try {
        await seekPlay(page, 0);
        await page.waitForTimeout(300);
        const popupP = context.waitForEvent('page');
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Resim içinde resim"]').click());
        const popup = await popupP;
        await page.waitForTimeout(500);
        let s = await page.evaluate(() => {
            const el = document.getElementById('player');
            const r = el.shadowRoot;
            const w = window.documentPictureInPicture.window;
            const host = w?.document.querySelector('.hp-docpip');
            const area = host?.shadowRoot?.querySelector('.video-area');
            return {
                placeholder: r.querySelector('[part="pip-placeholder"]')?.textContent ?? null,
                inMain: !!r.querySelector('.video-area'),
                inPip: !!area,
                attr: el.hasAttribute('data-doc-pip'),
                width: area ? Math.round(area.getBoundingClientRect().width) : 0,
                winWidth: w?.innerWidth ?? 0,
                paused: area?.querySelector('video')?.paused,
                fullscreenHidden: area ? getComputedStyle(area.querySelector('[aria-label="Tam ekran"]')).display === 'none' : null,
                ev: window.__ev.filter((e) => e.t === 'hp:pip'),
            };
        });
        ok(s.inPip && !s.inMain && s.attr, 'video alanı PiP penceresine taşındı');
        ok(s.placeholder?.includes('Buraya geri al'), `sayfada yer tutucu (${s.placeholder})`);
        ok(s.width > 0 && Math.abs(s.width - s.winWidth) < 2, `pencereyi dolduruyor (${s.width}/${s.winWidth})`);
        ok(s.paused === false, 'taşırken oynatma kesilmedi');
        ok(s.fullscreenHidden === true, 'PiP penceresinde tam ekran butonu gizli');
        ok(s.ev.some((e) => e.state === 'enter' && e.mode === 'document'), 'hp:pip enter (document)');

        // Kısayol: PiP penceresinde "k" → duraklat.
        await popup.bringToFront();
        await popup.keyboard.press('k');
        await page.waitForTimeout(200);
        const pausedByKey = await page.evaluate(() => window.documentPictureInPicture.window.document.querySelector('.hp-docpip').shadowRoot.querySelector('video').paused);
        ok(pausedByKey === true, 'PiP penceresinde "k" → duraklatıldı');

        // Sayfadaki "Buraya geri al" → pencere kapanır, alan geri döner.
        await page.bringToFront();
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="pip-placeholder"] button').click());
        await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('.video-area'), null, { timeout: 3000, polling: 50 }).catch(() => {});
        s = await page.evaluate(() => {
            const el = document.getElementById('player');
            const r = el.shadowRoot;
            return {
                back: !!r.querySelector('.video-area'),
                placeholder: !!r.querySelector('[part="pip-placeholder"]'),
                attr: el.hasAttribute('data-doc-pip'),
                fullscreenShown: getComputedStyle(r.querySelector('[aria-label="Tam ekran"]')).display !== 'none',
                ev: window.__ev.filter((e) => e.t === 'hp:pip'),
            };
        });
        ok(s.back && !s.placeholder && !s.attr, 'geri al → video alanı yerine döndü');
        ok(s.fullscreenShown, 'tam ekran butonu geri geldi');
        ok(s.ev.some((e) => e.state === 'exit' && e.mode === 'document'), 'hp:pip exit (document)');

        // Kodla aç / PiP penceresindeki PiP butonuyla kapat.
        const popup2P = context.waitForEvent('page');
        await page.evaluate(() => document.getElementById('player').togglePip());
        await popup2P;
        await page.waitForTimeout(300);
        await page.evaluate(() =>
            window.documentPictureInPicture.window.document.querySelector('.hp-docpip').shadowRoot.querySelector('[aria-label="Resim içinde resim"]').click()
        );
        await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('.video-area'), null, { timeout: 3000, polling: 50 }).catch(() => {});
        ok(await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('.video-area')), 'togglePip() açtı, penceredeki PiP butonu kapattı');
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await context.close();
    }

    // API yoksa: normal PiP butonu davranışı (Document PiP kurulmaz).
    const { page: p2, context: c2 } = await open(browser, 'docpip', () => {
        delete window.documentPictureInPicture;
    });
    try {
        const s = await p2.evaluate(() => ({ api: 'documentPictureInPicture' in window, chunk: performance.getEntriesByType('resource').some((e) => /docPip/.test(e.name)) }));
        ok(!s.api && !s.chunk, `API yoksa Document PiP parçası indirilmedi (api=${s.api}, chunk=${s.chunk})`);
    } finally {
        await c2.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testIsolation(browser);
        await testPoll(browser);
        await testQuizAndCard(browser);
        await testDocumentPip(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
