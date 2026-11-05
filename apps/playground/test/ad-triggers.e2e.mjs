// HopeCorePlayer — reklam tetikleyici (adTriggers): API kuralları, saniye / tam ekran / duraklatma tetikleyicileri,
// out-of-page GPT slotu (sahte GPT ile), sıklık sınırları ve kapanış. Gerçek gpt.js yerine route ile sahtesi verilir.
// Playground çalışıyor olmalı (npm run dev --workspace=apps/playground, port HOPE_TEST_PORT ya da 5183).
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

/** Sahte GPT: out-of-page slotu tanımlar, display'de div'e iframe basar; yolunda "empty" geçen birim boş döner. */
const MOCK_GPT = `(() => {
    const queued = (window.googletag && window.googletag.cmd) || [];
    const listeners = {};
    const slots = [];
    window.__gpt = { requests: [], destroyed: 0 };
    const pubads = {
        addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
        removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
        isInitialLoadDisabled: () => false,
        refresh() {},
    };
    const gt = {
        apiReady: true,
        cmd: { push: (fn) => fn() },
        pubads: () => pubads,
        enableServices() {},
        defineOutOfPageSlot(path, divId) {
            const slot = { path, divId, targeting: {}, addService() { return slot; }, setTargeting(k, v) { slot.targeting[k] = v; return slot; }, getSlotElementId: () => divId };
            slots.push(slot);
            return slot;
        },
        display(divId) {
            const slot = slots.find((s) => s.divId === divId);
            window.__gpt.requests.push({ path: slot.path, targeting: { ...slot.targeting }, inHost: !!document.getElementById(divId)?.closest('hope-player') });
            setTimeout(() => {
                const empty = slot.path.includes('empty');
                if (!empty) document.getElementById(divId).innerHTML = '<iframe title="ad" style="width:1px;height:1px;border:0" srcdoc="<body style=margin:0;background:#c8873a>AD</body>"></iframe>';
                for (const fn of listeners.slotRenderEnded || []) fn({ slot, isEmpty: empty, size: empty ? null : [1, 1] });
            }, 80);
        },
        destroySlots(list) { window.__gpt.destroyed += list.length; for (const s of list) { const el = document.getElementById(s.divId); if (el) el.innerHTML = ''; } return true; },
    };
    window.googletag = gt;
    for (const fn of queued) fn();
})();`;

async function open(browser, config, { gpt = 'mock' } = {}) {
    const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
    await context.route('**/ad-triggers.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(config) }));
    await context.route('**/tag/js/gpt.js', (r) =>
        gpt === 'mock' ? r.fulfill({ contentType: 'text/javascript', body: MOCK_GPT }) : gpt === 'block' ? r.abort('blockedbyclient') : null
    );
    const page = await context.newPage();
    await page.addInitScript(() => {
        window.__ev = [];
        document.addEventListener('DOMContentLoaded', () => {
            const el = document.getElementById('player');
            for (const t of ['hp:adtriggers', 'hp:adtriggershow', 'hp:adtriggerempty', 'hp:adtriggerclose'])
                el?.addEventListener(t, (e) => window.__ev.push({ t: t.slice(3), ...(t === 'hp:adtriggers' ? { rules: e.detail.config?.rules.length ?? 0 } : e.detail) }));
        });
    });
    await page.goto(`${BASE}/?feature=adtriggers`);
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'adtriggers'), null, { timeout: 8000 });
    return { page, context };
}

const state = (page) =>
    page.evaluate(() => {
        const el = document.getElementById('player');
        const box = el.shadowRoot.querySelector('[part="ad-trigger"]');
        const r = box?.querySelector('.hp-adtrigger-frame')?.getBoundingClientRect();
        const v = el.shadowRoot.querySelector('video');
        return {
            open: !!box?.hasAttribute('data-open'),
            layout: box?.getAttribute('data-layout') ?? null,
            frame: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
            closeVisible: !!box && !box.querySelector('.hp-adtrigger-close')?.hidden,
            label: box?.querySelector('.hp-adtrigger-label')?.textContent ?? null,
            lightAds: el.querySelectorAll('[id^="hp-adtrigger-"]').length,
            paused: v.paused,
            time: v.currentTime,
            ev: window.__ev.slice(),
            requests: window.__gpt?.requests ?? [],
        };
    });

const play = (page) => page.evaluate(() => document.getElementById('player').play());
const rule = (r) => ({ adUnitPath: '/6355419/Travel', ...r });

async function testTimeTrigger(browser) {
    console.log('\n[1] Saniye tetikleyici: at 2 sn → out-of-page slot istendi, kutu açıldı; duration ile kapandı');
    const { page, context } = await open(browser, {
        active: true,
        rules: [rule({ id: 'at2', triggers: [{ type: 'time', at: [2] }], layout: 'bottom', size: [320, 50], duration: 2, targeting: { pos: 'bottom' } })],
    });
    let s = await state(page);
    ok(s.ev[0].rules === 1 && !s.open && s.requests.length === 0, 'kurallar yüklendi, henüz istek yok');
    await play(page);
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'adtriggershow'), null, { timeout: 6000 }).catch(() => {});
    s = await state(page);
    const req = s.requests[0];
    ok(s.open && s.layout === 'bottom' && s.frame?.w === 320 && s.frame?.h === 50, `kutu açık (${s.layout}, ${JSON.stringify(s.frame)})`);
    ok(req?.path === '/6355419/Travel' && req.inHost, `GPT out-of-page slotu, div host'un light DOM'unda (${req?.path})`);
    ok(req?.targeting.hp_trigger === 'time' && req.targeting.hp_mode === 'normal' && req.targeting.hp_rule === 'at2' && req.targeting.pos === 'bottom' && req.targeting.content === 'istanbul',
        `hedefleme: ${JSON.stringify(req?.targeting)}`);
    ok(s.label === 'Reklam' && s.closeVisible && !s.paused, `etiket "${s.label}", kapat butonu (${s.closeVisible}), içerik oynamaya devam ediyor (paused=${s.paused}, t=${s.time.toFixed(2)})`);
    await page.waitForTimeout(2300);
    s = await state(page);
    ok(!s.open && s.lightAds === 0 && s.ev.some((e) => e.t === 'adtriggerclose' && e.reason === 'timeout'), `duration doldu → kapandı, slot temizlendi`);
    await context.close();
}

async function testFullscreenTrigger(browser) {
    console.log('\n[2] Tam ekrana girince 1 sn sonra (mode: fullscreen); çıkınca kapanır; tam ekran değilken tetiklenmez');
    const { page, context } = await open(browser, {
        active: true,
        minGapSeconds: 0,
        rules: [rule({ id: 'fs', mode: 'fullscreen', triggers: [{ type: 'fullscreen', delay: 1 }], layout: 'center', size: [300, 250], closeDelay: 1 })],
    });
    await play(page);
    await page.evaluate(() => document.getElementById('player').requestFullscreen());
    await page.waitForTimeout(500);
    let s = await state(page);
    ok(!s.open && s.requests.length === 0, 'gecikme sürerken istek yok');
    await page.waitForTimeout(900);
    s = await state(page);
    const fsNow = await page.evaluate(() => document.fullscreenElement?.id);
    ok(fsNow === 'player' && s.open && s.requests[0]?.targeting.hp_mode === 'fullscreen', `tam ekranda gösterildi (hp_mode=${s.requests[0]?.targeting.hp_mode})`);
    ok(!s.closeVisible, 'kapat butonu closeDelay boyunca gizli');
    await page.waitForTimeout(1100);
    s = await state(page);
    ok(s.closeVisible, 'closeDelay sonra kapat butonu göründü');
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForTimeout(300);
    s = await state(page);
    ok(!s.open && s.ev.some((e) => e.t === 'adtriggerclose' && e.reason === 'mode'), 'tam ekrandan çıkınca kapandı (reason: mode)');
    // Girip gecikme dolmadan çıkmak → istek yok.
    await page.evaluate(() => document.getElementById('player').requestFullscreen());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForTimeout(1200);
    s = await state(page);
    ok(s.requests.length === 1, `gecikme dolmadan çıkıldı → yeni istek yok (${s.requests.length})`);
    await context.close();
}

async function testPauseAndClose(browser) {
    console.log('\n[3] Duraklatınca (delay 0.5): kutu açılır; X ile kapanır; maxShows: 1');
    const { page, context } = await open(browser, {
        active: true,
        minGapSeconds: 0,
        rules: [rule({ id: 'p', triggers: [{ type: 'pause', delay: 0.5 }], layout: 'center', size: [300, 250], backdrop: true, maxShows: 1, label: 'Sponsorlu' })],
    });
    await play(page);
    await page.waitForTimeout(800);
    await page.evaluate(() => document.getElementById('player').pause());
    await page.waitForTimeout(800);
    let s = await state(page);
    ok(s.open && s.label === 'Sponsorlu', `duraklatınca açıldı (etiket "${s.label}")`);
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-adtrigger-close').click());
    await page.waitForTimeout(200);
    s = await state(page);
    ok(!s.open && s.ev.some((e) => e.t === 'adtriggerclose' && e.reason === 'user') && s.paused, 'X → kapandı, içerik duraklatılmış kaldı');
    await play(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => document.getElementById('player').pause());
    await page.waitForTimeout(800);
    s = await state(page);
    ok(!s.open && s.requests.length === 1, `maxShows: 1 → ikinci duraklatmada istek yok (${s.requests.length})`);
    await context.close();
}

async function testPauseContentAndEmpty(browser) {
    console.log('\n[4] pauseContent: reklam görünürken içerik durur, kapanınca devam eder; boş birim → kutu açılmaz');
    const { page, context } = await open(browser, {
        active: true,
        minGapSeconds: 0,
        rules: [
            rule({ id: 'empty', adUnitPath: '/123/empty_unit', triggers: [{ type: 'time', at: [1] }] }),
            rule({ id: 'pc', triggers: [{ type: 'time', at: [2.5] }], pauseContent: true, layout: 'full' }),
        ],
    });
    await play(page);
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'adtriggerempty'), null, { timeout: 5000 }).catch(() => {});
    let s = await state(page);
    ok(s.ev.some((e) => e.t === 'adtriggerempty' && e.rule === 'empty') && !s.open && s.lightAds === 0, 'boş birim → hp:adtriggerempty, kutu yok');
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'adtriggershow'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    s = await state(page);
    const full = await page.evaluate(() => {
        const a = document.getElementById('player').shadowRoot.querySelector('.video-area').getBoundingClientRect();
        const f = document.getElementById('player').shadowRoot.querySelector('.hp-adtrigger-frame').getBoundingClientRect();
        return Math.abs(a.width - f.width) < 2 && Math.abs(a.height - f.height) < 2;
    });
    ok(s.open && s.paused && full, `tam alan reklam açık, içerik duraklatıldı (paused=${s.paused}, tam alan=${full})`);
    const pauseRules = s.ev.filter((e) => e.t === 'adtriggershow').length;
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-adtrigger-close').click());
    await page.waitForTimeout(500);
    s = await state(page);
    ok(!s.open && !s.paused && pauseRules === 1, 'kapandı → içerik devam ediyor');
    await context.close();
}

async function testSeekSkipsAndGap(browser) {
    console.log('\n[5] İleri sarınca aradaki saniye tetiklenmez; minGapSeconds iki reklamı ayırır');
    const { page, context } = await open(browser, {
        active: true,
        minGapSeconds: 60,
        rules: [rule({ id: 'a', triggers: [{ type: 'time', at: [10] }], duration: 1 }), rule({ id: 'b', triggers: [{ type: 'time', at: [1.5, 2.5] }], duration: 1 })],
    });
    await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 12));
    await play(page);
    await page.waitForTimeout(1200);
    let s = await state(page);
    ok(!s.requests.some((r) => r.targeting.hp_rule === 'a'), "12. saniyeye atlandı → 10 sn tetiklenmedi");
    await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 0));
    await page.waitForTimeout(3500);
    s = await state(page);
    const b = s.requests.filter((r) => r.targeting.hp_rule === 'b').length;
    ok(b === 1, `1.5 ve 2.5 sn: minGapSeconds 60 → yalnızca bir istek (${b})`);
    await context.close();
}

async function testBlockedGpt(browser) {
    console.log('\n[6] gpt.js engelli → kutu açılmaz, takılı kalmaz (empty)');
    const { page, context } = await open(browser, { active: true, rules: [rule({ triggers: [{ type: 'start' }] })] }, { gpt: 'block' });
    await play(page);
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'adtriggerempty'), null, { timeout: 10000 }).catch(() => {});
    const s = await state(page);
    ok(s.ev.some((e) => e.t === 'adtriggerempty') && !s.open && s.lightAds === 0, 'engelli GPT → hp:adtriggerempty, temiz');
    await context.close();
}

async function testValidation(browser) {
    console.log('\n[7] Doğrulama: geçersiz kurallar atılır; active:false / süresi dolmuş → kapalı');
    const { page, context } = await open(browser, {
        active: true,
        rules: [
            { adUnitPath: 'javascript:alert(1)', triggers: [{ type: 'start' }] },
            { adUnitPath: '/123/ok', triggers: [{ type: 'bogus' }] },
            { adUnitPath: '/123/ok', triggers: [{ type: 'time', at: ['x', 4] }, { type: 'interval', every: 2 }], layout: 'weird' },
        ],
    });
    const cfg = await page.evaluate(() => document.getElementById('player').shadowRoot && window.__ev[0]);
    ok(cfg.rules === 1, `yalnızca geçerli kural kaldı (${cfg.rules})`);
    await context.close();
    for (const [name, c] of [
        ['active: false', { active: false, rules: [rule({ triggers: [{ type: 'start' }] })] }],
        ['validUntil geçmiş', { active: true, validUntil: '2000-01-01T00:00:00Z', rules: [rule({ triggers: [{ type: 'start' }] })] }],
    ]) {
        const { page: p2, context: c2 } = await open(browser, c);
        const ev = await p2.evaluate(() => window.__ev.slice());
        ok(ev.every((e) => e.t !== 'adtriggers' || e.rules === 0), `${name} → modül kapalı`);
        await c2.close();
    }
}

async function testInterval(browser) {
    console.log('\n[8] interval: startAfter 1 sn izlemede ilk reklam; duraklatılmışken sayaç işlemez');
    const { page, context } = await open(browser, {
        active: true,
        minGapSeconds: 0,
        rules: [rule({ id: 'iv', triggers: [{ type: 'interval', every: 10, startAfter: 1 }], duration: 1 })],
    });
    await page.waitForTimeout(2500);
    let s = await state(page);
    ok(s.requests.length === 0, 'oynatılmadan (duraklatılmış) 2.5 sn → istek yok');
    await play(page);
    await page.waitForFunction(() => window.__gpt?.requests.length > 0, null, { timeout: 5000 }).catch(() => {});
    s = await state(page);
    ok(s.requests[0]?.targeting.hp_trigger === 'interval', `izleme ~1 sn → interval reklamı (${s.requests.length})`);
    await context.close();
}

async function testLayoutNone(browser) {
    console.log('\n[9] layout verilmezse "none": yalnızca DFP isteği — kutu/etiket/X yok; yeni tetikleme değiştirir; closeAdTrigger() kapatır');
    const { page, context } = await open(browser, {
        active: true,
        minGapSeconds: 0,
        // raw2 pause ile: ilk reklam yerleştikten SONRA tetiklenir (time at 1.5 yavaş makinede ilk istek sürerken
        // geliyor ve doğru biçimde atlanıyordu — bkz. [10]).
        rules: [rule({ id: 'raw', triggers: [{ type: 'start' }] }), rule({ id: 'raw2', triggers: [{ type: 'pause' }] })],
    });
    await play(page);
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'adtriggershow'), null, { timeout: 5000 }).catch(() => {});
    let s = await state(page);
    const bare = await page.evaluate(() => {
        const box = document.getElementById('player').shadowRoot.querySelector('[part="ad-trigger"]');
        return { label: !!box?.querySelector('.hp-adtrigger-label'), close: !!box?.querySelector('.hp-adtrigger-close'), backdrop: !!box?.hasAttribute('data-backdrop') };
    });
    ok(s.open && s.layout === 'none' && !bare.label && !bare.close && !bare.backdrop && s.lightAds === 1, `none: istek atıldı, kreatif yerleşti; etiket/X/karartma yok (${JSON.stringify(bare)})`);
    await page.evaluate(() => document.getElementById('player').pause());
    await page.waitForFunction(() => window.__ev.filter((e) => e.t === 'adtriggershow').length >= 2, null, { timeout: 5000 }).catch(() => {});
    s = await state(page);
    ok(s.ev.some((e) => e.t === 'adtriggerclose' && e.rule === 'raw' && e.reason === 'replaced') && s.open && s.lightAds === 1, 'yeni tetikleme önceki none reklamını değiştirdi (reason: replaced)');
    await page.evaluate(() => document.getElementById('player').closeAdTrigger());
    await page.waitForTimeout(200);
    s = await state(page);
    ok(!s.open && s.lightAds === 0 && s.ev.some((e) => e.t === 'adtriggerclose' && e.rule === 'raw2' && e.reason === 'user'), 'closeAdTrigger() → kapandı');
    await context.close();
}

async function testCustParams(browser) {
    console.log('\n[10] cust_params: JSON nesnesi, "k=v&k2=a,b" metni ve sayfa geneli değerler DFP isteğine key-value olarak gider');
    const { page, context } = await open(browser, {
        active: true,
        minGapSeconds: 0,
        rules: [
            rule({ id: 'json', triggers: [{ type: 'start' }], custParams: { sezon: 2026, canli: true, etiket: ['mac', 'ozet'], kanal: 'kural', 'bad key!': 'x' } }),
            // pause: ilk reklam yerleştikten SONRA tetiklenir. Eskiden time at 1.5 idi — yavaş makinede (Linux WebKit)
            // ilk istek 1.5 sn'de hâlâ sürüyordu, ikinci kural doğru biçimde atlanıyor ("another ad is showing") ve test düşüyordu.
            rule({ id: 'text', triggers: [{ type: 'pause' }], cust_params: 'kategori=spor&etiket=gol,video' }),
        ],
    });
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { ...el.options, adTriggers: { ...el.options.adTriggers, custParams: { kanal: 'sayfa', yazar: 'umut' } } };
    });
    await page.waitForTimeout(200);
    await play(page);
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'adtriggershow'), null, { timeout: 6000 }).catch(() => {});
    await page.evaluate(() => document.getElementById('player').pause());
    await page.waitForFunction(() => window.__gpt?.requests.length >= 2, null, { timeout: 6000 }).catch(() => {});
    const s = await state(page);
    const [a, b] = s.requests.map((r) => r.targeting);
    ok(a?.sezon === '2026' && a.canli === 'true' && a.etiket?.join() === 'mac,ozet' && !('bad key!' in a), `JSON: ${JSON.stringify(a)}`);
    ok(a?.kanal === 'kural' && a.yazar === 'umut' && a.content === 'istanbul', 'öncelik: kural custParams > sayfa custParams > sayfa targeting');
    ok(b?.kategori === 'spor' && b.etiket?.join() === 'gol,video' && b.kanal === 'sayfa' && b.hp_rule === 'text', `metin (cust_params): ${JSON.stringify(b)}`);
    const show = s.ev.find((e) => e.t === 'adtriggershow');
    ok(show?.custParams?.sezon === '2026' && show.custParams.hp_trigger === 'start', 'hp:adtriggershow detayında giden key-value\'lar var');
    await context.close();
}

(async () => {
    const browser = await launchBrowser({ autoplay: true });
    try {
        await testTimeTrigger(browser);
        await testFullscreenTrigger(browser);
        await testPauseAndClose(browser);
        await testPauseContentAndEmpty(browser);
        await testSeekSkipsAndGap(browser);
        await testBlockedGpt(browser);
        await testValidation(browser);
        await testInterval(browser);
        await testLayoutNone(browser);
        await testCustParams(browser);
    } finally {
        await browser.close();
    }
    console.log(failures ? `\n${failures} test başarısız` : '\nTümü geçti');
    process.exit(failures ? 1 : 0);
})();
