// HopeCorePlayer — yaş doğrulama (ageGate): içerik / reklam / autoplay ertelenir, giriş, ret, hatırlama, callback'ler.
import { readFileSync } from 'node:fs';
import { launchBrowser } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
const MOCK_IMA = readFileSync(new URL('./_mock-ima.js', import.meta.url), 'utf8');
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

const year = new Date().getFullYear();

/** Yeni bağlam (temiz depolama); `setup` sayfada `el.options`'ı kurar (fonksiyonlu seçenekler için). */
async function open(browser, setup, arg, context, query = '') {
    context ??= await browser.newContext({ viewport: { width: 900, height: 560 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.addInitScript(MOCK_IMA);
    await page.addInitScript(() => {
        window.__ev = [];
        document.addEventListener('hp:agegate', (e) => window.__ev.push(e.detail), true);
    });
    await page.goto(`${BASE}/${query}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    if (setup) await page.evaluate(setup, arg);
    await page.waitForTimeout(500);
    return page;
}

const state = (page) =>
    page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const v = root.querySelector('video');
        const gate = root.querySelector('[part="age-gate"]');
        return {
            gate: !!gate,
            view: gate?.dataset.state ?? null,
            title: gate?.querySelector('.hp-age-title')?.textContent ?? null,
            inputs: gate ? gate.querySelectorAll('input').length : 0,
            error: gate?.querySelector('.hp-age-error')?.textContent ?? '',
            src: v.currentSrc || v.getAttribute('src') || '',
            readyState: v.readyState,
            paused: v.paused,
            t: v.currentTime,
            ads: (window.__adsLog ?? []).filter((e) => e.ev === 'requestAds').length,
            events: window.__ev.map((e) => `${e.state}${e.source ? ':' + e.source : ''}`),
            last: window.__ev.at(-1) ?? null,
            styled: gate ? getComputedStyle(gate).position === 'absolute' && getComputedStyle(gate).zIndex === '45' : false,
        };
    });

/** Aynı sekmede yeniden yükle (sessionStorage korunur) ve seçenekleri yeniden kur. */
async function reopen(page, setup) {
    await page.reload();
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(setup);
    await page.waitForTimeout(500);
    return page;
}

/** Alanları klavyeyle doldurur (otomatik ilerleme dahil) ve gönderir. */
async function enter(page, d, m, y) {
    const first = page.locator('hope-player .hp-age-field input').first();
    await first.click();
    await page.keyboard.type(`${d}${m}${y}`);
    await page.keyboard.press('Enter');
}

async function testBlocksUntilPassed(browser) {
    console.log('\n[1] Ekran açıkken kaynak ve preroll isteği bekliyor; kısayol oynatmıyor; geçince hepsi başlıyor');
    const page = await open(browser, null, undefined, undefined, '?feature=age-gate&ads=preroll-load');
    try {
        // Callback sonradan gelir (React yeniden render gibi) — kurulu kapı yenisini kullanmalı.
        await page.evaluate(() => {
            window.__submits = [];
            const el = document.getElementById('player');
            el.options = { ...el.options, ageGate: { ...el.options.ageGate, onSubmit: (r) => void window.__submits.push(r) } };
        });
        await page.waitForTimeout(200);
        let s = await state(page);
        ok(s.gate && s.view === 'form' && s.inputs === 3 && s.styled, `ekran stilli açıldı (${s.view}, ${s.inputs} alan)`);
        ok(s.title === 'Bu içerik 18 yaş ve üzeri içindir', `varsayılan başlık "${s.title}"`);
        ok(!s.src && s.readyState === 0, `kaynak yüklenmedi (src "${s.src}", readyState ${s.readyState})`);
        ok(s.ads === 0, `reklam istenmedi (${s.ads})`);
        ok(JSON.stringify(s.events) === '["shown"]', `hp:agegate shown ${JSON.stringify(s.events)}`);
        await page.locator('hope-player .hp-age-field input').first().focus();
        await page.keyboard.press('k');
        await page.waitForTimeout(300);
        s = await state(page);
        ok(s.paused && s.inputs === 3, 'K kısayolu alana yazıldı, video oynamadı');

        await page.locator('hope-player .hp-age-field input').first().fill('');
        await enter(page, '15', '03', '1990');
        await page.waitForTimeout(150);
        s = await state(page);
        ok(s.view === 'passed' && s.title === 'Teşekkürler, iyi seyirler!', `başarı animasyonu (${s.view}: ${s.title})`);
        await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('[part="age-gate"]'), null, { timeout: 3000 });
        await page.waitForFunction(() => (window.__adsLog ?? []).some((e) => e.ev === 'requestAds'), null, { timeout: 6000 }).catch(() => {});
        s = await state(page);
        ok(!s.gate && s.src.includes('sample.mp4'), `ekran kalktı, kaynak yüklendi (${s.src.split('/').pop()})`);
        ok(s.ads === 1, `preroll yaş doğrulandıktan sonra istendi (${s.ads})`);
        const age = year - 1990 - (new Date() < new Date(year, 2, 15) ? 1 : 0);
        ok(s.last.state === 'passed' && s.last.source === 'input' && s.last.age === age && typeof s.last.ageGroup === 'string', `passed olayı ${JSON.stringify(s.last)}`);
        ok(!('dateOfBirth' in s.last), 'olayda doğum tarihi yok');
        const sub = await page.evaluate(() => window.__submits);
        ok(sub.length === 1 && sub[0].dateOfBirth === '1990-03-15' && sub[0].passed === true && sub[0].age === age, `onSubmit tarihi aldı ${JSON.stringify(sub[0])}`);
        ok(page.__errors.length === 0, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.context().close();
    }
}

async function testInvalidAndDenied(browser) {
    console.log('\n[2] Geçersiz tarih hata veriyor; yaşı küçük izleyici reddediliyor ve sonuç oturumda hatırlanıyor');
    const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
    const setup = () => {
        document.getElementById('player').options = { src: '/sample.mp4', muted: true, ageGate: { minAge: 18 } };
    };
    let page = await open(browser, setup, undefined, context);
    try {
        await enter(page, '31', '02', '2000');
        await page.waitForTimeout(200);
        let s = await state(page);
        ok(s.view === 'form' && s.error === 'Lütfen geçerli bir tarih girin.', `31.02 geçersiz: "${s.error}"`);
        ok(await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-age-form').hasAttribute('data-invalid')), 'form sallandı (data-invalid)');
        await page.locator('hope-player .hp-age-field input').nth(0).fill('');
        await page.locator('hope-player .hp-age-field input').nth(1).fill('');
        await page.locator('hope-player .hp-age-field input').nth(2).fill('');
        await enter(page, '01', '06', String(year - 10));
        await page.waitForTimeout(300);
        s = await state(page);
        ok(s.view === 'denied' && s.title === 'Erişim kısıtlı' && s.inputs === 0, `reddedildi, form yok (${s.view})`);
        ok(s.paused && s.t < 0.5, 'video oynamadı');
        ok(s.last.state === 'denied' && s.last.source === 'input' && s.last.ageGroup === '0-12', `denied olayı ${JSON.stringify(s.last)}`);
        ok(!(await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('.hp-age-submit'))), 'retry kapalı: tekrar deneme butonu yok');
        const stored = await page.evaluate(() => sessionStorage.getItem('hp-age-gate'));
        ok(stored && !/\d{4}-\d{2}-\d{2}/.test(stored) && JSON.parse(stored).ok === false, `oturumda yalnızca yaş + sonuç saklandı ${stored}`);
        page = await reopen(page, setup);
        s = await state(page);
        ok(s.view === 'denied' && JSON.stringify(s.events) === '["denied:remembered"]', `yeniden açılınca doğrudan ret ${JSON.stringify(s.events)}`);
    } finally {
        await context.close();
    }
}

async function testRememberAndRetry(browser) {
    console.log('\n[3] Geçen izleyici oturumda tekrar sorulmuyor; retry ile ret sonrası düzeltilebiliyor');
    const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
    const setup = () => {
        document.getElementById('player').options = { src: '/sample.mp4', muted: true, ageGate: { retry: true } };
    };
    let page = await open(browser, setup, undefined, context);
    try {
        await enter(page, '01', '01', String(year - 12));
        await page.waitForTimeout(300);
        let s = await state(page);
        ok(s.view === 'denied', 'önce reddedildi');
        await page.locator('hope-player .hp-age-submit').click();
        await page.waitForTimeout(200);
        s = await state(page);
        ok(s.view === 'form' && s.events.at(-1) === 'shown', 'tarihi düzelt → form yeniden açıldı');
        await enter(page, '01', '01', String(year - 30));
        await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('[part="age-gate"]'), null, { timeout: 3000 });
        page = await reopen(page, setup);
        s = await state(page);
        ok(!s.gate && s.src.includes('sample.mp4') && JSON.stringify(s.events) === '["passed:remembered"]', `oturumda hatırlandı, ekran yok ${JSON.stringify(s.events)}`);
    } finally {
        await context.close();
    }
}

async function testCallbacks(browser) {
    console.log('\n[4] checkAge (site doğruladı) ekranı atlatıyor; onSubmit false → ret; yapıştırılan tarih alanlara dağılıyor');
    let page = await open(browser, () => {
        document.getElementById('player').options = {
            src: '/sample.mp4',
            muted: true,
            ageGate: { remember: false, checkAge: () => new Promise((r) => setTimeout(() => r(true), 200)) },
        };
    });
    try {
        await page.waitForTimeout(300);
        const s = await state(page);
        ok(!s.gate && s.src.includes('sample.mp4') && JSON.stringify(s.events) === '["passed:check"]', `checkAge true → ekran yok ${JSON.stringify(s.events)}`);
    } finally {
        await page.context().close();
    }

    page = await open(browser, () => {
        document.getElementById('player').options = {
            src: '/sample.mp4',
            muted: true,
            ageGate: { remember: false, onSubmit: () => new Promise((r) => setTimeout(() => r(false), 300)) },
        };
    });
    try {
        const input = page.locator('hope-player .hp-age-field input').first();
        await input.click();
        await page.evaluate(() => {
            const el = document.getElementById('player').shadowRoot.querySelector('.hp-age-field input');
            el.value = '15.03.1990';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const vals = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-age-field input')].map((i) => i.value));
        ok(JSON.stringify(vals) === '["15","03","1990"]', `yapıştırma dağıtıldı ${JSON.stringify(vals)}`);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(100);
        const busy = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-age-form')?.hasAttribute('data-busy'));
        ok(busy, 'onSubmit beklenirken buton meşgul');
        await page.waitForTimeout(500);
        const s = await state(page);
        ok(s.view === 'denied' && s.paused && s.last.state === 'denied', `onSubmit false → ret (${s.view})`);
        const stored = await page.evaluate(() => sessionStorage.getItem('hp-age-gate'));
        ok(stored === null, 'remember: false → hiçbir şey saklanmadı');
    } finally {
        await page.context().close();
    }
}

async function testPrivacy(browser) {
    console.log('\n[5] İşlevsel onay yoksa sonuç tarayıcıya yazılmıyor (yalnızca bu sayfa); ekran mobil boyutta sığıyor');
    const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const page = await open(
        browser,
        () => {
            document.getElementById('player').style.width = '340px';
            document.getElementById('player').options = { src: '/sample.mp4', muted: true, privacy: { default: 'deny' }, ageGate: { remember: 30 } };
        },
        undefined,
        context
    );
    try {
        const fit = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const area = root.querySelector('[part="age-gate"]').getBoundingClientRect();
            const card = root.querySelector('.hp-age-card').getBoundingClientRect();
            return { compact: root.querySelector('.video-area')?.hasAttribute('data-compact'), cardW: Math.round(card.width), areaW: Math.round(area.width) };
        });
        ok(fit.cardW <= fit.areaW, `kart player'a sığıyor ${JSON.stringify(fit)}`);
        await enter(page, '15', '03', '1990');
        await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('[part="age-gate"]'), null, { timeout: 3000 });
        const stored = await page.evaluate(() => [localStorage.getItem('hp-age-gate'), sessionStorage.getItem('hp-age-gate')]);
        ok(stored[0] === null && stored[1] === null, `tarayıcıya yazılmadı ${JSON.stringify(stored)}`);
    } finally {
        await context.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testBlocksUntilPassed(browser);
        await testInvalidAndDenied(browser);
        await testRememberAndRetry(browser);
        await testCallbacks(browser);
        await testPrivacy(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
