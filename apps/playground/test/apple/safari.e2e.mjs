// Gerçek Safari'de duman testleri: macOS Safari (safaridriver) ve iOS Simulator'daki Safari (Appium XCUITest).
// Playwright'in WebKit'i Safari'nin motoru ama oynatma katmanı farklı (native HLS, iPhone tam ekranı, AirPlay yok);
// bunlar gerçek Safari'de player'ın temel işleyişini ve Safari'ye özgü yollarını doğrular. bkz. .github/workflows/apple.yml
//
//   APPLE_TARGET=macos WEBDRIVER_URL=http://localhost:4444 node apps/playground/test/apple/safari.e2e.mjs
//   APPLE_TARGET=ios   WEBDRIVER_URL=http://localhost:4723 IOS_DEVICE="iPhone 16" IOS_VERSION=18.5 node …
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session, sleep } from './webdriver.mjs';

const TARGET = process.env.APPLE_TARGET ?? 'macos';
const WD = process.env.WEBDRIVER_URL ?? (TARGET === 'ios' ? 'http://localhost:4723' : 'http://localhost:4444');
const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
const IOS = TARGET === 'ios';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apple-artifacts');

let failures = 0;
let current = '';
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
        void shot(`FAIL-${current}`);
    }
};
/** Bilgi amaçlı (sonucu sayılmaz) — cihaz / simülatöre göre değişen davranışlar. */
const info = (cond, msg) => console.log(`  ${cond ? 'INFO' : 'INFO (yok)'} ${msg}`);

const capabilities = IOS
    ? {
          platformName: 'iOS',
          browserName: 'Safari',
          'appium:automationName': 'XCUITest',
          'appium:deviceName': process.env.IOS_DEVICE ?? 'iPhone 16',
          ...(process.env.IOS_VERSION ? { 'appium:platformVersion': process.env.IOS_VERSION } : {}),
          'appium:udid': process.env.IOS_UDID,
          'appium:newCommandTimeout': 600,
          'appium:wdaLaunchTimeout': 600_000,
          // GitHub'ın macOS sanal makinesinde iOS 26 simülatörünün açılışı Appium'un varsayılan 120 sn'sini aşıyor.
          'appium:simulatorStartupTimeout': 600_000,
          // pick-simulator.mjs'in açtığı simülatörü sıfırlayıp yeniden başlatmadan kullan.
          'appium:noReset': true,
          'appium:safariInitialUrl': `${BASE}/`,
          // Yavaş CI makinesinde Safari'nin sayfası Web Inspector'a geç görünüyor (varsayılan ~12 sn yetmedi).
          'appium:webviewConnectTimeout': 120_000,
          'appium:webviewConnectRetries': 30,
          // Web öğesi tıklaması gerçek dokunuş olsun (tam ekran gibi kullanıcı hareketi isteyen API'ler için).
          'appium:nativeWebTap': true,
          'appium:safariAllowPopups': true,
      }
    : { browserName: 'safari' };
if (!capabilities['appium:udid']) delete capabilities['appium:udid'];
// Başka bir W3C sürücüsüyle denemek için (ör. istemciyi Linux'ta chromedriver'la sınamak): WEBDRIVER_CAPS='{"browserName":"chrome",…}'
const caps = process.env.WEBDRIVER_CAPS ? JSON.parse(process.env.WEBDRIVER_CAPS) : capabilities;

let s;
try {
    s = await Session.create(WD, caps);
} catch (e) {
    console.log(`FAIL WebDriver oturumu açılamadı (${WD}): ${e.code ?? ''} ${e.message}`);
    console.log('     iOS için ayrıntı appium.log\'da (Actions → artifact "apple-ios" ya da "Appium log" adımı).');
    process.exit(1);
}
const shot = async (name) => {
    try {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `${TARGET}-${name.replace(/[^\w-]+/g, '_').slice(0, 60)}.png`), Buffer.from(await s.screenshot(), 'base64'));
    } catch {
        /* ekran görüntüsü alınamazsa test sonucu değişmez */
    }
};

/** Sayfayı aç, player'ın kurulmasını bekle; `options` verilirse uygula. */
async function open(path = '/', options) {
    await s.goto(`${BASE}${path}`);
    const booted = await s.waitFor(() => !!document.getElementById('player')?.shadowRoot?.querySelector('video'), { timeoutMs: 20000 });
    if (!booted) throw new Error(`player kurulmadı: ${path}`);
    await trackEvents();
    if (options) {
        // Yeni kaynağın meta verisi gelene kadar bekle — eski kaynağın süresi hâlâ geçerli görünür.
        await s.run((o) => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            window.__hpMeta = false;
            v.addEventListener('loadedmetadata', () => (window.__hpMeta = true), { once: true });
            document.getElementById('player').options = o;
        }, options);
        await s.waitFor(() => window.__hpMeta === true, { timeoutMs: 20000 });
    }
    await s.waitFor(() => Number.isFinite(document.getElementById('player').shadowRoot.querySelector('video').duration), { timeoutMs: 20000 });
}

const video = (prop) => s.run((p) => document.getElementById('player').shadowRoot.querySelector('video')[p], prop);
/**
 * Oynuyor ve zaman ilerliyor mu: `timeoutMs` içinde en az `minDelta` sn ilerlemesi beklenir (yavaş CI makinesinde
 * sarmadan sonra verinin gelmesi sürebilir). İlerlemezse videonun durumu ve olay sırası `diag`'da.
 */
async function advancing(timeoutMs = 6000, minDelta = 0.3) {
    const t0 = await video('currentTime');
    const end = Date.now() + timeoutMs;
    let t1 = t0;
    while (Date.now() < end) {
        await sleep(250);
        t1 = await video('currentTime');
        if (t1 > t0 + minDelta && !(await video('paused'))) return { ok: true, t0, t1, diag: '' };
    }
    return { ok: false, t0, t1, diag: await diag() };
}

/** Videonun durumu + open()'dan beri olay sırası (FAIL satırına eklenir). */
const diag = () =>
    s.run(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        const ranges = (r) => Array.from({ length: r.length }, (_, i) => `${r.start(i).toFixed(1)}-${r.end(i).toFixed(1)}`).join(',') || '—';
        return ` — paused=${v.paused} rs=${v.readyState} ns=${v.networkState} muted=${v.muted} error=${v.error ? `${v.error.code}:${v.error.message}` : '—'} buffered=${ranges(v.buffered)} olaylar: ${(window.__hpEvents ?? []).slice(-14).join(' ')}`;
    });

/** Video olaylarını kaydetmeye başla (sayfa her açıldığında). */
const trackEvents = () =>
    s.run(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        window.__hpEvents = [];
        for (const e of ['play', 'playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'suspend', 'error', 'ended', 'emptied', 'loadstart', 'canplay'])
            v.addEventListener(e, () => window.__hpEvents.push(`${e}@${v.currentTime.toFixed(2)}`));
    });

async function test(name, fn) {
    current = name;
    console.log(`\n${name}`);
    try {
        await fn();
    } catch (e) {
        ok(false, `hata: ${String(e?.message ?? e).slice(0, 300)}`);
    }
}

console.log(`Hedef: ${IOS ? `iOS Simulator Safari (${capabilities['appium:deviceName']} ${process.env.IOS_VERSION ?? ''})` : 'macOS Safari'}`);
const ua = await (async () => {
    await s.goto(`${BASE}/`);
    return s.run(() => navigator.userAgent);
})();
console.log(`UA: ${ua}`);

await test('[1] Kurulum: <hope-player> tanımlı, shadow DOM, kontroller, hp:ready; hata yok', async () => {
    await open('/');
    const r = await s.run(() => {
        const el = document.getElementById('player');
        const root = el.shadowRoot;
        return {
            defined: !!customElements.get('hope-player'),
            version: el.constructor.version,
            controls: !!root.querySelector('[part="play-pause-button"]') && !!root.querySelector('[part="center-play-button"]'),
            ready: (document.getElementById('log')?.textContent ?? '').includes('ready'),
            errors: window.__pageErrors ?? [],
        };
    });
    ok(r.defined && /^\d+\.\d+\.\d+/.test(r.version ?? ''), `custom element tanımlı, sürüm ${r.version}`);
    ok(r.controls, 'oynat / orta oynat butonları var');
    ok(r.ready, 'hp:ready geldi');
    ok(r.errors.length === 0, `sayfa hatası yok (${r.errors.join(' | ') || '—'})`);
});

await test('[2] MP4: orta oynat butonuna dokununca oynuyor, zaman ilerliyor', async () => {
    await open('/');
    await s.tap('[part="center-play-button"]');
    const playing = await s.waitFor(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeoutMs: 10000 });
    const a = await advancing();
    ok(playing && a.ok, `oynuyor (${a.t0.toFixed(2)} → ${a.t1.toFixed(2)} sn)${a.diag}`);
    const log = await s.run(() => document.getElementById('log')?.textContent ?? '');
    ok(log.includes('play'), 'hp:play olayı geldi');
});

await test('[3] Duraklat / devam: kontrol çubuğundaki buton', async () => {
    await s.tap('[part="play-pause-button"]');
    const paused = await s.waitFor(() => document.getElementById('player').shadowRoot.querySelector('video').paused, { timeoutMs: 6000 });
    ok(paused, 'duraklatıldı');
    await s.tap('[part="play-pause-button"]');
    const resumed = await s.waitFor(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeoutMs: 6000 });
    ok(resumed && (await advancing()).ok, 'devam etti, zaman ilerliyor');
});

await test('[4] Sarma: oynarken 6. saniyeye — konum tutuyor, oynatma sürüyor', async () => {
    await s.runAsync(
        () =>
            new Promise((r) => {
                const v = document.getElementById('player').shadowRoot.querySelector('video');
                v.addEventListener('seeked', r, { once: true });
                v.currentTime = 6;
                setTimeout(r, 5000);
            })
    );
    const t = await video('currentTime');
    const a = await advancing();
    ok(t >= 5.5 && t < 8, `seeked sonrası konum ${t.toFixed(2)} sn`);
    ok(a.ok && a.t1 >= 6, `sarmadan sonra oynamaya devam (${a.t0.toFixed(2)} → ${a.t1.toFixed(2)})${a.diag}`);
});

await test('[5] Altyazı: <track> kullanılmıyor (iOS kod 4), ipuçları yüklendi, ekranda metin', async () => {
    await open('/', { src: '/sample.mp4', muted: true, subtitles: [{ src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true }] });
    await s.tap('[part="center-play-button"]');
    const shown = await s.waitFor(
        () => {
            const root = document.getElementById('player').shadowRoot;
            return (root.querySelector('[part="caption-bubble"]')?.textContent ?? '').trim().length > 0;
        },
        { timeoutMs: 10000 }
    );
    const r = await s.run(() => {
        const root = document.getElementById('player').shadowRoot;
        const v = root.querySelector('video');
        const tracks = Array.from(v.textTracks);
        return { trackEls: v.querySelectorAll('track').length, cues: tracks.reduce((n, t) => n + (t.cues?.length ?? 0), 0), text: root.querySelector('[part="caption-bubble"]')?.textContent?.trim() ?? '', error: v.error?.code ?? null };
    });
    ok(r.trackEls === 0 && r.error === null, `<track> öğesi yok, video hatası yok (track: ${r.trackEls}, error: ${r.error})`);
    ok(r.cues > 0, `altyazı ipuçları yüklendi (${r.cues})`);
    ok(shown, `altyazı ekranda: "${r.text.slice(0, 50)}"`);
});

await test('[6] HLS: Safari native HLS ile oynuyor (hls.js değil)', async () => {
    await open('/', { src: '/hls/master.m3u8', muted: true });
    await s.tap('[part="center-play-button"]');
    await s.waitFor(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeoutMs: 15000 });
    const a = await advancing();
    const src = await video('currentSrc');
    ok(/\.m3u8(\?|$)/.test(src), `native HLS (currentSrc: ${src.split('/').pop()})`);
    ok(a.ok, `HLS oynuyor (${a.t0.toFixed(2)} → ${a.t1.toFixed(2)} sn)${a.diag}`);
    const err = await s.run(() => document.getElementById('player').shadowRoot.querySelector('.hp-error-screen')?.hasAttribute('data-visible'));
    ok(!err, 'hata ekranı yok');
});

await test('[7] QR ile devam (?vtime=5): erken sarma Safari\'de sıfırlanmıyor', async () => {
    await s.goto(`${BASE}/?feature=qr-resume&vtime=5`);
    const settled = await s.waitFor(() => Math.abs((document.getElementById('player')?.shadowRoot?.querySelector('video')?.currentTime ?? 0) - 5) < 0.6, { timeoutMs: 15000 });
    await sleep(1500);
    const t = await video('currentTime');
    ok(settled && Math.abs(t - 5) < 0.6, `video 5. saniyede (${t.toFixed(2)} sn)`);
});

await test('[8] Ses modu: mp3, plak arayüzü, oynuyor', async () => {
    await s.goto(`${BASE}/?feature=audio`);
    await s.waitFor(() => !!document.getElementById('player')?.shadowRoot?.querySelector('.hp-audio'), { timeoutMs: 15000 });
    await s.waitFor(() => Number.isFinite(document.getElementById('player').shadowRoot.querySelector('video').duration), { timeoutMs: 15000 });
    await trackEvents();
    // Bilgi: bu makinede ses aygıtı / Web Audio çalışıyor mu (CI sanal makinelerinde olmayabilir).
    const audioOut = await s
        .runAsync(async () => {
            const ac = new AudioContext();
            try {
                const resumed = await Promise.race([ac.resume().then(() => true), new Promise((r) => setTimeout(() => r(false), 1500))]);
                const t0 = ac.currentTime;
                await new Promise((r) => setTimeout(r, 300));
                return `${ac.state}, saat ${resumed && ac.currentTime > t0 ? 'ilerliyor' : 'durgun'}`;
            } finally {
                void ac.close().catch(() => {});
            }
        })
        .catch((e) => `ölçülemedi (${e.message})`);
    info(true, `Web Audio / ses çıkışı: ${audioOut}`);
    await s.run(() => {
        document.getElementById('player').shadowRoot.querySelector('video').muted = true;
    });
    await s.tap('[part="play-pause-button"]');
    await s.waitFor(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeoutMs: 10000 });
    const a = await advancing();
    const ui = await s.run(() => !!document.getElementById('player').shadowRoot.querySelector('.hp-vinyl'));
    ok(ui, 'plak arayüzü görünüyor');
    // Ses aygıtı olmayan makinede (GitHub'ın macOS sanal makineleri) Safari yalnızca ses içeren medyayı çalamıyor:
    // play → playing@0 → pause → ended@0. Ortamın sınırı — ses kartı olan Mac'te sorun yok.
    if (/ilerliyor/.test(audioOut)) ok(a.ok, `mp3 oynuyor (${a.t0.toFixed(2)} → ${a.t1.toFixed(2)} sn)${a.diag}`);
    else console.log(`  SKIP mp3 oynatma — bu makinede ses çıkışı yok (Web Audio: ${audioOut})`);
});

await test('[9] Tam ekran ve AirPlay (bilgi — simülatöre / makineye göre değişir)', async () => {
    await open('/', { src: '/sample.mp4', muted: true, cast: { airplay: true } });
    await s.tap('[part="center-play-button"]');
    await sleep(800);
    const fs = await s
        .tap('[aria-label="Tam ekran"]')
        .then(() =>
            s.waitFor(() => {
                const v = document.getElementById('player').shadowRoot.querySelector('video');
                return !!(document.fullscreenElement || document.webkitFullscreenElement || v.webkitDisplayingFullscreen);
            }, { timeoutMs: 5000 })
        )
        .catch(() => false);
    info(fs, IOS ? 'iPhone video tam ekranı (webkitEnterFullscreen) açıldı' : 'tam ekran açıldı');
    await s.run(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        if (v.webkitDisplayingFullscreen) v.webkitExitFullscreen();
        else if (document.fullscreenElement) document.exitFullscreen();
        else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    });
    const ap = await s.run(() => ({ api: typeof window.WebKitPlaybackTargetAvailabilityEvent !== 'undefined', btn: !!document.getElementById('player').shadowRoot.querySelector('[part="airplay-button"]') }));
    info(ap.api, `AirPlay API var; buton ${ap.btn ? 'eklendi' : 'eklenmedi (cihaz yok — beklenen)'}`);
    const errors = await s.run(() => window.__pageErrors ?? []);
    ok(errors.length === 0, `tam ekran / AirPlay sırasında sayfa hatası yok (${errors.join(' | ') || '—'})`);
});

await shot('son');
await s.close();
console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
process.exit(failures === 0 ? 0 : 1);
