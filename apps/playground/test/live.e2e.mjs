// HopeCorePlayer — Faz 6 (SCTE-35 canlı reklam, live wall clock, DAI)
// Playwright doğrulama scripti. SCTE-35 ve DAI, window.google.ima(.dai)
// tamamen mock'lanarak test ediliyor (gerçek IMA/DAI ağ istekleri bu tür
// ortamlarda başarısız oluyor) — SCTE sinyalleri gerçek native
// `<video>.textTracks` (kind=metadata, cuechange) ile, mock'suz sürülüyor.
// Live wall clock, gerçek bir canlı stream'e ihtiyaç duymadan
// `video.duration`/`video.seekable`'ı Object.defineProperty ile override
// ederek test ediliyor.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

const MOCK_IMA = readFileSync(new URL('./_mock-ima.js', import.meta.url), 'utf8');
const MOCK_DAI = readFileSync(new URL('./_mock-dai.js', import.meta.url), 'utf8');

async function openFeature(browser, feature, { initScripts = [] } = {}) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    for (const script of initScripts) await page.addInitScript(script);
    await page.goto(`${BASE}/?feature=${feature}`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    if (consoleErrors.length) console.log('  console errors:', consoleErrors);
    return page;
}

async function collectChunkUrls(browser, feature, initScripts = []) {
    const page = await browser.newPage();
    const urls = new Set();
    page.on('request', (req) => { if (/\/chunks\//.test(req.url())) urls.add(req.url()); });
    for (const script of initScripts) await page.addInitScript(script);
    await page.goto(`${BASE}/${feature ? `?feature=${feature}` : ''}`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    await page.waitForTimeout(300);
    await page.close();
    return urls;
}

async function testPluginIsolation(browser) {
    console.log('\n[1] Plugin izolasyonu: live-wall-clock ve DAI yalnızca kendi feature\'ı açıkken yeni chunk indiriyor mu?');
    const baseline = await collectChunkUrls(browser, null);

    const withClock = await collectChunkUrls(browser, 'live-clock');
    ok([...withClock].some((u) => !baseline.has(u)), '?feature=live-clock → en az 1 yeni chunk');

    const withDai = await collectChunkUrls(browser, 'dai', [MOCK_DAI]);
    ok([...withDai].some((u) => !baseline.has(u)), '?feature=dai → en az 1 yeni chunk');
}

async function addMetadataCue(page, text) {
    await page.evaluate((cueText) => {
        const video = document.getElementById('player').shadowRoot.querySelector('video');
        let track = Array.from(video.textTracks).find((t) => t.kind === 'metadata' && t.label === 'scte-test');
        if (!track) {
            track = video.addTextTrack('metadata', 'scte-test');
        }
        track.mode = 'hidden';
        const cue = new VTTCue(video.currentTime, video.currentTime + 0.5, '');
        cue.text = cueText;
        // Native TextTrack.addCue bazı tarayıcılarda cue.text okunabilir olsun
        // diye VTTCue kullanıyoruz; Scte35LiveAdManager hem cue.value hem
        // cue.text'i kontrol ediyor — burada text yolu kullanılıyor.
        track.addCue(cue);
        // activeCues/cuechange tetiklensin diye currentTime'ı ufak kaydır.
        video.currentTime = Math.min(video.duration || 0.6, video.currentTime + 0.01);
    }, text);
    // cuechange event'i currentTime güncellemesiyle asenkron gelir.
    await page.waitForTimeout(200);
}

async function testScte35(browser) {
    console.log('\n[2] SCTE-35: OUT sinyali reklam istiyor, IN sinyali (reklam bitmemiş olsa bile) içeriğe döndürüyor mu?');
    const page = await openFeature(browser, 'scte35', { initScripts: [MOCK_IMA] });
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForTimeout(100);

    await addMetadataCue(page, 'EXT-X-CUE-OUT:5');
    await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), { timeout: 2000 });
    const log1 = await page.evaluate(() => window.__adsLog);
    const req = log1.find((e) => e.ev === 'requestAds');
    ok(req?.adTagUrl?.startsWith('https://example.com/vast/live'), `OUT sinyali sonrası adTagLive isteniyor (${req?.adTagUrl?.slice(0, 50)})`);

    // Reklamı "başlat" (ADS_MANAGER_LOADED + CONTENT_PAUSE_REQUESTED).
    await page.evaluate(() => {
        const loader = window.__mockIma.adsLoaderInstances[0];
        const mgr = new window.google.ima.AdsManager();
        window.__mockIma.adsManagerInstances.push(mgr);
        loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
        mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').paused, { timeout: 2000 });

    // IN sinyali gelir — reklam IMA tarafında hâlâ "oynuyor" olsa bile içeriğe dönülmeli.
    await addMetadataCue(page, 'EXT-X-CUE-IN');
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeout: 2000 });
    ok(true, 'IN sinyali sonrası içerik (reklam tamamlanmamış olsa bile) devam etti');
    await page.close();
}

async function testScte35Timeout(browser) {
    console.log('\n[3] SCTE-35: IMA breakTimeoutMs içinde cevap vermezse içerik otomatik devam ediyor mu?');
    const page = await openFeature(browser, 'scte35', { initScripts: [MOCK_IMA] });
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForTimeout(100);

    await addMetadataCue(page, 'EXT-X-CUE-OUT:5');
    await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), { timeout: 2000 });
    // IMA'dan hiç cevap simüle ETMİYORUZ — demo config breakTimeoutMs=2000.
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeout: 4000 });
    ok(true, 'breakTimeoutMs (2000ms) sonunda içerik otomatik devam etti (IMA hiç cevap vermedi)');
    await page.close();
}

async function testLiveWallClock(browser) {
    console.log('\n[4] LiveWallClock: canlı yayın olarak işaretlenince saat gösteriliyor, hover\'da tooltip çıkıyor mu?');
    const page = await openFeature(browser, 'live-clock');

    // Gerçek bir canlı stream olmadığı için video.duration/seekable'ı
    // override ederek "canlı" simüle ediyoruz.
    await page.evaluate(() => {
        const video = document.getElementById('player').shadowRoot.querySelector('video');
        Object.defineProperty(video, 'duration', { value: Infinity, configurable: true });
        const fakeSeekable = {
            length: 1,
            start: () => 0,
            end: () => 120, // 120sn'lik DVR penceresi
        };
        Object.defineProperty(video, 'seekable', { value: fakeSeekable, configurable: true });
        Object.defineProperty(video, 'currentTime', { value: 100, writable: true, configurable: true });
    });
    await page.waitForTimeout(1200); // saat 1sn'lik tick ile güncelleniyor

    const clockText = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="live-clock"]')?.textContent ?? '');
    ok(/^\d{2}:\d{2}:\d{2}$/.test(clockText.trim()), `canlı saat HH:MM:SS formatında gösteriliyor ("${clockText}")`);

    // Seekbar'a hover (tooltipMode:'both' demo config → 2 satır).
    const seekBar = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]'));
    const box = await seekBar.asElement().boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.waitForTimeout(100);

    const tooltipInfo = await page.evaluate(() => {
        const el = document.getElementById('player').shadowRoot.querySelector('[part="live-tooltip"]');
        return { hidden: el.className.includes('hp:hidden'), lineCount: el.children.length };
    });
    ok(!tooltipInfo.hidden, 'hover sırasında live tooltip görünür');
    ok(tooltipInfo.lineCount === 2, `tooltipMode:'both' → 2 satır (saat + "-Nsn") gösteriliyor (${tooltipInfo.lineCount})`);
    await page.close();
}

async function testLiveBadge(browser) {
    console.log('\n[4c] İstek üzerine: canlı yayında süre etiketi yerine "● CANLI" rozeti — uçta kırmızı, geride gri, tıklayınca canlıya dönüyor mu?');
    const page = await openFeature(browser, 'live-clock');
    const read = () =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const badge = root.querySelector('[part="live-badge"]');
            const timeLabel = badge.previousElementSibling;
            return {
                badgeVisible: getComputedStyle(badge).display !== 'none',
                timeVisible: getComputedStyle(timeLabel).display !== 'none',
                text: badge.textContent,
                behind: badge.hasAttribute('data-behind'),
                dot: getComputedStyle(badge.querySelector('.hp-live-dot')).backgroundColor,
                t: root.querySelector('video').currentTime,
            };
        });

    const vod = await read();
    ok(!vod.badgeVisible && vod.timeVisible, 'normal (VOD) videoda rozet YOK, süre etiketi var');

    await page.evaluate(() => {
        const video = document.getElementById('player').shadowRoot.querySelector('video');
        Object.defineProperty(video, 'duration', { value: Infinity, configurable: true });
        Object.defineProperty(video, 'seekable', { value: { length: 0, start: () => 0, end: () => 0 }, configurable: true });
        Object.defineProperty(video, 'buffered', { value: { length: 1, start: () => 0, end: () => 120 }, configurable: true });
        Object.defineProperty(video, 'currentTime', { value: 118, writable: true, configurable: true });
        video.dispatchEvent(new Event('durationchange'));
    });
    const atEdge = await read();
    ok(atEdge.badgeVisible && !atEdge.timeVisible, 'canlıda rozet görünüyor, "0:00 / 0:00" süre etiketi gizli');
    ok(atEdge.text === 'CANLI', `rozet metni "CANLI" (${atEdge.text})`);
    ok(!atEdge.behind && atEdge.dot === 'rgb(255, 0, 0)', `canlı uçta nokta kırmızı (${atEdge.dot})`);

    await page.evaluate(() => {
        const video = document.getElementById('player').shadowRoot.querySelector('video');
        video.currentTime = 60;
        video.dispatchEvent(new Event('timeupdate'));
    });
    // Noktanın 160ms background-color geçişi bitsin — aksi halde ara (kırmızımsı) renk okunur.
    await page.waitForTimeout(300);
    const behind = await read();
    // Gri = renk kanalları birbirine yakın (kırmızının baskın olmadığı) bir değer.
    const channels = await page.evaluate((c) => {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    }, behind.dot);
    const isGray = Math.max(...channels) - Math.min(...channels) < 30;
    ok(behind.behind && isGray, `geriye sarılınca "geride" — nokta gri (${behind.dot} → rgb ${channels.join(',')})`);

    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="live-badge"]').click());
    const back = await read();
    ok(Math.abs(back.t - 119) < 0.01 && !back.behind, `rozete tıklayınca canlı uca döndü (currentTime=${back.t})`);

    await page.evaluate(() => document.getElementById('player').setAttribute('locale', 'en'));
    await page.waitForTimeout(100);
    const en = await read();
    ok(en.text === 'LIVE', `locale="en" → "LIVE" (${en.text})`);
    await page.close();
}

const MASTER_3 = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480\nv480.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=650000,RESOLUTION=640x360\nv360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=450000,RESOLUTION=426x240\nv240.m3u8\n';
const MEDIA_PL = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:4,\nseg0.ts\n#EXT-X-ENDLIST\n';

async function qualityMenu(page) {
    return page.evaluate(async () => {
        const root = document.getElementById('player').shadowRoot;
        root.querySelector('[aria-label="Ayarlar"]').click();
        await new Promise((r) => setTimeout(r, 120));
        const row = Array.from(root.querySelectorAll('.hp-chip-panel button')).find((b) => /Kalite/.test(b.textContent));
        if (!row) return null;
        row.click();
        await new Promise((r) => setTimeout(r, 120));
        return Array.from(root.querySelectorAll('.hp-chip-panel button')).slice(1).map((b) => b.textContent.trim());
    });
}

async function testHlsQualityMenuInChrome(browser) {
    console.log('\n[4e] Chrome native HLS "maybe" dese bile hls.js kullanılıyor ve kalite menüsünde seviyeler var mı?');
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.route('https://hls-q.example.test/**', (route) => {
        const u = route.request().url();
        const headers = { 'access-control-allow-origin': '*' };
        if (u.endsWith('master.m3u8')) return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: MASTER_3, headers });
        if (u.endsWith('.m3u8')) return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: MEDIA_PL, headers });
        return route.fulfill({ status: 404, body: '', headers });
    });
    await page.addInitScript(() => {
        const orig = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function (t) {
            return /mpegurl/i.test(t) ? 'maybe' : orig.call(this, t);
        };
    });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => { document.getElementById('player').options = { src: 'https://hls-q.example.test/master.m3u8', muted: true }; });
    await page.waitForFunction(() => document.getElementById('player').playbackEngine?.engine === 'hls.js', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    const engine = await page.evaluate(() => document.getElementById('player').playbackEngine);
    ok(engine?.engine === 'hls.js', `Chrome'da hls.js seçildi (${JSON.stringify(engine)})`);
    const q = await qualityMenu(page);
    ok(JSON.stringify(q) === JSON.stringify(['Oto', '480p', '360p', '240p']), `kalite menüsü: ${JSON.stringify(q)}`);
    await page.close();
}

async function testHlsCorsFallsBackToNative(browser) {
    console.log('\n[4f] CORS izni olmayan HLS: hls.js indiremeyince native HLS\'e düşüyor, oynuyor ve eski kalite listesi kalmıyor mu?');
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    let jsFetch = 0;
    // hls.js (fetch/XHR) isteğine CORS başlığı yok → engellenir; native medya isteği (CORS'a tabi değil) geçer.
    await page.route('https://hls-nocors.example.test/**', (route) => {
        const req = route.request();
        const isMedia = req.resourceType() === 'media';
        if (!isMedia) jsFetch++;
        const u = req.url();
        const body = u.endsWith('master.m3u8') ? MASTER_3 : u.endsWith('.m3u8') ? MEDIA_PL : '';
        return route.fulfill({ status: body ? 200 : 404, contentType: 'application/vnd.apple.mpegurl', body, headers: isMedia ? {} : { 'access-control-allow-origin': 'denied' } });
    });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    // Önce çok kaliteli MP4 kaynağı (menüde "Kalite" olsun), sonra CORS'suz HLS.
    await page.evaluate(() => { document.getElementById('player').options = { sources: [{ src: '/sample.mp4', label: '720p', selected: true }, { src: '/sample.mp4', label: '360p' }], muted: true }; });
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.getElementById('player').options = { src: 'https://hls-nocors.example.test/master.m3u8', muted: true }; });
    await page.waitForFunction(() => document.getElementById('player').playbackEngine?.reason === 'hlsjs-failed', { timeout: 10000 }).catch(() => {});
    const engine = await page.evaluate(() => document.getElementById('player').playbackEngine);
    ok(jsFetch > 0 && engine?.engine === 'native-hls' && engine?.reason === 'hlsjs-failed', `hls.js CORS'a takıldı → native HLS (${JSON.stringify(engine)})`);
    const q = await qualityMenu(page);
    ok(q === null, `önceki MP4 kaynağının kalite listesi menüde kalmadı (${JSON.stringify(q)})`);
    await page.close();
}

async function testNativeHlsFallsBackToHlsJs(browser) {
    console.log('\n[4d] Kod 4 (Safari): native HLS "oynatırım" deyip oynatamazsa hata ekranı açılmadan hls.js\'e geçiliyor mu?');
    // Native-önce yolu yalnızca Safari/iOS'ta — Safari tarayıcı kimliğiyle.
    const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    });
    // İlk istek = native deneme → bozuk yanıt (kod 4); sonraki istekler = hls.js → geçerli playlist.
    let manifestRequests = 0;
    await page.route('https://hls.example.test/**', (route) => {
        if (route.request().url().endsWith('.m3u8')) {
            manifestRequests++;
            if (manifestRequests === 1) return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: 'bozuk' });
            return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg0.ts\n#EXT-X-ENDLIST\n' });
        }
        return route.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript(() => {
        // Native HLS "var" desin (bazı Android tarayıcıları/WebView'lar gibi).
        const orig = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function (t) {
            return /mpegurl/i.test(t) ? 'maybe' : orig.call(this, t);
        };
    });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => {
        document.getElementById('player').options = { src: 'https://hls.example.test/live/index.m3u8', muted: true };
    });
    await page.waitForFunction(() => (document.getElementById('player').shadowRoot.querySelector('video').getAttribute('src') || '').startsWith('blob:'), { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        return { src: (root.querySelector('video').getAttribute('src') || '').slice(0, 5), errorScreen: root.querySelector('[part="error-screen"]').hasAttribute('data-visible') };
    });
    ok(r.src === 'blob:', `native başarısız olunca hls.js'e geçildi (src=${r.src}…, manifest isteği: ${manifestRequests})`);
    ok(!r.errorScreen, 'geçiş sırasında hata ekranı GÖSTERİLMEDİ');
    await page.close();
}

async function testLiveWallClockNativeHlsEmptySeekable(browser) {
    console.log('\n[4b] KRİTİK REGRESYON: native HLS (güncel Chromium) — canlıda `seekable` BOŞ, yalnızca `buffered` dolu: saat yine gösteriliyor mu?');
    const page = await openFeature(browser, 'live-clock');
    // Gerçek bug (bulundu — docs canlı demosu): Chromium HLS'i native
    // oynatınca DVR'sız canlı yayında seekable boş kalıyor; eski isLive()
    // seekable.length > 0 şart koştuğu için saat hiç görünmüyordu.
    await page.evaluate(() => {
        const video = document.getElementById('player').shadowRoot.querySelector('video');
        Object.defineProperty(video, 'duration', { value: Infinity, configurable: true });
        Object.defineProperty(video, 'seekable', { value: { length: 0, start: () => 0, end: () => 0 }, configurable: true });
        Object.defineProperty(video, 'buffered', { value: { length: 1, start: () => 0, end: () => 30 }, configurable: true });
        Object.defineProperty(video, 'currentTime', { value: 25, writable: true, configurable: true });
    });
    await page.waitForTimeout(1200);
    const clock = await page.evaluate(() => {
        const el = document.getElementById('player').shadowRoot.querySelector('[part="live-clock"]');
        return { text: el?.textContent ?? '', hidden: el?.className.includes('hp:hidden') };
    });
    ok(!clock.hidden && /^\d{2}:\d{2}:\d{2}$/.test(clock.text.trim()), `seekable boşken de saat görünüyor ("${clock.text}")`);
    await page.close();
}

async function testDai(browser) {
    console.log('\n[5] DAI: requestStream doğru assetKey ile çağrılıyor, LOADED → stream URL yükleniyor, AD_BREAK_STARTED/ENDED seekbar\'ı kilitliyor/açıyor mu?');
    const page = await openFeature(browser, 'dai', { initScripts: [MOCK_DAI] });
    await page.waitForFunction(() => window.__daiLog?.some((e) => e.ev === 'requestStream'), { timeout: 2000 });

    const log1 = await page.evaluate(() => window.__daiLog);
    ok(log1.some((e) => e.ev === 'requestStream' && e.assetKey === 'test-asset-key'), 'requestStream doğru assetKey ile çağrıldı');

    await page.evaluate(() => {
        const sm = window.__mockDai.streamManagerInstances[0];
        sm.dispatch('loaded', new window.google.ima.dai.api.StreamEvent('loaded', { streamId: 's1', url: '/sample.mp4' }));
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentSrc.includes('sample.mp4'), { timeout: 2000 });
    ok(true, 'LOADED event sonrası stream URL video kaynağına yüklendi');

    const seekBarBefore = await page.evaluate(() => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]')).pointerEvents);
    ok(seekBarBefore !== 'none', 'reklam arası öncesi seek bar normal (tıklanabilir)');

    await page.evaluate(() => {
        const sm = window.__mockDai.streamManagerInstances[0];
        sm.dispatch('adBreakStarted', new window.google.ima.dai.api.StreamEvent('adBreakStarted'));
    });
    const seekBarDuring = await page.evaluate(() => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]')).pointerEvents);
    ok(seekBarDuring === 'none', 'AD_BREAK_STARTED → seek bar kilitlendi (DAI reklamının içine seek edilemiyor)');

    const logText = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
    ok(logText.includes('adstart:midroll'), 'hp:adstart event\'i yayıldı');

    await page.evaluate(() => {
        const sm = window.__mockDai.streamManagerInstances[0];
        sm.dispatch('adBreakEnded', new window.google.ima.dai.api.StreamEvent('adBreakEnded'));
    });
    const seekBarAfter = await page.evaluate(() => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]')).pointerEvents);
    ok(seekBarAfter !== 'none', 'AD_BREAK_ENDED → seek bar tekrar açıldı');
    await page.close();
}

(async () => {
    const browser = await chromium.launch();
    try {
        await testPluginIsolation(browser);
        await testScte35(browser);
        await testScte35Timeout(browser);
        await testLiveWallClock(browser);
        await testLiveWallClockNativeHlsEmptySeekable(browser);
        await testLiveBadge(browser);
        await testNativeHlsFallsBackToHlsJs(browser);
        await testHlsQualityMenuInChrome(browser);
        await testHlsCorsFallsBackToNative(browser);
        await testDai(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
