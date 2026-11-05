// HopeCorePlayer — TV'ye yayın (cast): Google Cast sender akışı sahte bir cast_sender.js ile (gerçek cihaz yok).
// Buton görünürlüğü, TV'ye giden yükleme isteği (kaynak, başlık, altyazı, reklam araları), kumanda modu (oynat /
// duraklat / sar / ses), TV durumunun arayüze yansıması ve bağlantı bitince yerelde devam.
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

/** Sahte Google Cast Web Sender SDK: requestSession → "Salon TV" oturumu; loadMedia istekleri window.__cast.loads'a. */
const MOCK_CAST = `(() => {
    const C = (window.__cast = { loads: [], cmds: [], session: null });
    const ctxL = {};
    const fireCtx = (t, e) => (ctxL[t] || []).forEach((f) => f(e));
    class RemotePlayer {
        constructor() { Object.assign(this, { isConnected: true, isMediaLoaded: false, isPaused: true, currentTime: 0, duration: 0, volumeLevel: 1, isMuted: false, playerState: null, isPlayingBreak: false }); C.player = this; }
    }
    class RemotePlayerController {
        constructor(p) { this.p = p; this.l = []; C.controller = this; }
        addEventListener(t, f) { this.l.push(f); }
        removeEventListener(t, f) { this.l = this.l.filter((x) => x !== f); }
        emit(field, value) { this.p[field] = value; for (const f of [...this.l]) f({ field, value }); }
        playOrPause() { C.cmds.push('playOrPause'); this.emit('isPaused', !this.p.isPaused); }
        seek() { C.cmds.push('seek:' + this.p.currentTime); this.emit('currentTime', this.p.currentTime); }
        setVolumeLevel() { C.cmds.push('volume:' + this.p.volumeLevel); this.emit('volumeLevel', this.p.volumeLevel); }
        muteOrUnmute() { C.cmds.push('mute'); this.emit('isMuted', !this.p.isMuted); }
        stop() {}
    }
    const session = {
        loadMedia(req) {
            C.loads.push(JSON.parse(JSON.stringify(req)));
            setTimeout(() => {
                const c = C.controller;
                c.emit('isMediaLoaded', true);
                c.emit('duration', 30);
                c.emit('currentTime', req.currentTime || 0);
                c.emit('playerState', 'PLAYING');
                c.emit('isPaused', false);
            }, 60);
            return Promise.resolve();
        },
        getCastDevice: () => ({ friendlyName: 'Salon TV' }),
        getMediaSession: () => null,
    };
    let castState = window.__castNoDevices ? 'NO_DEVICES_AVAILABLE' : 'NOT_CONNECTED';
    const context = {
        setOptions(o) { C.options = o; },
        addEventListener(t, f) { (ctxL[t] ||= []).push(f); },
        removeEventListener(t, f) { ctxL[t] = (ctxL[t] || []).filter((x) => x !== f); },
        getCastState: () => castState,
        getCurrentSession: () => C.session,
        requestSession() {
            return new Promise((res) => setTimeout(() => {
                C.session = session;
                castState = 'CONNECTED';
                fireCtx('caststatechanged', { castState });
                fireCtx('sessionstatechanged', { sessionState: 'SESSION_STARTED', session });
                res();
            }, 30));
        },
        endCurrentSession() { C.end(); },
    };
    C.end = () => { C.session = null; castState = 'NOT_CONNECTED'; fireCtx('caststatechanged', { castState }); fireCtx('sessionstatechanged', { sessionState: 'SESSION_ENDED' }); };
    C.setDevices = (has) => { castState = has ? 'NOT_CONNECTED' : 'NO_DEVICES_AVAILABLE'; fireCtx('caststatechanged', { castState }); };
    const K = (props) => class { constructor(...a) { props(this, ...a); } };
    window.cast = { framework: {
        CastContext: { getInstance: () => context },
        CastContextEventType: { CAST_STATE_CHANGED: 'caststatechanged', SESSION_STATE_CHANGED: 'sessionstatechanged' },
        RemotePlayer, RemotePlayerController, RemotePlayerEventType: { ANY_CHANGE: 'anyChanged' },
    } };
    window.chrome = window.chrome || {};
    window.chrome.cast = {
        AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' },
        Image: K((o, url) => (o.url = url)),
        media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
            MediaInfo: K((o, id, type) => Object.assign(o, { contentId: id, contentType: type })),
            GenericMediaMetadata: K((o) => (o.metadataType = 0)),
            MusicTrackMediaMetadata: K((o) => (o.metadataType = 3)),
            LoadRequest: K((o, m) => (o.media = m)),
            Track: K((o, id, type) => Object.assign(o, { trackId: id, type })),
            TrackType: { TEXT: 'TEXT' },
            TextTrackType: { SUBTITLES: 'SUBTITLES' },
            StreamType: { BUFFERED: 'BUFFERED', LIVE: 'LIVE' },
            VastAdsRequest: K(() => {}),
            BreakClip: K((o, id) => (o.id = id)),
            Break: K((o, id, clipIds, position) => Object.assign(o, { id, breakClipIds: clipIds, position })),
            HlsSegmentFormat: { TS: 'ts', FMP4: 'fmp4', AAC: 'aac' },
            HlsVideoSegmentFormat: { MPEG2_TS: 'mpeg2_ts', FMP4: 'fmp4' },
        },
    };
    setTimeout(() => window.__onGCastApiAvailable && window.__onGCastApiAvailable(true), 10);
})();`;

async function open(browser, query = '', { noDevices = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const sdkRequests = [];
    await context.route('**/cv/js/sender/v1/cast_sender.js*', (r) => {
        sdkRequests.push(r.request().url());
        return r.fulfill({ contentType: 'text/javascript', body: MOCK_CAST });
    });
    const page = await context.newPage();
    await page.addInitScript((noDevices) => {
        window.chrome ||= {};
        window.__castNoDevices = noDevices;
        window.__ev = [];
        document.addEventListener('DOMContentLoaded', () =>
            document.getElementById('player')?.addEventListener('hp:cast', (e) => window.__ev.push(`${e.detail.via}:${e.detail.state}${e.detail.device ? ':' + e.detail.device : ''}`))
        );
    }, noDevices);
    await page.goto(`${BASE}/?feature=cast${query}`);
    await page.waitForTimeout(1200);
    return { page, context, sdkRequests };
}

const state = (page) =>
    page.evaluate(() => {
        const el = document.getElementById('player');
        const r = el.shadowRoot;
        const v = r.querySelector('video');
        const btn = r.querySelector('[part="cast-button"]');
        const proto = (k) => Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, k).get.call(v);
        const ov = r.querySelector('[part="cast-overlay"]');
        return {
            button: btn ? !btn.hidden : null,
            pressed: btn?.getAttribute('aria-pressed') ?? null,
            icon: btn?.querySelector('.hp-icon')?.className.match(/hp-icon-([\w-]+)/)?.[1] ?? null,
            overlay: ov?.hasAttribute('data-open') ? ov.textContent : null,
            overlayBreak: !!ov?.hasAttribute('data-break'),
            casting: r.querySelector('.video-area').hasAttribute('data-casting'),
            proxied: Object.prototype.hasOwnProperty.call(v, 'currentTime'),
            nativePaused: proto('paused'),
            nativeTime: proto('currentTime'),
            uiTime: v.currentTime,
            uiPaused: v.paused,
            timeLabel: r.querySelector('[part="time-display"], .hp-time')?.textContent ?? null,
            ev: window.__ev.slice(),
            loads: window.__cast?.loads ?? [],
            cmds: window.__cast?.cmds ?? [],
            options: window.__cast?.options ?? null,
        };
    });

const clickCast = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="cast-button"]').click());

async function testOffByDefault(browser) {
    console.log('\n[1] cast verilmezse: buton yok, Cast SDK hiç istenmez');
    const context = await browser.newContext();
    const sdk = [];
    await context.route('**/cast_sender.js*', (r) => (sdk.push(1), r.abort()));
    const page = await context.newPage();
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(1200);
    const has = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="cast-button"], [part="airplay-button"]'));
    ok(!has && sdk.length === 0, `buton yok, SDK isteği: ${sdk.length}`);
    await context.close();
}

async function testButton(browser) {
    console.log('\n[2] chromecast: true → SDK yüklenir, cihaz varken buton görünür; AirPlay varsayılan kapalı');
    const { page, context, sdkRequests } = await open(browser);
    let s = await state(page);
    const airplay = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="airplay-button"]'));
    ok(sdkRequests.length === 1 && s.button === true && s.options?.receiverApplicationId === 'CC1AD845', `SDK yüklendi, buton görünür, receiver ${s.options?.receiverApplicationId}`);
    ok(!airplay, 'AirPlay butonu yok (varsayılan kapalı)');
    await page.evaluate(() => window.__cast.setDevices(false));
    s = await state(page);
    ok(s.button === false && s.ev.includes('chromecast:unavailable'), 'cihaz kalmayınca buton gizlendi');
    await context.close();
    const nd = await open(browser, '', { noDevices: true });
    ok((await state(nd.page)).button === false, 'başta hiç cihaz yoksa buton gizli');
    await nd.context.close();
}

async function testCastFlow(browser) {
    console.log('\n[3] Yayın: TV\'ye kaynak + başlık + altyazı + reklam araları gider; yerel video durur, player kumanda olur');
    const { page, context } = await open(browser);
    await page.evaluate(() => document.getElementById('player').play());
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime > 2, null, { timeout: 8000 });
    await clickCast(page);
    await page.waitForFunction(() => window.__cast?.loads.length > 0, null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(250);
    let s = await state(page);
    const req = s.loads[0];
    const m = req?.media;
    ok(m?.contentId === `${BASE}/sample-30s.mp4` && m.contentType === 'video/mp4' && m.streamType === 'BUFFERED', `kaynak: ${m?.contentId} (${m?.contentType}, ${m?.streamType})`);
    ok(m?.metadata?.title === 'İstanbul' && m.metadata.subtitle === 'HopeCore demo' && m.metadata.images?.[0]?.url === `${BASE}/sample-cover.jpg`, `başlık / kapak: ${m?.metadata?.title}, ${m?.metadata?.images?.[0]?.url}`);
    ok(m?.tracks?.[0]?.trackContentId === `${BASE}/sample.vtt` && m.tracks[0].language === 'tr' && req.activeTrackIds?.[0] === 1, 'altyazı izi (varsayılan seçili)');
    ok(req?.currentTime > 2 && req.autoplay === true, `kaldığı yerden: ${req?.currentTime?.toFixed(1)} sn, autoplay`);
    const pos = (m?.breaks ?? []).map((b) => b.position).join(',');
    ok(pos === '0,10,20,-1' && m.breakClips.length === 4 && /ts=\d+/.test(m.breakClips[0].vastAdsRequest.adTagUrl), `reklam araları TV'de: [${pos}], makro dolu: ${m?.breakClips?.[0]?.vastAdsRequest?.adTagUrl}`);
    ok(s.casting && s.proxied && s.nativePaused && /Salon TV cihazında oynatılıyor/.test(s.overlay ?? ''), `yerel video durdu, katman: "${s.overlay?.slice(0, 40)}"`);
    ok(s.pressed === 'true' && s.icon === 'cast-connected' && s.ev.includes('chromecast:connected:Salon TV'), `buton bağlı (${s.icon}), hp:cast connected`);

    // TV durumu arayüze yansır.
    await page.evaluate(() => window.__cast.controller.emit('currentTime', 12.4));
    await page.waitForTimeout(100);
    s = await state(page);
    ok(Math.abs(s.uiTime - 12.4) < 0.01 && s.nativeTime < 12, `TV saniyesi arayüzde (${s.uiTime}), yerel video oynamıyor (${s.nativeTime.toFixed(1)})`);

    // Kumanda: oynat / duraklat (player butonu), sar, ses.
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"]').click());
    await page.waitForTimeout(100);
    s = await state(page);
    ok(s.cmds.includes('playOrPause') && s.uiPaused && s.nativePaused, `player butonu → TV duraklatıldı (${s.cmds.join(', ')})`);
    await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 20));
    await page.waitForTimeout(300);
    await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').volume = 0.4));
    await page.waitForTimeout(100);
    s = await state(page);
    ok(s.cmds.includes('seek:20') && s.cmds.includes('volume:0.4') && s.nativeTime < 12, `sarma ve ses TV'ye gitti, yerel video yerinde (${s.cmds.join(', ')})`);

    // TV'de reklam arası.
    await page.evaluate(() => window.__cast.controller.emit('isPlayingBreak', true));
    s = await state(page);
    ok(s.overlayBreak && /TV'de reklam oynatılıyor/.test(s.overlay ?? ''), 'TV reklam arasındayken "TV\'de reklam oynatılıyor"');
    await page.evaluate(() => window.__cast.controller.emit('isPlayingBreak', false));

    // Bağlantı biter → yerelde TV'deki saniyeden devam.
    await page.evaluate(() => {
        const c = window.__cast.controller;
        c.emit('currentTime', 15);
        c.emit('isPaused', false);
    });
    await page.waitForTimeout(100);
    // Teşhis (Linux WebKit'te 15 sn'ye sarma tutmuyordu): yerel videonun olay sırası FAIL satırında görünsün.
    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        const t = () => Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime').get.call(v).toFixed(2);
        const ranges = () => Array.from({ length: v.seekable.length }, (_, i) => `${v.seekable.start(i).toFixed(1)}-${v.seekable.end(i).toFixed(1)}`).join(',');
        window.__vlog = [`başla t=${t()} rs=${v.readyState} ns=${v.networkState} seekable=${ranges()} src=${(v.currentSrc || '').split('/').pop()}`];
        for (const e of ['seeking', 'seeked', 'play', 'playing', 'pause', 'emptied', 'loadstart', 'loadedmetadata', 'waiting', 'stalled', 'error'])
            v.addEventListener(e, () => window.__vlog.push(`${e}@${t()}`));
    });
    await page.evaluate(() => window.__cast.end());
    await page.waitForTimeout(600);
    s = await state(page);
    ok(!s.casting && !s.proxied && !s.overlay && s.icon === 'cast' && s.ev.includes('chromecast:disconnected'), 'bağlantı bitti → kumanda kalktı, katman kapandı');
    const resumed = Math.abs(s.nativeTime - 15) < 1 && !s.nativePaused;
    const vlog = resumed ? '' : ` — olaylar: ${await page.evaluate(() => window.__vlog.join(' '))}`;
    ok(resumed, `yerelde TV'deki saniyeden devam (${s.nativeTime.toFixed(1)} sn, oynuyor)${vlog}`);
    await context.close();
}

async function testVmapAndOff(browser) {
    console.log('\n[4] TV reklamları: VMAP → receiver planlar; ads: false → reklamsız');
    for (const [q, check, label] of [
        ['&ads=vmap', (m) => /^https:\/\/ads\.example\.com\/vmap\?ts=\d+/.test(m.vmapAdsRequest?.adTagUrl ?? '') && !m.breaks, 'VMAP (vmapAdsRequest, makro dolu)'],
        ['&ads=off', (m) => !m.vmapAdsRequest && !m.breaks && !m.breakClips, 'reklamsız'],
    ]) {
        const { page, context } = await open(browser, q);
        await clickCast(page);
        await page.waitForFunction(() => window.__cast?.loads.length > 0, null, { timeout: 4000 }).catch(() => {});
        const m = (await state(page)).loads[0]?.media;
        ok(!!m && check(m), `${label}: ${JSON.stringify(m?.vmapAdsRequest ?? m?.breaks ?? null)}`);
        await context.close();
    }
}

async function testAdsFromAdsOption(browser) {
    console.log('\n[5] cast.ads verilmezse player\'ın ads (IMA) tag\'leri TV\'ye gider');
    const { page, context } = await open(browser);
    await context.route('**/imasdk.googleapis.com/**', (r) => r.abort());
    await page.evaluate(() => {
        const el = document.getElementById('player');
        const { ads, ...cast } = el.options.cast;
        el.options = { ...el.options, cast, ads: { adTagPreroll: 'https://ads.example.com/ima-pre?c=[timestamp]', adTagPostroll: 'https://ads.example.com/ima-post' } };
    });
    await page.waitForTimeout(500);
    await clickCast(page);
    await page.waitForFunction(() => window.__cast?.loads.length > 0, null, { timeout: 4000 }).catch(() => {});
    const m = (await state(page)).loads[0]?.media;
    const pos = (m?.breaks ?? []).map((b) => b.position).join(',');
    ok(pos === '0,-1' && /ima-pre\?c=\d+/.test(m.breakClips[0].vastAdsRequest.adTagUrl), `IMA tag'leri TV'de: [${pos}]`);
    await context.close();
}

async function testPlaylistNext(browser) {
    console.log('\n[6] Yayın sırasında kaynak değişti (ör. playlist sonraki öğe) → yeni içerik TV\'ye gönderilir, yerel video çalmaz');
    const { page, context } = await open(browser);
    await clickCast(page);
    await page.waitForFunction(() => window.__cast?.loads.length > 0, null, { timeout: 4000 }).catch(() => {});
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { ...el.options, src: '/sample.mp4', autoplay: true };
    });
    await page.waitForFunction(() => window.__cast?.loads.length > 1, null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
    const s = await state(page);
    ok(s.loads[1]?.media.contentId === `${BASE}/sample.mp4` && s.loads[1].currentTime === 0, `yeni içerik TV'de, baştan (${s.loads[1]?.media.contentId})`);
    ok(s.nativePaused && s.casting, 'yerel video sessiz ve duraklatılmış kaldı');
    await context.close();
}

async function testAirPlay(browser) {
    console.log('\n[7] AirPlay (Safari API\'leri taklit): airplay: true → cihaz varken buton; seçici açılır; kablosuza geçince katman');
    const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
    await context.route('**/cast_sender.js*', (r) => r.abort());
    const page = await context.newPage();
    await page.addInitScript(() => {
        window.WebKitPlaybackTargetAvailabilityEvent = class extends Event {};
        HTMLVideoElement.prototype.webkitShowPlaybackTargetPicker = function () {
            window.__pickerOpened = (window.__pickerOpened ?? 0) + 1;
        };
        window.__ev = [];
        document.addEventListener('DOMContentLoaded', () => document.getElementById('player')?.addEventListener('hp:cast', (e) => window.__ev.push(`${e.detail.via}:${e.detail.state}`)));
    });
    await page.goto(`${BASE}/?feature=cast`);
    await page.waitForTimeout(800);
    const has = () => page.evaluate(() => {
        const b = document.getElementById('player').shadowRoot.querySelector('[part="airplay-button"]');
        return b ? !b.hidden : null;
    });
    ok((await has()) === null, 'airplay verilmeden AirPlay butonu yok');
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.options = { ...el.options, cast: { ...el.options.cast, airplay: true } };
    });
    await page.waitForTimeout(300);
    ok((await has()) === false, 'airplay: true → buton var, cihaz yokken gizli');
    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        const e = new Event('webkitplaybacktargetavailabilitychanged');
        e.availability = 'available';
        v.dispatchEvent(e);
    });
    ok((await has()) === true, 'Apple TV bulununca buton göründü');
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="airplay-button"]').click());
    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        v.webkitCurrentPlaybackTargetIsWireless = true;
        v.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
    });
    const s = await page.evaluate(() => ({
        picker: window.__pickerOpened ?? 0,
        overlay: document.getElementById('player').shadowRoot.querySelector('[part="cast-overlay"][data-open]')?.textContent ?? null,
        attr: document.getElementById('player').shadowRoot.querySelector('video').getAttribute('x-webkit-airplay'),
        ev: window.__ev.slice(),
    }));
    ok(s.picker === 1 && s.attr === 'allow', 'butona basınca AirPlay seçicisi açıldı');
    ok(/AirPlay ile oynatılıyor/.test(s.overlay ?? '') && s.ev.includes('airplay:connected'), `katman: "${s.overlay?.slice(0, 24)}", ${s.ev.join(', ')}`);
    await context.close();
}

(async () => {
    const browser = await launchBrowser({ autoplay: true });
    try {
        await testOffByDefault(browser);
        await testButton(browser);
        await testCastFlow(browser);
        await testVmapAndOff(browser);
        await testAdsFromAdsOption(browser);
        await testPlaylistNext(browser);
        await testAirPlay(browser);
    } finally {
        await browser.close();
    }
    console.log(failures ? `\n${failures} test başarısız` : '\nTümü geçti');
    process.exit(failures ? 1 : 0);
})();
