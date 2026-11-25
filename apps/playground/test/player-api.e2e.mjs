// Player API ve olayları: timeupdate, ses, sarma, takılma, meta veri, kaynak, altyazı, tam ekran, kontroller, bölüm,
// kalite (MP4 / HLS / ABR), reklam tıklama / atlama / çeyrek; currentTime, volume, setQuality, setSubtitle, setDubbing…
import { readFileSync } from 'node:fs';
import { launchBrowser, only } from './_browser.mjs';

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

const EVENTS = [
    'hp:timeupdate', 'hp:volumechange', 'hp:seeking', 'hp:seeked', 'hp:buffering', 'hp:loadedmetadata', 'hp:sourcechange',
    'hp:subtitlechange', 'hp:fullscreen', 'hp:controls', 'hp:chapterchange', 'hp:qualitychange', 'hp:dubbing',
    'hp:ratechange', 'hp:adclick', 'hp:adskip', 'hp:adprogress',
];

async function open(browser, options, { ima = false, query = '' } = {}) {
    const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', (e) => page.__errors.push(e.message));
    if (ima) await page.addInitScript(MOCK_IMA);
    await page.goto(`${BASE}/${query}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(
        ({ options, events }) => {
            const el = document.getElementById('player');
            window.__ev = [];
            for (const t of events) el.addEventListener(t, (e) => window.__ev.push({ t, d: e.detail }));
            if (options) el.options = { muted: true, ...options };
        },
        { options, events: EVENTS }
    );
    if (options) await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 2, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    return { context, page };
}

const events = (page, t) => page.evaluate((t) => window.__ev.filter((e) => e.t === t).map((e) => e.d), t);
const clear = (page) => page.evaluate(() => (window.__ev = []));
const el = (page, fn, arg) => page.evaluate(({ fn, arg }) => new Function('el', 'arg', `return (${fn})(el, arg)`)(document.getElementById('player'), arg), { fn: String(fn), arg });

async function testTimeVolumeSeek(browser) {
    console.log('\n[1] timeupdate, ses, sarma, meta veri, kaynak; currentTime / volume / muted / playbackRate');
    const { context, page } = await open(browser, {
        src: '/sample-30s.mp4',
        segments: [
            { start: 0, end: 5, text: 'Giriş' },
            { start: 5, end: 30, text: 'Ana bölüm' },
        ],
    });
    const meta = await events(page, 'hp:loadedmetadata');
    ok(meta.length >= 1 && meta.at(-1).duration > 25 && meta.at(-1).width > 0 && meta.at(-1).live === false, `hp:loadedmetadata (${JSON.stringify(meta.at(-1))})`);
    const src = await events(page, 'hp:sourcechange');
    ok(src.some((d) => d.src.includes('sample-30s.mp4') && d.format === 'native'), `hp:sourcechange (${JSON.stringify(src.at(-1))})`);
    const ch0 = await events(page, 'hp:chapterchange');
    ok(ch0.at(-1)?.index === 0 && ch0.at(-1)?.title === 'Giriş', `hp:chapterchange başta 0. bölüm (${JSON.stringify(ch0.at(-1))})`);

    await el(page, (p) => p.play());
    await page.waitForTimeout(1300);
    const tu = await events(page, 'hp:timeupdate');
    ok(tu.length >= 2 && tu.length <= 8, `hp:timeupdate seyrek geliyor (${tu.length} olay / 1.3 sn)`);
    ok(tu.at(-1).currentTime > 0.5 && tu.at(-1).duration > 25 && tu.at(-1).buffered >= tu.at(-1).currentTime, `detail doğru (${JSON.stringify(tu.at(-1))})`);
    const t = await el(page, (p) => p.currentTime);
    ok(t > 0.5 && (await el(page, (p) => p.paused)) === false, `currentTime / paused okunur (t=${t.toFixed(2)})`);

    await clear(page);
    await el(page, (p) => (p.currentTime = 12));
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'hp:seeked'), null, { timeout: 5000 });
    const seeking = await events(page, 'hp:seeking');
    const seeked = await events(page, 'hp:seeked');
    ok(seeking.length === 1 && seeking[0].from > 0.5 && seeking[0].from < 3 && Math.abs(seeking[0].to - 12) < 0.3, `hp:seeking from→to (${JSON.stringify(seeking[0])})`);
    ok(seeked.length === 1 && Math.abs(seeked[0].to - 12) < 0.5, `hp:seeked (${JSON.stringify(seeked[0])})`);
    const ch1 = await events(page, 'hp:chapterchange');
    ok(ch1.at(-1)?.index === 1 && ch1.at(-1)?.title === 'Ana bölüm', `sarınca hp:chapterchange (${JSON.stringify(ch1.at(-1))})`);

    await clear(page);
    await el(page, (p) => {
        p.volume = 0.4;
        p.muted = false;
    });
    await page.waitForTimeout(200);
    const vol = await events(page, 'hp:volumechange');
    ok(vol.some((d) => Math.abs(d.volume - 0.4) < 0.01) && vol.at(-1).muted === false, `volume / muted yazılır, hp:volumechange (${JSON.stringify(vol.at(-1))})`);
    const slider = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot.querySelector('.hp-volume [role="slider"]');
        return r ? Number(r.getAttribute('aria-valuenow')) : null;
    });
    ok(slider === 40, `ses çubuğu güncel (aria-valuenow=${slider})`);
    await el(page, (p) => (p.muted = true));

    await el(page, (p) => (p.playbackRate = 1.5));
    await page.waitForTimeout(200);
    ok((await el(page, (p) => p.playbackRate)) === 1.5 && (await events(page, 'hp:ratechange')).at(-1)?.rate === 1.5, 'playbackRate yazılır, hp:ratechange');

    const props = await el(page, (p) => ({ duration: p.duration, buffered: p.buffered instanceof TimeRanges, ended: p.ended, t: p.currentTime }));
    ok(Number.isFinite(props.duration) && props.buffered && props.ended === false, `duration / buffered / ended okunur (${JSON.stringify(props)})`);
    ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    await context.close();
}

async function testQualitySubtitlesDubbing(browser) {
    console.log('\n[2] MP4 kalitesi, altyazı ve dublaj: getQualities / setQuality, getSubtitles / setSubtitle, setDubbing');
    const { context, page } = await open(browser, {
        sources: [
            { src: '/sample-30s.mp4', label: '720p', selected: true },
            { src: '/sample-240p.mp4', label: '240p' },
        ],
        subtitles: [
            { src: '/sample.vtt', label: 'Türkçe', srclang: 'tr' },
            { src: '/sample.en.vtt', label: 'English', srclang: 'en' },
        ],
        dubbing: { tracks: [{ label: 'Türkçe', srclang: 'tr', default: true }, { label: 'English', srclang: 'en', src: '/sample.mp4?lang=en' }] },
    });
    const q = await el(page, (p) => p.getQualities());
    ok(q.length === 2 && q.find((x) => x.label === '720p')?.active === true, `getQualities (${JSON.stringify(q)})`);
    await el(page, (p) => (p.playbackRate = 1.5));
    await clear(page);
    ok((await el(page, (p) => p.setQuality('240p'))) === true, "setQuality('240p') true");
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'hp:qualitychange'), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    ok((await el(page, (p) => p.playbackRate)) === 1.5, 'kalite değişince oynatma hızı korunur (1.5)');
    ok((await events(page, 'hp:ratechange')).length === 0, 'kalite değişimi hp:ratechange üretmez');
    const qc = await events(page, 'hp:qualitychange');
    ok(qc[0]?.label === '240p' && qc[0]?.auto === false && qc[0]?.height === 240, `MP4 hp:qualitychange (${JSON.stringify(qc[0])})`);
    ok((await events(page, 'hp:seeking')).length === 0, 'kalite değişimi sarma olayı üretmez');
    ok((await el(page, (p) => p.setQuality('4K'))) === false, 'olmayan kalite false');

    const subs = await el(page, (p) => p.getSubtitles());
    ok(subs.length === 2 && subs.every((s) => !s.active) && subs[1].srclang === 'en', `getSubtitles (${JSON.stringify(subs)})`);
    await clear(page);
    ok((await el(page, (p) => p.setSubtitle('en'))) === true, "setSubtitle('en') dil koduyla");
    let sc = await events(page, 'hp:subtitlechange');
    ok(sc.length === 1 && sc[0].label === 'English' && sc[0].srclang === 'en', `hp:subtitlechange (${JSON.stringify(sc)})`);
    ok((await el(page, (p) => p.getSubtitles().find((s) => s.active)?.label)) === 'English', 'aktif altyazı English');
    await el(page, (p) => p.setSubtitle('English'));
    ok((await events(page, 'hp:subtitlechange')).length === 1, 'aynı seçim tekrar olay üretmez');
    await el(page, (p) => p.setSubtitle(null));
    sc = await events(page, 'hp:subtitlechange');
    ok(sc.at(-1)?.label === null, 'setSubtitle(null) kapatır');

    await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.textContent, null, { timeout: 3000 });
    await page.waitForTimeout(500);
    ok((await el(page, (p) => p.setDubbing('en'))) === true, "setDubbing('en')");
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'hp:dubbing'), null, { timeout: 8000 });
    const dub = await events(page, 'hp:dubbing');
    ok(dub[0]?.srclang === 'en', `hp:dubbing (${JSON.stringify(dub[0])})`);
    const menuValue = await page.evaluate(async () => {
        const r = document.getElementById('player').shadowRoot;
        const gear = [...r.querySelectorAll('button')].find((b) => /Ayarlar|Settings/.test(b.getAttribute('aria-label') ?? ''));
        gear.click();
        await new Promise((x) => setTimeout(x, 200));
        const row = [...r.querySelectorAll('button, [role]')].find((b) => /^Ses \/ Dil/.test(b.textContent.trim()));
        const text = row?.textContent ?? '';
        gear.click();
        return text;
    });
    ok(/EN/.test(menuValue), `dublaj menüsü de güncel (${menuValue.trim()})`);
    ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    await context.close();
}

async function testHlsQuality(browser) {
    console.log('\n[3] HLS: hp:qualitychange ilk seviye, menüden seçim ve "auto"');
    const { context, page } = await open(browser, { src: '/hls/master.m3u8' });
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'hp:qualitychange'), null, { timeout: 10000 });
    const first = (await events(page, 'hp:qualitychange'))[0];
    ok(first?.auto === true && first.height > 0 && /^\d+p$/.test(first.label), `ilk seviye auto:true (${JSON.stringify(first)})`);
    const q = await el(page, (p) => p.getQualities());
    ok(q.length >= 3 && q[0].auto === true && q[0].active === true, `getQualities: Otomatik + seviyeler (${q.map((x) => x.label + (x.active ? '*' : '')).join(', ')})`);
    const target = q.find((x) => !x.auto && !x.active && x.label !== first.label)?.label ?? q[q.length - 1].label;
    await clear(page);
    ok((await el(page, (p, l) => p.setQuality(l), target)) === true, `setQuality('${target}')`);
    await page.waitForFunction((l) => window.__ev.some((e) => e.t === 'hp:qualitychange' && e.d.label === l), target, { timeout: 10000 }).catch(() => {});
    const qc = await events(page, 'hp:qualitychange');
    ok(qc.some((d) => d.label === target && d.auto === false), `elle seçim auto:false (${JSON.stringify(qc.at(-1))})`);
    ok((await el(page, (p) => p.setQuality('auto'))) === true, "setQuality('auto')");
    await page.waitForTimeout(400);
    ok((await el(page, (p) => p.getQualities()[0].active)) === true, 'Otomatik yeniden seçili');
    await context.close();
}

async function testFullscreenControls(browser) {
    console.log('\n[4] Tam ekran ve kontroller: enterFullscreen / exitFullscreen / toggleFullscreen, hp:fullscreen, hp:controls');
    const { context, page } = await open(browser, { src: '/sample-30s.mp4', autoHideDelayMs: 500 });
    await clear(page);
    await page.mouse.click(450, 200);
    await page.evaluate(() => document.getElementById('player').enterFullscreen());
    await page.waitForFunction(() => document.getElementById('player').isFullscreen, null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    const fsOn = await events(page, 'hp:fullscreen');
    ok(fsOn.length === 1 && fsOn[0].state === 'enter' && fsOn[0].mode === 'native', `hp:fullscreen enter (${JSON.stringify(fsOn)})`);
    await page.evaluate(() => document.getElementById('player').toggleFullscreen());
    await page.waitForFunction(() => !document.getElementById('player').isFullscreen, null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    const fs = await events(page, 'hp:fullscreen');
    ok(fs.length === 2 && fs[1].state === 'exit', `hp:fullscreen exit (${JSON.stringify(fs.at(-1))})`);
    ok((await el(page, (p) => p.isFullscreen)) === false, 'isFullscreen false');

    await clear(page);
    await el(page, (p) => p.play());
    await page.mouse.move(450, 250);
    await page.mouse.move(460, 260);
    await page.waitForTimeout(1600);
    const ctl = await events(page, 'hp:controls');
    ok(ctl.some((d) => d.visible === false), `oynarken kontroller gizlenince hp:controls (${JSON.stringify(ctl)})`);
    await context.close();
}

async function testBuffering(browser) {
    console.log('\n[5] Takılma: hp:buffering true → false');
    const { context, page } = await open(browser, null);
    // Yavaş ağ: her istek 1.5 sn gecikir.
    await page.route('**/sample-30s.mp4*', async (route) => {
        await new Promise((x) => setTimeout(x, 1500));
        await route.continue();
    });
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { muted: true, autoplay: true, src: '/sample-30s.mp4?slow=1' };
    });
    await page.waitForFunction(() => window.__ev.some((e) => e.t === 'hp:buffering' && e.d.buffering === false), null, { timeout: 15000 }).catch(() => {});
    const b = (await events(page, 'hp:buffering')).map((d) => d.buffering);
    ok(b[0] === true && b.at(-1) === false, `hp:buffering sırası (${b.join(' → ')})`);
    await context.close();
}

async function testAdEvents(browser) {
    console.log('\n[6] Reklam: hp:adclick, hp:adskip, hp:adprogress (IMA)');
    const { context, page } = await open(browser, null, { ima: true, query: '?ads=preroll' });
    await page.waitForFunction(() => window.__mockIma.adsLoaderInstances.length > 0, null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => {
        const loader = window.__mockIma.adsLoaderInstances[0];
        const mgr = new window.google.ima.AdsManager();
        window.__mockIma.adsManagerInstances.push(mgr);
        loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
        mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
        const fire = (t) => mgr.dispatch(t, new window.google.ima.AdEvent(t));
        fire('firstQuartile');
        fire('midpoint');
        fire('click');
        fire('thirdQuartile');
        fire('skipped');
    });
    await page.waitForTimeout(200);
    const prog = (await events(page, 'hp:adprogress')).map((d) => d.quartile);
    ok(prog.join(',') === '25,50,75', `hp:adprogress çeyrekler (${prog.join(',')})`);
    const click = await events(page, 'hp:adclick');
    const skip = await events(page, 'hp:adskip');
    ok(click.length === 1 && click[0].type === 'preroll', `hp:adclick (${JSON.stringify(click)})`);
    ok(skip.length === 1 && skip[0].type === 'preroll', `hp:adskip (${JSON.stringify(skip)})`);
    await context.close();
}

async function testScrub(browser) {
    console.log('\n[7] İlerleme çubuğunu sürüklerken video durur, bırakınca devam eder (hp:pause / hp:play yok)');
    const { context, page } = await open(browser, { src: '/sample-30s.mp4' });
    await page.evaluate(() => {
        const el = document.getElementById('player');
        for (const t of ['hp:play', 'hp:pause']) el.addEventListener(t, (e) => window.__ev.push({ t, d: e.detail }));
    });
    await el(page, (p) => p.play());
    await page.waitForTimeout(800);
    await clear(page);
    const bar = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]').getBoundingClientRect();
        return { x: r.left, y: r.top + r.height / 2, w: r.width };
    });
    await page.mouse.move(bar.x + bar.w * 0.3, bar.y);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.w * 0.5, bar.y, { steps: 5 });
    await page.waitForTimeout(300);
    const held = await el(page, (p) => ({ t: p.currentTime, paused: p.paused, flag: p.hasAttribute('data-scrubbing') }));
    await page.waitForTimeout(1200);
    const later = await el(page, (p) => p.currentTime);
    ok(held.paused && held.flag && Math.abs(later - held.t) < 0.05, `basılı tutarken video durdu, konum sabit (${held.t.toFixed(2)} → ${later.toFixed(2)})`);
    ok(Math.abs(held.t - 15) < 1.5, `sürüklenen yere sarıldı (${held.t.toFixed(2)} sn)`);
    await page.mouse.up();
    await page.waitForTimeout(800);
    const after = await el(page, (p) => ({ t: p.currentTime, paused: p.paused, flag: p.hasAttribute('data-scrubbing') }));
    ok(!after.paused && after.t > held.t + 0.3 && !after.flag, `bırakınca kaldığı yerden devam etti (${after.t.toFixed(2)} sn)`);
    const pp = (await page.evaluate(() => window.__ev.filter((e) => e.t === 'hp:play' || e.t === 'hp:pause').map((e) => e.t)));
    ok(pp.length === 0, `sürükleme izleyicinin duraklat / oynatı sayılmadı (${pp.join(',') || 'olay yok'})`);
    const icon = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"]').getAttribute('aria-label'));
    ok(/Duraklat|Pause/.test(icon ?? ''), `oynat / duraklat butonu oynuyor durumunda (${icon})`);

    // İptal edilen dokunuş (iOS sistem hareketi): sürükleme takılı kalmaz.
    await page.mouse.move(bar.x + bar.w * 0.6, bar.y);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
        const s = document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]');
        s.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
    });
    await page.waitForTimeout(600);
    const cancel = await el(page, (p) => ({ paused: p.paused, flag: p.hasAttribute('data-scrubbing') }));
    ok(!cancel.paused && !cancel.flag, `pointercancel: sürükleme bitti, oynatma sürdü (${JSON.stringify(cancel)})`);
    await page.mouse.up();

    // Duraklatılmışken sürükleme: bırakınca kendiliğinden oynamaz.
    await el(page, (p) => p.pause());
    await page.waitForTimeout(200);
    await page.mouse.move(bar.x + bar.w * 0.2, bar.y);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.w * 0.4, bar.y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    ok((await el(page, (p) => p.paused)) === true, 'duraklatılmışken sürüklenince duraklatılmış kaldı');
    ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    await context.close();
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testScrub(browser);
        await testTimeVolumeSeek(browser);
        await testQualitySubtitlesDubbing(browser);
        if (only(['chromium', 'firefox'], 'Playwright WebKit derlemesinde HLS yok')) await testHlsQuality(browser);
        if (only(['chromium'], 'tam ekran izni yalnızca Chromium başsız modda güvenilir')) await testFullscreenControls(browser);
        await testBuffering(browser);
        await testAdEvents(browser);
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
