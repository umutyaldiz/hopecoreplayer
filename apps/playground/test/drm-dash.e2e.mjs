// DASH (dash.js), DRM (ClearKey ile şifreli DASH — ses izi CENC), lisans hatası, QoE / analitik.
import { launchBrowser, BROWSER } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

const KID = '10000000100010001000100000000001';
const KEY = '3a2a1b68dd2bd9b2eeb25e84c4776668';
const b64url = (hex) => Buffer.from(hex, 'hex').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const LICENSE = JSON.stringify({ keys: [{ kty: 'oct', k: b64url(KEY), kid: b64url(KID) }], type: 'temporary' });

async function open(browser) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    return { page, errors };
}

/** ClearKey lisans sunucusu (sayfa içinde). */
async function licenseServer(page, status = 200) {
    const calls = [];
    await page.route('**/license/clearkey', async (route) => {
        calls.push(route.request().postData() ?? '');
        if (status !== 200) return route.fulfill({ status, body: 'denied' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: LICENSE });
    });
    return calls;
}

const setOptions = (page, options) => page.evaluate((o) => (document.getElementById('player').options = o), options);

const playFor = (page, ms) =>
    page.evaluate(async (ms) => {
        const el = document.getElementById('player');
        const v = el.shadowRoot.querySelector('video');
        await v.play().catch(() => {});
        await new Promise((r) => setTimeout(r, ms));
        return { t: v.currentTime, paused: v.paused, engine: el.playbackEngine, error: v.error?.code ?? null, w: v.videoWidth };
    }, ms);

const qualityItems = (page) =>
    page.evaluate(async () => {
        const root = document.getElementById('player').shadowRoot;
        const wait = () => new Promise((r) => setTimeout(r, 150));
        const gear = root.querySelector('[aria-label="Ayarlar"]');
        gear.click();
        await wait();
        const row = Array.from(root.querySelectorAll('.hp-chip-panel button')).find((b) => /Kalite/.test(b.textContent));
        row?.click();
        await wait();
        const items = Array.from(root.querySelectorAll('.hp-chip-panel button')).map((b) => b.textContent.trim());
        gear.click();
        return items;
    });

async function testDashClear(browser) {
    console.log('\n[1] DASH: dash.js ile oynuyor, kalite menüsünde temsiller, elle seçim');
    const { page, errors } = await open(browser);
    try {
        const chunks = [];
        page.on('request', (r) => /\/chunks\/dash-/.test(r.url()) && chunks.push(r.url()));
        await setOptions(page, { src: '/dash/clear.mpd', muted: true });
        await page.waitForFunction(() => document.getElementById('player').playbackEngine.engine === 'dash.js', null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(800);
        const s = await playFor(page, 1500);
        ok(s.engine.engine === 'dash.js' && s.t > 0.5 && !s.error, `oynuyor ${JSON.stringify(s)}`);
        ok(chunks.length >= 1, 'dash.js parçası yalnızca DASH kaynağında indi');
        const items = await qualityItems(page);
        ok(items.some((i) => /360/.test(i)) && items.some((i) => /180/.test(i)), `kalite menüsü ${JSON.stringify(items)}`);
        // 180p seç → video genişliği 320.
        await page.evaluate(async () => {
            const root = document.getElementById('player').shadowRoot;
            const wait = () => new Promise((r) => setTimeout(r, 150));
            root.querySelector('[aria-label="Ayarlar"]').click();
            await wait();
            Array.from(root.querySelectorAll('.hp-chip-panel button')).find((b) => /Kalite/.test(b.textContent))?.click();
            await wait();
            Array.from(root.querySelectorAll('.hp-chip-panel button')).find((b) => /180/.test(b.textContent))?.click();
        });
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').videoWidth === 320, null, { timeout: 8000 }).catch(() => {});
        const w = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').videoWidth);
        ok(w === 320, `180p seçilince video 320 px (${w})`);
        ok(errors.length === 0, `sayfa hatası yok ${JSON.stringify(errors)}`);
    } finally {
        await page.close();
    }
}

async function testDashClearKey(browser) {
    console.log('\n[2] DRM (ClearKey) + DASH: lisans alınıyor, şifreli içerik oynuyor');
    const { page } = await open(browser);
    try {
        const calls = await licenseServer(page);
        await setOptions(page, { src: '/dash/clearkey.mpd', muted: true, drm: { clearkey: { licenseUrl: '/license/clearkey', headers: { 'X-Token': 'abc' } } } });
        await page.waitForTimeout(800);
        // Segment sınırlarını geçecek kadar oynat (her segment ayrı şifreli).
        const s = await playFor(page, 5000);
        ok(calls.length >= 1 && /kids/.test(calls[0]), `lisans isteği gitti (${calls.length})`);
        ok(s.t > 4 && !s.paused && !s.error && s.w > 0, `şifreli DASH oynuyor ${JSON.stringify(s)}`);
        ok(s.engine.drm === 'org.w3.clearkey', `motor bilgisinde anahtar sistemi (${s.engine.drm})`);
    } finally {
        await page.close();
    }
}

async function testDataUrlLicense(browser) {
    console.log('\n[3] ClearKey lisansı data: URL ile (sunucusuz demo / test)');
    const { page } = await open(browser);
    try {
        const licenseUrl = `data:application/json;base64,${Buffer.from(LICENSE).toString('base64')}`;
        await setOptions(page, { src: '/dash/clearkey.mpd', muted: true, drm: { clearkey: { licenseUrl } } });
        await page.waitForTimeout(800);
        const s = await playFor(page, 3000);
        ok(s.t > 2 && !s.paused && !s.error && s.engine.drm === 'org.w3.clearkey', `oynuyor ${JSON.stringify(s)}`);
    } finally {
        await page.close();
    }
}

async function testDrmError(browser) {
    console.log('\n[4] Lisans reddedilince DRM hata ekranı (kod 5) ve hp:error');
    for (const src of ['/dash/clearkey.mpd']) {
        const { page } = await open(browser);
        try {
            await licenseServer(page, 403);
            await page.evaluate(() => {
                window.__err = [];
                document.getElementById('player').addEventListener('hp:error', (e) => window.__err.push(e.detail));
            });
            await setOptions(page, { src, muted: true, drm: { clearkey: { licenseUrl: '/license/clearkey' } } });
            await page.waitForTimeout(500);
            await page.evaluate(() => void document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {}));
            await page.waitForFunction(() => window.__err.length > 0, null, { timeout: 15000 }).catch(() => {});
            const r = await page.evaluate(() => ({
                err: window.__err[0] ?? null,
                text: document.getElementById('player').shadowRoot.querySelector('[part="error-screen"], .hp-error')?.textContent ?? '',
            }));
            ok(r.err?.code === 5 && /korumalı/.test(r.err.message), `${src}: kod 5 ${JSON.stringify(r.err)}`);
        } finally {
            await page.close();
        }
    }
}

async function testAnalytics(browser) {
    console.log('\n[5] Analitik: açılış süresi, izleme, sarma, %25/50/75, bitiş, kalite, toplu gönderim, GA4, player.qoe');
    const { page } = await open(browser);
    try {
        const posts = [];
        await page.route('**/collect', (route) => {
            posts.push(JSON.parse(route.request().postData() ?? '{}'));
            return route.fulfill({ status: 204 });
        });
        await page.evaluate(() => {
            window.__ev = [];
            window.__gtag = [];
            window.gtag = (cmd, name, params) => window.__gtag.push({ name, params });
            document.getElementById('player').addEventListener('hp:analytics', (e) => window.__ev.push(e.detail.event.type));
        });
        await setOptions(page, { src: '/sample.mp4', muted: true, id: 'video-42', analytics: { endpoint: '/collect', intervalMs: 1000, custom: { plan: 'pro' }, ga4: true } });
        await page.waitForTimeout(500);
        await playFor(page, 1200);
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 6));
        await page.waitForTimeout(1500);
        await page.evaluate(() => document.getElementById('player').pause());
        await page.waitForTimeout(1300);
        const mid = await page.evaluate(() => ({ ev: window.__ev.slice(), qoe: document.getElementById('player').qoe }));
        ok(mid.ev[0] === 'session_start' && mid.ev.includes('start') && mid.ev.includes('seek') && mid.ev.includes('pause'), `olay sırası ${JSON.stringify(mid.ev)}`);
        ok(mid.ev.includes('progress'), 'ilerleme kilometre taşları');
        ok(typeof mid.qoe?.startupMs === 'number' && mid.qoe.startupMs >= 0 && mid.qoe.seekCount === 1 && mid.qoe.watchedSeconds > 1 && mid.qoe.watchedSeconds < 5, `player.qoe ${JSON.stringify(mid.qoe)}`);
        ok(mid.qoe.height > 0, `kalite bilgisi (${mid.qoe.height})`);
        ok(posts.length >= 1, `toplu gönderim (${posts.length})`);
        const p = posts[0] ?? {};
        ok(p.v === 1 && p.videoId === 'video-42' && p.custom?.plan === 'pro' && p.sessionId && Array.isArray(p.events) && p.metrics && p.engine === 'native', `paket alanları ${JSON.stringify({ ...p, events: p.events?.length })}`);

        // Sona kadar: %75 + ended + video_complete.
        await page.evaluate(async () => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.currentTime = v.duration - 1.5;
            await v.play();
            await new Promise((r) => v.addEventListener('ended', r, { once: true }));
        });
        await page.waitForTimeout(300);
        const end = await page.evaluate(() => ({ ev: window.__ev.slice(), g: window.__gtag.map((x) => x.name + (x.params.video_percent ? `:${x.params.video_percent}` : '')), qoe: document.getElementById('player').qoe }));
        const all = posts.flatMap((x) => x.events.map((e) => e.type));
        ok(end.ev.includes('ended') && all.includes('ended'), 'ended olayı gönderildi');
        ok(end.qoe.maxProgress === 100, `maxProgress 100 (${end.qoe.maxProgress})`);
        ok(end.g.includes('video_start') && end.g.includes('video_progress:25') && end.g.includes('video_progress:75') && end.g.includes('video_complete'), `GA4 ${JSON.stringify(end.g)}`);

        // Kaynak değişince yeni oturum.
        const before = posts.at(-1)?.sessionId;
        await setOptions(page, { src: '/sample-240p.mp4', muted: true, id: 'video-43', analytics: { endpoint: '/collect', intervalMs: 1000, custom: { plan: 'pro' }, ga4: true } });
        await page.waitForTimeout(600);
        await playFor(page, 1500);
        await page.waitForTimeout(1200);
        const sessions = new Set(posts.map((x) => x.sessionId));
        const ends = posts.flatMap((x) => x.events.filter((e) => e.type === 'session_end').map(() => x.sessionId));
        ok(sessions.size >= 2 && ends.includes(before), `yeni kaynakta yeni oturum, eskisi session_end ile kapandı (${sessions.size})`);
    } finally {
        await page.close();
    }
}

async function testGtm(browser) {
    console.log('\n[8] GA4 / GTM: gtag yoksa dataLayer.push; ga4: \'dataLayer\' gtag olsa da dataLayer');
    for (const [mode, withGtag] of [[true, false], ['dataLayer', true]]) {
        const { page } = await open(browser);
        try {
            await page.evaluate((withGtag) => {
                window.dataLayer = [];
                window.__gtag = [];
                if (withGtag) window.gtag = (cmd, name) => window.__gtag.push(name);
            }, withGtag);
            await setOptions(page, { src: '/sample.mp4', muted: true, id: 'video-7', analytics: { ga4: mode } });
            await page.waitForTimeout(500);
            await page.evaluate(async () => {
                const v = document.getElementById('player').shadowRoot.querySelector('video');
                await v.play();
                await new Promise((r) => setTimeout(r, 300));
                v.currentTime = v.duration - 1;
                await new Promise((r) => v.addEventListener('ended', r, { once: true }));
            });
            const r = await page.evaluate(() => ({ dl: window.dataLayer.map((e) => e.event + (e.video_percent ? `:${e.video_percent}` : '')), first: window.dataLayer[0], gtag: window.__gtag }));
            ok(
                r.dl[0] === 'video_start' && r.dl.includes('video_progress:75') && r.dl.at(-1) === 'video_complete' && r.first.video_title === 'video-7' && r.first.video_provider === 'hopeplayer' && r.gtag.length === 0,
                `ga4: ${JSON.stringify(mode)}${withGtag ? ' (gtag var)' : ''} → ${JSON.stringify(r.dl)}`
            );
        } finally {
            await page.close();
        }
    }
}

async function testInteractionEvents(browser) {
    console.log('\n[9] Analitik: ses (toplanmış), tam ekran ve PiP olayları; GA4 / dataLayer karşılıkları');
    const { page } = await open(browser);
    try {
        await page.evaluate(() => {
            window.dataLayer = [];
            window.__ev = [];
            document.getElementById('player').addEventListener('hp:analytics', (e) => {
                const { type, data } = e.detail.event;
                if (['volume', 'fullscreen', 'pip'].includes(type)) window.__ev.push(`${type}:${JSON.stringify(data)}`);
            });
        });
        await setOptions(page, { src: '/sample.mp4', muted: true, analytics: { ga4: 'dataLayer' } });
        await page.waitForTimeout(500);
        ok((await page.evaluate(() => window.__ev.length)) === 0, 'seçeneklerle gelen muted olay üretmedi');
        await playFor(page, 300);
        // Sürükleme gibi art arda değişiklik → tek olay.
        await page.evaluate(async () => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.muted = false;
            for (const x of [0.9, 0.8, 0.7, 0.6, 0.5]) {
                v.volume = x;
                await new Promise((r) => setTimeout(r, 40));
            }
        });
        await page.waitForTimeout(700);
        const vol = await page.evaluate(() => window.__ev.filter((e) => e.startsWith('volume')));
        ok(vol.length === 1 && vol[0] === 'volume:{"volume":0.5,"muted":false}', `ses tek olay ${JSON.stringify(vol)}`);

        const btn = (label) => page.evaluate((l) => document.getElementById('player').shadowRoot.querySelector(`[aria-label="${l}"]`)?.getBoundingClientRect().toJSON(), label);
        const click = async (label) => {
            const r = await btn(label);
            if (r) await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
        };
        await page.mouse.move(450, 280);
        await click('Tam ekran');
        await page.waitForTimeout(500);
        await page.evaluate(() => document.exitFullscreen?.().catch(() => {}));
        await page.waitForTimeout(500);
        const pipOk = await page.evaluate(() => document.pictureInPictureEnabled === true);
        if (pipOk) {
            await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').requestPictureInPicture().catch(() => {}));
            await page.waitForTimeout(400);
            await page.evaluate(() => document.exitPictureInPicture?.().catch(() => {}));
            await page.waitForTimeout(400);
        }
        const r = await page.evaluate(() => ({ ev: window.__ev.slice(), dl: window.dataLayer.map((e) => `${e.event}:${e.active ?? e.volume}`) }));
        const fs = r.ev.filter((e) => e.startsWith('fullscreen'));
        ok(JSON.stringify(fs) === '["fullscreen:{\\"active\\":true}","fullscreen:{\\"active\\":false}"]', `tam ekran giriş / çıkış ${JSON.stringify(fs)}`);
        if (pipOk) {
            const pip = r.ev.filter((e) => e.startsWith('pip'));
            ok(JSON.stringify(pip) === '["pip:{\\"active\\":true}","pip:{\\"active\\":false}"]', `PiP giriş / çıkış ${JSON.stringify(pip)}`);
        } else console.log(`  (${BROWSER}: PiP yok, atlandı)`);
        ok(r.dl.includes('video_volume:0.5') && r.dl.includes('video_fullscreen:true') && r.dl.includes('video_fullscreen:false'), `dataLayer ${JSON.stringify(r.dl)}`);
    } finally {
        await page.close();
    }
}

async function testRebuffer(browser) {
    console.log('\n[6] Analitik: takılma (rebuffer) ölçülüyor — segment gecikmesiyle');
    const { page } = await open(browser);
    try {
        const slow = true;
        // Ses dahil tüm izler gecikmeli — yalnızca video gecikirse tarayıcı görüntüyü dondurup sesle sürer, `waiting` gelmez.
        await page.route(/\/dash\/clear-[0-2]-[3-5]\.m4s$/, async (route) => {
            if (slow) await new Promise((r) => setTimeout(r, 6000));
            return route.continue();
        });
        await page.evaluate(() => {
            window.__ev = [];
            document.getElementById('player').addEventListener('hp:analytics', (e) => window.__ev.push(e.detail));
        });
        await setOptions(page, {
            src: '/dash/clear.mpd',
            muted: true,
            analytics: true,
            dash: { settings: { streaming: { buffer: { bufferTimeAtTopQuality: 1, bufferTimeDefault: 1, stableBufferTime: 1 } } } },
        });
        await page.waitForTimeout(800);
        await playFor(page, 4000);
        await page.waitForFunction(() => window.__ev.some((x) => x.event.type === 'rebuffer'), null, { timeout: 15000 }).catch(() => {});
        const r = await page.evaluate(() => ({ types: window.__ev.map((x) => x.event.type), qoe: document.getElementById('player').qoe }));
        ok(r.qoe.rebufferCount >= 1 && r.qoe.rebufferMs >= 250 && r.qoe.rebufferRatio > 0, `takılma ${JSON.stringify({ c: r.qoe.rebufferCount, ms: r.qoe.rebufferMs, ratio: r.qoe.rebufferRatio })}`);
        ok(r.types.includes('rebuffer'), 'rebuffer olayı');
        ok(r.qoe.avgBitrate > 0, `ortalama bit hızı (${r.qoe.avgBitrate})`);
    } finally {
        await page.close();
    }
}

async function testNoMse(browser) {
    console.log('\n[7] MSE yok (Windows WebKit): DASH "desteklenmiyor" (kod 4), önceki video sürmez; MP4 yedeğine geçilir');
    const { page } = await open(browser);
    try {
        await page.evaluate(() => {
            window.__err = [];
            document.getElementById('player').addEventListener('hp:error', (e) => window.__err.push(e.detail.code));
        });
        // Önce bir MP4 oynasın; DASH'e geçince durmalı.
        await setOptions(page, { src: '/sample.mp4', muted: true });
        await page.waitForTimeout(600);
        await playFor(page, 500);
        await setOptions(page, { src: '/dash/clear.mpd', muted: true });
        await page.waitForFunction(() => window.__err.length > 0, null, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(600);
        const r = await page.evaluate(() => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            return { err: window.__err.slice(), src: v.getAttribute('src'), readyState: v.readyState, paused: v.paused };
        });
        ok(r.err[0] === 4 && !r.src && r.readyState === 0, `kod 4, önceki video durdu ${JSON.stringify(r)}`);
        await setOptions(page, {
            muted: true,
            sources: [
                { src: '/dash/clear.mpd', label: 'Oto' },
                { src: '/sample.mp4', label: '720p' },
            ],
        });
        await page.waitForTimeout(800);
        const s = await playFor(page, 1200);
        ok(s.t > 0.5 && s.engine.engine === 'native', `MP4 yedeği oynuyor ${JSON.stringify(s)}`);
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        const probe = await browser.newPage();
        await probe.goto(`${BASE}/`);
        const mse = await probe.evaluate(() => typeof MediaSource !== 'undefined' || typeof ManagedMediaSource !== 'undefined');
        await probe.close();
        if (mse) {
            await testDashClear(browser);
            await testDashClearKey(browser);
            await testDataUrlLicense(browser);
            await testDrmError(browser);
            await testRebuffer(browser);
        } else {
            console.log(`\n(${BROWSER}: MediaSource yok — DASH / DRM senaryoları atlandı)`);
            await testNoMse(browser);
        }
        await testAnalytics(browser);
        await testGtm(browser);
        await testInteractionEvents(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
