// HopeCorePlayer — gizlilik onayı (privacy): reklam kişiselleştirme (npa / ltd), reklamsız, analitik, cihazda saklama,
// OneTrust / TCF / Cookiebot / getConsent bağlayıcıları, onay geri çekilince kayıtların silinmesi, eklenti API'si.
import { readFileSync } from 'node:fs';
import { launchBrowser } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
const MOCK_IMA = readFileSync(new URL('./_mock-ima.js', import.meta.url), 'utf8');
const GAM = 'https://pubads.g.doubleclick.net/gampad/ads?iu=/1/test&sz=640x480&output=vast&correlator=1';
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

/** `before`: sayfa betiklerinden önce çalışır (CMP taklidi); `options`: sayfada kurulur (fonksiyonlar için `setup`). */
async function open(browser, { before, setup, arg } = {}) {
    const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    page.__collect = 0;
    await page.route('**/collect*', (r) => {
        page.__collect++;
        return r.fulfill({ status: 204, body: '' });
    });
    await page.addInitScript(MOCK_IMA);
    await page.addInitScript(() => {
        window.__gtag = 0;
        window.gtag = () => window.__gtag++;
        window.__privacy = [];
        document.addEventListener('hp:privacy', (e) => window.__privacy.push({ ...e.detail.consent, source: e.detail.source }), true);
    });
    if (before) await page.addInitScript(before);
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => document.getElementById('player').addEventListener('hp:privacy', (e) => window.__privacy.push({ ...e.detail.consent, source: e.detail.source })));
    await page.evaluate(setup, arg);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
    return page;
}

const adTags = (page) => page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'requestAds').map((e) => e.adTagUrl));
const waitAd = (page, timeout = 6000) => page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), null, { timeout }).then(() => true, () => false);
const params = (url) => {
    const u = new URL(url);
    return { npa: u.searchParams.get('npa'), ltd: u.searchParams.get('ltd') };
};
const play = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {}));

async function testNoPrivacy(browser) {
    console.log('\n[1] privacy verilmezse eski davranış: etiket değişmez, kayıt ve analitik çalışır');
    const page = await open(browser, {
        setup: (gam) => {
            localStorage.clear();
            document.getElementById('player').options = {
                src: '/sample.mp4',
                muted: true,
                ads: { adTagPreroll: gam, requestWhen: 'load' },
                history: { id: 'privacy-t1' },
                analytics: { endpoint: '/collect', intervalMs: 1000, ga4: true },
            };
        },
        arg: GAM,
    });
    try {
        ok(await waitAd(page), 'reklam istendi');
        const p = params((await adTags(page))[0]);
        ok(p.npa === null && p.ltd === null, `npa / ltd yok ${JSON.stringify(p)}`);
        await page.evaluate(() => window.__mockIma.adsLoaderInstances[0]?.dispatchEvent?.('adError'));
        await play(page);
        await page.waitForTimeout(2600);
        await page.evaluate(() => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.volume = 0.5; // ses tercihi kaydını kesin tetikler
            v.pause();
        });
        await page.waitForTimeout(300);
        const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hp-history')));
        ok(stored.length > 0, `kayıt yazıldı ${JSON.stringify(stored)}`);
        ok(page.__collect > 0 || (await page.evaluate(() => window.__gtag)) > 0, `analitik gönderildi (collect ${page.__collect}, gtag ${await page.evaluate(() => window.__gtag)})`);
    } finally {
        await page.context().close();
    }
}

async function testDeny(browser) {
    console.log("\n[2] privacy: { default: 'deny' } → npa=1 & ltd=1, analitik gitmiyor, localStorage'a yazılmıyor (yalnızca bellek)");
    const page = await open(browser, {
        setup: (gam) => {
            localStorage.clear();
            document.getElementById('player').options = {
                src: '/sample.mp4',
                muted: true,
                privacy: {},
                ads: { adTagPreroll: gam, requestWhen: 'load' },
                history: { id: 'privacy-t2' },
                analytics: { endpoint: '/collect', intervalMs: 1000, ga4: true },
            };
        },
        arg: GAM,
    });
    try {
        ok(await waitAd(page), 'reklam yine istendi (kişiselleştirilmeden)');
        const p = params((await adTags(page))[0]);
        ok(p.npa === '1' && p.ltd === '1', `npa=1, ltd=1 ${JSON.stringify(p)}`);
        await play(page);
        await page.waitForTimeout(2600);
        await page.evaluate(() => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.volume = 0.5; // ses tercihi kaydını kesin tetikler
            v.pause();
        });
        await page.waitForTimeout(300);
        const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^(hp|hope)[-_:]/.test(k)));
        ok(stored.length === 0, `localStorage boş ${JSON.stringify(stored)}`);
        ok(page.__collect === 0 && (await page.evaluate(() => window.__gtag)) === 0, `analitik gönderilmedi (collect ${page.__collect})`);
        const ev = await page.evaluate(() => window.__privacy.at(-1));
        ok(ev && ev.personalizedAds === false && ev.analytics === false && ev.functional === false && ev.ads === true, `hp:privacy ${JSON.stringify(ev)}`);
        const cur = await page.evaluate(() => document.getElementById('player').getPrivacy());
        ok(cur.analytics === false, 'player.getPrivacy()');
    } finally {
        await page.context().close();
    }
}

async function testWithdraw(browser) {
    console.log('\n[3] İşlevsel onay geri çekilince bizim kayıtlarımız siliniyor, başkalarınınki kalıyor; setPrivacy olay yayıyor');
    const page = await open(browser, {
        setup: () => {
            localStorage.clear();
            localStorage.setItem('hp-history-positions', '{}');
            localStorage.setItem('hope-caption-row', '2');
            localStorage.setItem('hope_sticky_dismissed_until', '1');
            localStorage.setItem('site-cart', 'keep');
            sessionStorage.setItem('hope-rewarded-unlock', '1');
            document.getElementById('player').options = { src: '/sample.mp4', muted: true, privacy: { default: 'grant' } };
        },
    });
    try {
        await page.waitForTimeout(300);
        await page.evaluate(() => document.getElementById('player').setPrivacy({ functional: false }));
        await page.waitForTimeout(400);
        const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
        ok(keys.join(',') === 'site-cart', `yalnızca sitenin anahtarı kaldı ${JSON.stringify(keys)}`);
        const ev = await page.evaluate(() => window.__privacy.at(-1));
        ok(ev.source === 'api' && ev.functional === false, `hp:privacy api ${JSON.stringify(ev)}`);
    } finally {
        await page.context().close();
    }
}

async function testNoAds(browser) {
    console.log('\n[4] ads: false → hiç reklam isteği yok, içerik oynuyor; onay gelince reklam kuruluyor');
    const page = await open(browser, {
        setup: (gam) => {
            document.getElementById('player').options = { src: '/sample.mp4', muted: true, privacy: { ads: false }, ads: { adTagPreroll: gam, requestWhen: 'load' } };
        },
        arg: GAM,
    });
    try {
        await play(page);
        await page.waitForTimeout(1500);
        const t = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
        ok((await adTags(page)).length === 0 && t > 0.8, `reklam yok, içerik oynuyor (t=${t.toFixed(2)})`);
        const ima = await page.evaluate(() => window.__mockIma.adsLoaderInstances.length);
        ok(ima === 0, `IMA kurulmadı (${ima})`);
        await page.evaluate(() => document.getElementById('player').setPrivacy({ ads: true }));
        await page.waitForTimeout(800);
        const ima2 = await page.evaluate(() => window.__mockIma.adsLoaderInstances.length);
        ok(ima2 === 1, `onay gelince reklam modülü kuruldu (${ima2})`);
    } finally {
        await page.context().close();
    }
}

async function testOneTrust(browser) {
    console.log('\n[5] OneTrust: aktif gruplara göre (C0004 var, C0002 yok); grup değişince güncelleniyor');
    const page = await open(browser, {
        before: () => {
            window.OnetrustActiveGroups = ',C0001,C0004,';
        },
        setup: (gam) => {
            document.getElementById('player').options = {
                src: '/sample.mp4',
                muted: true,
                privacy: { source: 'onetrust' },
                ads: { adTagPreroll: gam, requestWhen: 'load' },
                analytics: { endpoint: '/collect', intervalMs: 1000 },
            };
        },
        arg: GAM,
    });
    try {
        ok(await waitAd(page), 'reklam istendi');
        const p = params((await adTags(page))[0]);
        ok(p.npa === null, `C0004 var → kişiselleştirilmiş (npa yok) ${JSON.stringify(p)}`);
        let ev = await page.evaluate(() => window.__privacy.filter((e) => e.source === 'onetrust').at(-1));
        ok(ev && ev.personalizedAds && !ev.analytics && !ev.functional, `onetrust → ${JSON.stringify(ev)}`);
        await page.evaluate(() => {
            window.OnetrustActiveGroups = ',C0001,C0002,C0003,';
            window.dispatchEvent(new Event('OneTrustGroupsUpdated'));
        });
        await page.waitForTimeout(200);
        ev = await page.evaluate(() => window.__privacy.at(-1));
        ok(ev.analytics && ev.functional && !ev.personalizedAds, `grup değişimi uygulandı ${JSON.stringify(ev)}`);
    } finally {
        await page.context().close();
    }
}

async function testTcfCookiebot(browser) {
    console.log('\n[6] IAB TCF v2 (amaçlar 1, 8 var; 3, 4 yok) ve Cookiebot (preferences + marketing)');
    const page = await open(browser, {
        before: () => {
            window.__tcfapi = (cmd, v, cb) => {
                if (cmd === 'addEventListener') setTimeout(() => cb({ gdprApplies: true, eventStatus: 'tcloaded', listenerId: 1, purpose: { consents: { 1: true, 3: false, 4: false, 8: true } } }, true), 50);
            };
        },
        setup: () => {
            document.getElementById('player').options = { src: '/sample.mp4', muted: true, privacy: { source: 'tcf' } };
        },
    });
    try {
        await page.waitForTimeout(500);
        const ev = await page.evaluate(() => window.__privacy.filter((e) => e.source === 'tcf').at(-1));
        ok(ev && ev.functional && ev.analytics && !ev.personalizedAds, `tcf → ${JSON.stringify(ev)}`);
    } finally {
        await page.context().close();
    }
    const p2 = await open(browser, {
        before: () => {
            window.Cookiebot = { hasResponse: true, consent: { preferences: true, statistics: false, marketing: true } };
        },
        setup: () => {
            document.getElementById('player').options = { src: '/sample.mp4', muted: true, privacy: { source: 'cookiebot' } };
        },
    });
    try {
        await p2.waitForTimeout(400);
        const ev = await p2.evaluate(() => window.__privacy.filter((e) => e.source === 'cookiebot').at(-1));
        ok(ev && ev.functional && !ev.analytics && ev.personalizedAds, `cookiebot → ${JSON.stringify(ev)}`);
    } finally {
        await p2.context().close();
    }
}

async function testGetConsentWait(browser) {
    console.log('\n[7] getConsent geç yanıt verse de reklam isteği onu bekliyor; hiç yanıt yoksa waitMs sonra kişiselleştirmeden');
    const page = await open(browser, {
        setup: (gam) => {
            document.getElementById('player').options = {
                src: '/sample.mp4',
                muted: true,
                privacy: { getConsent: () => new Promise((r) => setTimeout(() => r({ personalizedAds: true, functional: true }), 700)) },
                ads: { adTagPreroll: gam, requestWhen: 'load' },
            };
        },
        arg: GAM,
    });
    try {
        ok(await waitAd(page), 'reklam istendi');
        const p = params((await adTags(page))[0]);
        ok(p.npa === null, `yanıt beklendi → kişiselleştirilmiş ${JSON.stringify(p)}`);
    } finally {
        await page.context().close();
    }
    const p2 = await open(browser, {
        setup: (gam) => {
            window.__t0 = performance.now();
            document.getElementById('player').options = {
                src: '/sample.mp4',
                muted: true,
                privacy: { source: 'onetrust', waitMs: 800 },
                ads: { adTagPreroll: gam, requestWhen: 'load' },
            };
        },
        arg: GAM,
    });
    try {
        ok(await waitAd(p2), 'CMP sessiz → waitMs sonra istendi');
        const p = params((await adTags(p2))[0]);
        ok(p.npa === '1', `onay yok → npa=1 ${JSON.stringify(p)}`);
        ok(!p2.__errors.length, `sayfa hatası yok ${JSON.stringify(p2.__errors)}`);
    } finally {
        await p2.context().close();
    }
}

async function testPluginApi(browser) {
    console.log('\n[8] Eklenti API: player.privacy ve onPrivacyChange; eklenti storage onaya uyuyor');
    const page = await open(browser, {
        setup: () => {
            localStorage.clear();
            window.__seen = [];
            const plugin = {
                name: 'privacy-probe',
                setup(player) {
                    window.__seen.push(player.privacy.analytics);
                    player.onPrivacyChange((p) => window.__seen.push(p.analytics));
                    player.storage.set('k', 1);
                },
            };
            document.getElementById('player').options = { src: '/sample.mp4', muted: true, privacy: {}, plugins: [plugin] };
        },
    });
    try {
        await page.waitForTimeout(600);
        await page.evaluate(() => document.getElementById('player').setPrivacy({ analytics: true }));
        await page.waitForTimeout(100);
        const r = await page.evaluate(() => ({ seen: window.__seen, keys: Object.keys(localStorage) }));
        ok(r.seen.at(-1) === true && r.seen.includes(false), `player.privacy / onPrivacyChange ${JSON.stringify(r.seen)}`);
        ok(r.keys.length === 0, `eklenti storage onaysız localStorage'a yazmadı ${JSON.stringify(r.keys)}`);
    } finally {
        await page.context().close();
    }
}

async function testConsentedVisitor(browser) {
    console.log('\n[9] Onaylı OneTrust ziyaretçisi: açılıştaki geçici "deny" kayıtları silmiyor, kaldığı yerden devam ediyor');
    const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
    const page = await context.newPage();
    try {
        await page.addInitScript(() => {
            window.OnetrustActiveGroups = ',C0001,C0002,C0003,C0004,';
        });
        const load = async () => {
            await page.goto(`${BASE}/`);
            await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
            await page.evaluate(() => {
                window.__hist = [];
                const el = document.getElementById('player');
                el.addEventListener('hp:history', (e) => window.__hist.push(e.detail.state));
                el.options = { src: '/sample-30s.mp4', muted: true, privacy: { source: 'onetrust' }, history: { id: 'privacy-t9' } };
            });
            await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
        };
        await load();
        await page.waitForTimeout(500);
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 12));
        await page.waitForTimeout(600);
        const saved = await page.evaluate(() => localStorage.getItem('hp-history-positions'));
        ok(!!saved && saved.includes('privacy-t9'), 'konum kaydedildi');
        await load();
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => ({
            key: !!localStorage.getItem('hp-history-positions'),
            t: document.getElementById('player').shadowRoot.querySelector('video').currentTime,
            hist: window.__hist,
        }));
        ok(r.key, 'yeniden açılışta kayıt silinmedi');
        ok(r.t > 11 || r.hist.includes('resumed'), `kaldığı yerden devam (t=${r.t.toFixed(2)}, ${JSON.stringify(r.hist)})`);
    } finally {
        await context.close();
    }
}

const browser = await launchBrowser();
try {
    await testConsentedVisitor(browser);
    await testNoPrivacy(browser);
    await testDeny(browser);
    await testWithdraw(browser);
    await testNoAds(browser);
    await testOneTrust(browser);
    await testTcfCookiebot(browser);
    await testGetConsentWait(browser);
    await testPluginApi(browser);
} finally {
    await browser.close();
}
console.log(failures ? `\n${failures} hata` : '\nTümü geçti');
process.exit(failures ? 1 : 0);
