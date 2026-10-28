// HopeCorePlayer — Faz 2 (reklam çekirdeği) Playwright doğrulama scripti.
// Gerçek IMA ağ istekleri bu ortamda başarısız olduğu için (COOP/insecure-origin),
// window.google.ima TAMAMEN mock'lanıyor — AdsController'ın VAST URL üretimi,
// retry zinciri + jitter, VMAP-split ve içerik pause/resume koordinasyonu
// network'ten bağımsız, deterministik olarak doğrulanıyor.
// Çalıştırmadan önce apps/playground dev server'ı ayrı bir terminalde
// çalışıyor olmalı (npm run dev --workspace=apps/playground, port HOPE_TEST_PORT
// ile override edilebilir, varsayılan 5183).
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

const MOCK_IMA_INIT_SCRIPT = readFileSync(new URL('./_mock-ima.js', import.meta.url), 'utf8');

async function withPage(browser, scenario, fn) {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    await page.addInitScript(MOCK_IMA_INIT_SCRIPT);
    await page.goto(`${BASE}/?ads=${scenario}`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    try {
        await fn(page);
    } finally {
        if (consoleErrors.length) console.log('  console errors:', consoleErrors);
        await page.close();
    }
}

async function testPreroll(browser) {
    console.log('\n[1] Preroll: requestAds doğru VAST URL ile çağrılıyor mu?');
    await withPage(browser, 'preroll', async (page) => {
        const log = await page.evaluate(() => window.__adsLog);
        const reqEvents = log.filter((e) => e.ev === 'requestAds');
        ok(reqEvents.length === 1, `tam 1 requestAds çağrısı (${reqEvents.length})`);
        const url = reqEvents[0]?.adTagUrl ?? '';
        ok(url.startsWith('https://example.com/vast/preroll'), `base URL korunuyor (${url.slice(0, 60)}...)`);
        ok(url.includes('referrer_url=') && url.includes('description_url=') && url.includes('timestamp='), 'referrer/description/timestamp eklendi');
        ok(!url.includes('adrefreshCount'), 'retry disabled -> adrefreshCount cust_params eklenmedi');
    });
}

async function testImaSdkSettings(browser) {
    console.log('\n[1b] GERÇEK BUG (bulundu — "bu tagden reklam geliyor ama player oynatamıyor"): eski hopevideo\'nun ayarladığı ama yeni çekirdeğin HİÇ set etmediği IMA SDK ayarları (numRedirects/vastLoadTimeout/loadVideoTimeout/vpaidMode/iOS custom playback) artık uygulanıyor mu?');
    await withPage(browser, 'preroll', async (page) => {
        const settingsLog = await page.evaluate(() => window.__adsLog.filter((e) => e.ev.startsWith('set')));
        ok(settingsLog.some((e) => e.ev === 'setNumRedirects' && e.v === 15), `setNumRedirects(15) çağrıldı — SDK varsayılanı (4) wrapper/redirect zincirli tag'lerde yetersiz kalıyordu (log: ${JSON.stringify(settingsLog)})`);
        ok(settingsLog.some((e) => e.ev === 'setDisableCustomPlaybackForIOS10Plus' && e.v === true), 'setDisableCustomPlaybackForIOS10Plus(true) çağrıldı');
        ok(settingsLog.some((e) => e.ev === 'setVpaidMode' && e.v === 2), 'setVpaidMode(INSECURE) çağrıldı');

        const vastLoadTimeout = await page.evaluate(() => window.__lastRequest?.vastLoadTimeout);
        ok(vastLoadTimeout === 10000, `AdsRequest.vastLoadTimeout=10000 (SDK'nın kısa varsayılanı çok hoplu redirect zincirinde yetersiz kalıyordu) (${vastLoadTimeout})`);

        await page.evaluate(() => {
            const loader = window.__mockIma.adsLoaderInstances[0];
            const mgr = new window.google.ima.AdsManager();
            loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
        });
        const renderingSettings = await page.evaluate(() => window.__lastAdsRenderingSettings);
        ok(renderingSettings?.loadVideoTimeout === 10000, `getAdsManager() loadVideoTimeout=10000 ile çağrıldı (${JSON.stringify(renderingSettings)})`);
        ok(renderingSettings?.enablePreloading === true, 'enablePreloading:true');
        ok(renderingSettings?.useStyledLinearAds === false, 'useStyledLinearAds:false (IMA\'nın kendi UI\'ı yerine bizim ControlBar\'ımız)');
        ok(renderingSettings?.useStyledNonLinearAds === true, 'useStyledNonLinearAds:true');
    });
}

async function testDisplayContainerInitOnFirstPointerdown(browser) {
    console.log('\n[1c] GERÇEK BUG (bulundu — gerçek IMA SDK\'ya karşı: "AdError 400: Failed to initialize ad playback element before starting ad playback"): AdDisplayContainer.initialize() içerik videosunun \'play\'ini BEKLEMEDEN, player\'a yapılan İLK pointerdown\'da çağrılıyor mu?');
    await withPage(browser, 'preroll', async (page) => {
        const before = await page.evaluate(() => window.__adsLog.some((e) => e.ev === 'displayContainer.initialize'));
        ok(before === false, 'sayfa yüklendiğinde (hiç tıklama yokken) initialize() HENÜZ çağrılmadı');

        // KASITLI OLARAK sadece `pointerdown` — `mouse.up()` ÇAĞRILMIYOR, yani
        // tam bir 'click' (ve onunla tetiklenen merkez play butonunun
        // video.play() çağrısı) hiç oluşmuyor. Gerçek bug tam olarak buydu:
        // eskiden initialize() YALNIZCA video'nun kendi 'play' event'ine
        // bağlıydı — yalnızca bir pointerdown (henüz tam bir 'click'/play
        // değil) bunu asla tetiklemezdi.
        const box = await page.locator('#player').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();

        const videoStillPaused = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(videoStillPaused === true, 'yalnızca pointerdown (henüz click/play değil) videoyu OYNATMADI — initialize() video play\'inden BAĞIMSIZ tetiklenmeli');

        await page.mouse.up();

        const after = await page.evaluate(() => window.__adsLog.some((e) => e.ev === 'displayContainer.initialize'));
        ok(after === true, 'player\'a yapılan İLK pointerdown sonrası initialize() çağrıldı (video hiç play olmamış olsa bile)');
    });
}

async function testDisplayContainerInitWithAutoplayRace(browser) {
    console.log('\n[1d] GERÇEK BUG (bulundu — gerçek IMA SDK\'ya karşı, `autoplay: true` + HİÇBİR tıklama olmadan: "AdError 400: Failed to initialize ad playback element before starting ad playback"): autoplay, AdsController\'ın (dinamik import edilen) \'play\' dinleyicisini bağlamasından ÖNCE videoyu oynatsa bile initialize() çağrılıyor mu?');
    // KASITLI OLARAK withPage() KULLANILMIYOR — o helper player'ın hazır
    // olmasını bekliyor ama BİZ tam olarak "hazır olma" ile "autoplay'in
    // videoyu başlatması" arasındaki YARIŞI test ediyoruz; hiçbir tıklama/
    // ekstra eylem yapılmıyor, sayfa yüklenir yüklenmez kontrol ediliyor.
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    await page.addInitScript(MOCK_IMA_INIT_SCRIPT);
    await page.goto(`${BASE}/?ads=preroll-autoplay`);
    try {
        await page.waitForFunction(() => {
            const el = document.getElementById('player');
            return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
        });
        await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeout: 2000 });
        ok(true, 'autoplay, hiçbir tıklama olmadan videoyu gerçekten oynattı (bu testin ön koşulu)');

        await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'displayContainer.initialize'), { timeout: 2000 })
            .then(() => ok(true, 'AdDisplayContainer.initialize() hiçbir tıklama/pointerdown olmadan, yalnızca autoplay ile çağrıldı'))
            .catch(() => ok(false, 'initialize() autoplay sonrası ÇAĞRILMADI — "AdError 400" tekrar oluşurdu'));
    } finally {
        if (consoleErrors.length) console.log('  console errors:', consoleErrors);
        await page.close();
    }
}

async function testRequestOnPlayDefersAdRequest(browser) {
    console.log('\n[1e] İstek üzerine ("test et tuşuna basınca direkt player autoplay olmasın"): `requestOnPlay: true` ile reklam isteği `options.ads` set edilir edilmez DEĞİL, kullanıcı play\'e basana kadar ERTELENİYOR mu?');
    await withPage(browser, 'preroll-deferred', async (page) => {
        const before = await page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length);
        ok(before === 0, `player yüklendiğinde (hiç play olmadan) HENÜZ hiç requestAds çağrısı yok (${before})`);

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
        await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), { timeout: 2000 });
        const after = await page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length);
        ok(after === 1, `kullanıcı play'e basınca (video 'play' event'i) reklam isteği ATILDI (${after})`);
    });
}

async function testVmapSplit(browser) {
    console.log('\n[2] VMAP-split: preroll bitince VMAP AYRI ve DEĞİŞTİRİLMEDEN isteniyor mu?');
    await withPage(browser, 'vmap', async (page) => {
        await page.evaluate(() => {
            const loader = window.__mockIma.adsLoaderInstances[0];
            const mgr = new window.google.ima.AdsManager();
            window.__mockIma.adsManagerInstances.push(mgr);
            loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
            mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
        });
        const paused = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(paused === true, 'preroll başlayınca video pause oldu');

        const log1 = await page.evaluate(() => window.__adsLog);
        ok(log1.some((e) => e.ev === 'adsManager.init'), 'adsManager.init çağrıldı');
        ok(log1.some((e) => e.ev === 'adsManager.start'), 'adsManager.start çağrıldı');

        await page.evaluate(() => {
            const mgr = window.__mockIma.adsManagerInstances[0];
            mgr.dispatch('contentResumeRequested', new window.google.ima.AdEvent('contentResumeRequested'));
        });

        const log2 = await page.evaluate(() => window.__adsLog);
        const reqEvents = log2.filter((e) => e.ev === 'requestAds');
        ok(reqEvents.length === 2, `preroll sonrası tam 2. requestAds (VMAP) çağrısı atıldı (${reqEvents.length})`);
        ok(reqEvents[1]?.adTagUrl === 'https://example.com/vmap/full', `VMAP URL HİÇ DEĞİŞTİRİLMEDEN gönderildi (${reqEvents[1]?.adTagUrl})`);

        const resumed = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(resumed === false, 'preroll sonrası (VMAP öncesi değil, resume event sonrası) video tekrar play edildi');
    });
}

async function testVmapOnly(browser) {
    console.log('\n[2b] VMAP-only (ayrı preroll tag yok): VMAP tek başına preroll gibi isteniyor mu?');
    await withPage(browser, 'vmaponly', async (page) => {
        const log = await page.evaluate(() => window.__adsLog);
        const reqEvents = log.filter((e) => e.ev === 'requestAds');
        ok(reqEvents.length === 1, `tam 1 requestAds çağrısı (${reqEvents.length})`);
        ok(reqEvents[0]?.adTagUrl === 'https://example.com/vmap/full', 'VMAP URL ham haliyle (işlenmeden) gönderildi');

        await page.evaluate(() => {
            const loader = window.__mockIma.adsLoaderInstances[0];
            const mgr = new window.google.ima.AdsManager();
            loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
            mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
            mgr.dispatch('contentResumeRequested', new window.google.ima.AdEvent('contentResumeRequested'));
        });
        const log2 = await page.evaluate(() => window.__adsLog);
        const reqEvents2 = log2.filter((e) => e.ev === 'requestAds');
        ok(reqEvents2.length === 1, `resume sonrası TEKRAR VMAP istenmedi (toplam hâlâ ${reqEvents2.length})`);
    });
}

async function testPostroll(browser) {
    console.log('\n[3] Postroll: content "ended" olunca postroll isteniyor, resume sonrası play() ÇAĞRILMIYOR mu?');
    await withPage(browser, 'postroll', async (page) => {
        const log0 = await page.evaluate(() => window.__adsLog);
        ok(log0.filter((e) => e.ev === 'requestAds').length === 0, 'postroll-only kurulumda, oynatma bitmeden hiç reklam istenmedi');

        await page.evaluate(() => {
            const video = document.getElementById('player').shadowRoot.querySelector('video');
            video.dispatchEvent(new Event('ended'));
        });
        const log1 = await page.evaluate(() => window.__adsLog);
        const reqEvents = log1.filter((e) => e.ev === 'requestAds');
        ok(reqEvents.length === 1, `'ended' sonrası 1 postroll isteği atıldı (${reqEvents.length})`);
        ok(reqEvents[0]?.adTagUrl.startsWith('https://example.com/vast/postroll'), 'postroll URL doğru');

        await page.evaluate(() => {
            const loader = window.__mockIma.adsLoaderInstances[0];
            const mgr = new window.google.ima.AdsManager();
            loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
            mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
            mgr.dispatch('contentResumeRequested', new window.google.ima.AdEvent('contentResumeRequested'));
        });
        const paused = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(paused === true, 'postroll resume sonrası video.play() ÇAĞRILMADI (içerik yeniden başlamadı)');
    });
}

async function testMidroll(browser) {
    console.log('\n[4] Midroll: VMAP yokken, zaman aralığı dolunca (currentTime>60 + interval) midroll isteniyor mu?');
    await withPage(browser, 'midroll', async (page) => {
        await page.evaluate(() => {
            const video = document.getElementById('player').shadowRoot.querySelector('video');
            Object.defineProperty(video, 'currentTime', { value: 61, writable: true, configurable: true });
            video.dispatchEvent(new Event('timeupdate'));
        });
        const log1 = await page.evaluate(() => window.__adsLog);
        ok(log1.filter((e) => e.ev === 'requestAds').length === 1, 'currentTime=61 -> midroll istendi (ilk eşik geçildi)');

        await page.evaluate(() => {
            const video = document.getElementById('player').shadowRoot.querySelector('video');
            Object.defineProperty(video, 'currentTime', { value: 63, writable: true, configurable: true });
            video.dispatchEvent(new Event('timeupdate'));
        });
        const log2 = await page.evaluate(() => window.__adsLog);
        ok(log2.filter((e) => e.ev === 'requestAds').length === 1, 'interval dolmadan 2. istek atılmadı');

        await page.evaluate(() => {
            const video = document.getElementById('player').shadowRoot.querySelector('video');
            Object.defineProperty(video, 'currentTime', { value: 67, writable: true, configurable: true });
            video.dispatchEvent(new Event('timeupdate'));
        });
        const log3 = await page.evaluate(() => window.__adsLog);
        ok(log3.filter((e) => e.ev === 'requestAds').length === 2, 'interval (5sn) dolunca 2. midroll istendi');
    });
}

function custParam(url, key) {
    try {
        const cust = new URL(url).searchParams.get('cust_params') ?? '';
        const match = cust.split('&').find((p) => p.startsWith(`${key}=`));
        return match ? match.slice(key.length + 1) : null;
    } catch {
        return null;
    }
}

async function testRetry(browser) {
    // config: maxRetry=4 (retry() çağrısı başına, ilk/orijinal istek sayılmaz),
    // retryDelay=50ms, jitter=0.5, maxAttemptsPerTag=2, tags=[tag-a, tag-b].
    // RetryController semantiği: attemptsOnCurrent, SADECE retry() çağrılarını sayar
    // (orijinal ilk istek dahil değil) -> tag-a, attemptsOnCurrent 1 ve 2'de kalır,
    // 3. retry çağrısında (attemptsOnCurrent 3 > maxAttemptsPerTag 2) tag-b'ye geçer.
    // maxRetry=4 kontrolü de adRetryCount artırılmadan ÖNCE yapılır, yani 4 retry
    // çağrısının hepsi çalışır; limit yalnızca olası 5. retry çağrısını engeller.
    console.log('\n[5] Retry: fallback zinciri + maxAttemptsPerTag + jitter + limit sonrası give-up/aderror');
    await withPage(browser, 'retry', async (page) => {
        const log0 = await page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'requestAds'));
        ok(log0.length === 1, 'install sırasında 1. istek (tag-a, retry sayılmaz) atıldı');
        ok(log0[0]?.adTagUrl.startsWith('https://example.com/vast/tag-a'), 'ilk istek tag-a');

        const simulateAdError = () => page.evaluate(() => {
            const loader = window.__mockIma.adsLoaderInstances[0];
            loader.dispatch('adError', new window.google.ima.AdErrorEvent('mock-ad-error'));
        });
        const requestAdsCount = () => page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length);

        // retry çağrısı #1 -> tag-a, attemptsOnCurrent=1, adRetryCount=1
        await simulateAdError();
        await page.waitForFunction(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length === 2, { timeout: 2000 });
        let reqs = (await page.evaluate(() => window.__adsLog)).filter((e) => e.ev === 'requestAds');
        ok(reqs[1]?.adTagUrl.startsWith('https://example.com/vast/tag-a'), `retry#1 tag-a (attemptsOnCurrent=1<=maxAttemptsPerTag=2) (${reqs[1]?.adTagUrl.slice(0, 40)})`);
        ok(custParam(reqs[1].adTagUrl, 'adrefreshCount') === '1', `adrefreshCount=1 cust_params eklendi (${custParam(reqs[1].adTagUrl, 'adrefreshCount')})`);

        // retry çağrısı #2 -> HÂLÂ tag-a (attemptsOnCurrent=2<=2), adRetryCount=2
        await simulateAdError();
        await page.waitForFunction(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length === 3, { timeout: 2000 });
        reqs = (await page.evaluate(() => window.__adsLog)).filter((e) => e.ev === 'requestAds');
        ok(reqs[2]?.adTagUrl.startsWith('https://example.com/vast/tag-a'), `retry#2 hâlâ tag-a (attemptsOnCurrent=2<=2, henüz geçiş yok) (${reqs[2]?.adTagUrl.slice(0, 40)})`);

        // retry çağrısı #3 -> attemptsOnCurrent 3>2 -> tag-b'ye geçiş, adRetryCount=3
        await simulateAdError();
        await page.waitForFunction(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length === 4, { timeout: 2000 });
        reqs = (await page.evaluate(() => window.__adsLog)).filter((e) => e.ev === 'requestAds');
        ok(reqs[3]?.adTagUrl.startsWith('https://example.com/vast/tag-b'), `retry#3 fallback zincirinde tag-b'ye geçti (${reqs[3]?.adTagUrl.slice(0, 40)})`);

        // retry çağrısı #4 -> adRetryCount henüz 3 (4'e ulaşmadı) -> izin verilir, adRetryCount=4, tag-b kalır
        await simulateAdError();
        await page.waitForFunction(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length === 5, { timeout: 2000 });
        reqs = (await page.evaluate(() => window.__adsLog)).filter((e) => e.ev === 'requestAds');
        ok(reqs[4]?.adTagUrl.startsWith('https://example.com/vast/tag-b'), `retry#4 tag-b (son izinli retry, adRetryCount 3->4) (${reqs[4]?.adTagUrl.slice(0, 40)})`);

        // retry çağrısı #5 -> adRetryCount=4>=maxRetry(4) -> give-up, YENİ istek YOK.
        await simulateAdError();
        await page.waitForTimeout(400);
        const finalCount = await requestAdsCount();
        ok(finalCount === 5, `maxRetry=4 limitine ulaşınca 5. AD_ERROR give-up'a gitti, YENİ istek atılmadı (toplam hâlâ ${finalCount})`);

        const logText = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
        ok(logText.includes('aderror:'), `give-up sonrası hp:aderror event'i yayıldı (log: "${logText}")`);
    });
}

// Vite/Rollup, HopePlayerElement'in kendi (her zaman eager yüklenen) koduna
// da "chunks/index-<hash>.js" adını verebiliyor (bkz. README — Rollup'ın
// sabit-adlı entry + hash'li içerik chunk'ı optimizasyonu), bu yüzden dosya
// adı regex'iyle "ads chunk'ı mı değil mi" ayıramıyoruz. Bunun yerine:
// reklamsız bir sayfa yüklemesinin indirdiği chunk KÜMESİNİ taban alıp,
// reklamlı yüklemenin bu kümenin SIKI BİR ÜST KÜMESİ olduğunu (en az bir
// YENİ chunk eklendiğini) doğruluyoruz — hash değişse de kırılmaz.
async function collectChunkUrls(browser, { ads, mockIma } = {}) {
    const page = await browser.newPage();
    const urls = new Set();
    page.on('request', (req) => { if (/\/chunks\//.test(req.url())) urls.add(req.url()); });
    if (mockIma) await page.addInitScript(MOCK_IMA_INIT_SCRIPT);
    await page.goto(`${BASE}/${ads ? `?ads=${ads}` : ''}`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    await page.waitForTimeout(300);
    await page.close();
    return urls;
}

async function testNoAdsNoChunk(browser) {
    console.log('\n[6] Plugin izolasyonu: ads config YOKKEN/VARKEN indirilen chunk kümeleri farklı mı?');
    const baseline = await collectChunkUrls(browser, {});
    const withAds = await collectChunkUrls(browser, { ads: 'preroll', mockIma: true });

    const newChunks = [...withAds].filter((u) => !baseline.has(u));
    ok(newChunks.length > 0, `ads config varken en az 1 YENİ chunk indirildi (taban: ${baseline.size}, reklamlı: ${withAds.size}, yeni: ${JSON.stringify(newChunks)})`);

    const missingFromWithAds = [...baseline].filter((u) => !withAds.has(u));
    ok(missingFromWithAds.length === 0, 'reklamlı yükleme, taban chunk kümesinin tamamını da içeriyor (üst küme)');
}

async function testAdModeToolbar(browser) {
    console.log('\n[7] İstek üzerine: reklam sırasında kontrol çubuğu TAMAMEN gizlenmiyor — yalnızca oynat/duraklat + ses kalıyor, seek bar/süre/ayarlar/PIP/tam ekran gizleniyor');
    await withPage(browser, 'preroll', async (page) => {
        const before = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            return {
                barOpacity: getComputedStyle(root.querySelector('[part="control-bar"]')).opacity,
                seekBarDisplay: getComputedStyle(root.querySelector('[part="seek-bar"]')).display,
            };
        });
        ok(before.barOpacity === '1', `reklam ÖNCESİ kontrol çubuğu görünür (${before.barOpacity})`);
        ok(before.seekBarDisplay !== 'none', 'reklam ÖNCESİ seek bar görünür');

        await page.evaluate(() => {
            const loader = window.__mockIma.adsLoaderInstances[0];
            const mgr = new window.google.ima.AdsManager();
            window.__mockIma.adsManagerInstances.push(mgr);
            loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
            mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
        });

        const during = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            return {
                barOpacity: getComputedStyle(root.querySelector('[part="control-bar"]')).opacity,
                // `[part="control-bar"]`'ın KENDİSİ artık (istek üzerine — bkz.
                // "reklamı geç butonuna basılmıyor" fix'i) pointer-events:none —
                // tıklanabilirlik GERÇEKTEN interaktif elemente (play butonu)
                // bakılarak doğrulanıyor, dış kapsayıcıya değil.
                playButtonPointerEvents: getComputedStyle(root.querySelector('[part="play-pause-button"]')).pointerEvents,
                seekBarDisplay: getComputedStyle(root.querySelector('[part="seek-bar"]')).display,
                playButtonDisplay: getComputedStyle(root.querySelector('[part="play-pause-button"]')).display,
                volumeButtonDisplay: getComputedStyle(root.querySelector('[part="volume-button"]')).display,
            };
        });
        ok(during.barOpacity === '1', `reklam SIRASINDA kontrol çubuğu HÂLÂ görünür, tamamen gizlenmedi (${during.barOpacity})`);
        ok(during.playButtonPointerEvents === 'auto', `reklam SIRASINDA oynat/duraklat butonu tıklanabilir (${during.playButtonPointerEvents})`);
        ok(during.seekBarDisplay === 'none', 'reklam SIRASINDA seek bar gizlendi');
        ok(during.playButtonDisplay !== 'none', 'reklam SIRASINDA oynat/duraklat butonu GÖRÜNÜR kaldı');
        ok(during.volumeButtonDisplay !== 'none', 'reklam SIRASINDA ses butonu GÖRÜNÜR kaldı');

        // GERÇEK BUG (bulundu — "reklam varken toolbar görünmüyor hala"):
        // display/opacity doğru olsa bile `[part="ad-layer"]` (Google IMA'nın
        // reklam video'sunu/UI'ını bastığı katman, `z-10`) `chromeEl`'in
        // (eskiden z-index YOKTU → z-index:auto) ÜSTÜNE çıkıyordu — mekanizma
        // doğruydu ama kontrol çubuğu GÖRSEL OLARAK ad-layer'ın arkasında
        // kalıyordu. `elementFromPoint` gerçek tıklanabilirliği/görünürlüğü
        // (yalnızca CSS property'lerini değil) doğruluyor.
        const stacking = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const adLayer = root.querySelector('[part="ad-layer"]');
            const playBtn = root.querySelector('[part="play-pause-button"]');
            const rect = playBtn.getBoundingClientRect();
            const topEl = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return {
                adLayerVisible: !adLayer.classList.contains('hp:hidden'),
                topElIsPlayButtonOrChild: topEl === playBtn || playBtn.contains(topEl),
            };
        });
        ok(stacking.adLayerVisible, 'ad-layer reklam sırasında gerçekten görünür hale geldi (bu testin ön koşulu)');
        ok(stacking.topElIsPlayButtonOrChild, 'ad-layer görünürken oynat/duraklat butonu HÂLÂ en üstte/tıklanabilir (ad-layer\'ın ARKASINDA kalmıyor)');

        // GERÇEK BUG (bulundu — "reklamı geç butonuna basılmıyor"):
        // `[part="control-bar"]` eskiden `pointer-events-auto` taşıyordu —
        // bu INHERIT edildiği için GÖRSEL OLARAK boş olan şerit (sağ küme ad
        // modunda `display:none`, orada yalnızca transparan spacer var) bile
        // tıklamaları SESSİZCE yutuyordu; reklam sırasında IMA'nın kendi
        // "Reklamı Geç" butonu (genelde sağ-altta render edilir) bu yüzden
        // asla tıklanamıyordu. Şimdi yalnızca GERÇEKTEN interaktif yüzeyler
        // (sol/sağ buton grupları, seek bar) kendi pointer-events-auto'sunu
        // taşıyor — kontrol çubuğunun BOŞ alanı (sağ küme gizliyken orada
        // kalan transparan şerit) ad-layer'a/video'ya ŞEFFAF olmalı.
        const emptyAreaProbe = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const controlBar = root.querySelector('[part="control-bar"]');
            const rect = controlBar.getBoundingClientRect();
            // Sağ kenara yakın bir nokta — ad modunda sağ küme (ayarlar/PIP/
            // tam ekran) `display:none`, orada yalnızca boş/transparan alan var.
            const x = rect.right - 10;
            const y = rect.top + rect.height / 2;
            const topEl = root.elementFromPoint(x, y);
            return {
                topElPart: topEl?.getAttribute?.('part') ?? null,
                topElIsControlBarOrRow: topEl === controlBar || controlBar.contains(topEl),
            };
        });
        ok(
            !emptyAreaProbe.topElIsControlBarOrRow,
            `kontrol çubuğunun BOŞ alanı (sağ küme gizliyken) artık tıklamaları yutmuyor — en üst element: ${emptyAreaProbe.topElPart ?? '(control-bar DIŞINDA/altında bir şey)'}`
        );

        // İKİNCİ GERÇEK BUG (bulundu — yukarıdaki fix'ten SONRA bile "reklamı
        // geç butonuna basılmıyor" devam etti): `HopePlayerElement.blockChrome`
        // içinde `chromeEl.style.pointerEvents = 'auto'` INLINE STYLE olarak
        // set ediliyordu — inline style her zaman CSS class'tan (yukarıdaki
        // `hp:pointer-events-none`) daha yüksek specificity'de olduğu için
        // onu EZİYORDU. `chromeEl` TÜM video alanını kaplıyor (z-20,
        // inset-0) — 'auto' olunca reklamın İÇİNDEKİ (ör. skip butonu)
        // HER ŞEYİ, sadece control-bar şeridini değil, kapatıyordu. Bu da
        // düzeltildi — chromeEl'in computed pointer-events'i reklam
        // sırasında hiçbir zaman 'auto' olmamalı.
        const chromeElPointerEvents = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const chromeEl = root.querySelector('[part="control-bar"]').parentElement;
            return getComputedStyle(chromeEl).pointerEvents;
        });
        ok(
            chromeElPointerEvents !== 'auto',
            `chromeEl'in (control-bar'ın üst elementi, TÜM video alanını kaplayan z-20 katman) computed pointer-events'i reklam sırasında 'auto' DEĞİL — inline style ile ezilmiyor (${chromeElPointerEvents})`
        );

        // İstek üzerine: "reklam için sade toolbardaki butonlar çalışmıyor,
        // reklam durdur-başlat ve ses kısma açma işlemleri sorunsuz çalışmalı".
        // GERÇEK BUG (bulundu): butonlar `ctx.videoEl.play()/pause()`/`.volume`
        // çağırıyordu — IMA reklamı content video'dan BAĞIMSIZ kendi
        // video'suyla oynattığı için bunlar reklamı hiç etkilemiyordu.
        const iconColorDuringAd = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            return getComputedStyle(root.querySelector('[part="play-pause-button"] .hp-icon')).color;
        });
        ok(iconColorDuringAd === 'rgb(32, 32, 32)', `reklam SIRASINDA ikon rengi #202020 (${iconColorDuringAd})`);
        // İstek üzerine: ses çubuğunun dolgu (seviye) rengi de reklam sırasında #202020.
        const sliderFillDuringAd = await page.evaluate(() =>
            getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="volume-slider"] > div > div')).backgroundColor
        );
        ok(sliderFillDuringAd === 'rgb(32, 32, 32)', `reklam SIRASINDA ses çubuğu dolgusu #202020 (${sliderFillDuringAd})`);

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"]').click());
        const afterPauseClick = await page.evaluate(() => ({
            adsLog: window.__adsLog.filter((e) => e.ev.startsWith('adsManager.')).map((e) => e.ev),
            playIconClass: document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"] .hp-icon').className,
            contentVideoPaused: document.getElementById('player').shadowRoot.querySelector('video').paused,
        }));
        ok(afterPauseClick.adsLog.includes('adsManager.pause'), `oynat/duraklat butonuna basınca adsManager.pause() çağrıldı (log: ${JSON.stringify(afterPauseClick.adsLog)})`);
        ok(afterPauseClick.playIconClass.includes('hp-icon-play'), `ikon "play" glyph'ine döndü (reklam duraklatıldı) (${afterPauseClick.playIconClass})`);
        ok(afterPauseClick.contentVideoPaused === true, 'content video bu sırada HÂLÂ duraklatılmış durumda (reklamla karışmadı)');

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"]').click());
        const afterResumeClick = await page.evaluate(() => ({
            adsLog: window.__adsLog.filter((e) => e.ev.startsWith('adsManager.')).map((e) => e.ev),
            playIconClass: document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"] .hp-icon').className,
        }));
        ok(afterResumeClick.adsLog.includes('adsManager.resume'), 'tekrar basınca adsManager.resume() çağrıldı');
        ok(afterResumeClick.playIconClass.includes('hp-icon-pause'), 'ikon "pause" glyph\'ine döndü (reklam devam ediyor)');

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="volume-button"]').click());
        const afterMuteClick = await page.evaluate(() => {
            const setVolumeCalls = window.__adsLog.filter((e) => e.ev === 'adsManager.setVolume');
            return {
                lastVolume: setVolumeCalls.at(-1)?.v,
                contentVideoVolumeUnchanged: document.getElementById('player').shadowRoot.querySelector('video').volume,
            };
        });
        ok(afterMuteClick.lastVolume === 0, `ses butonuna basınca adsManager.setVolume(0) çağrıldı (${afterMuteClick.lastVolume})`);

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="volume-button"]').click());
        const afterUnmuteClick = await page.evaluate(() => {
            const setVolumeCalls = window.__adsLog.filter((e) => e.ev === 'adsManager.setVolume');
            return setVolumeCalls.at(-1)?.v;
        });
        ok(afterUnmuteClick > 0, `tekrar basınca ses geri getirildi, 0 değil (${afterUnmuteClick})`);

        await page.evaluate(() => {
            const mgr = window.__mockIma.adsManagerInstances[0];
            mgr.dispatch('contentResumeRequested', new window.google.ima.AdEvent('contentResumeRequested'));
        });
        const iconColorAfterAd = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            return getComputedStyle(root.querySelector('[part="play-pause-button"] .hp-icon')).color;
        });
        ok(iconColorAfterAd !== 'rgb(32, 32, 32)', `reklam bitince ikon rengi #202020'den normale döndü (${iconColorAfterAd})`);
        const sliderFillAfterAd = await page.evaluate(() =>
            getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="volume-slider"] > div > div')).backgroundColor
        );
        ok(sliderFillAfterAd !== 'rgb(32, 32, 32)', `reklam bitince ses çubuğu dolgusu tema accent'ine döndü (${sliderFillAfterAd})`);

        const after = await page.evaluate(() =>
            getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]')).display
        );
        ok(after !== 'none', 'reklam bitince (contentResumeRequested) seek bar geri geldi');
    });
}

(async () => {
    const browser = await chromium.launch();
    try {
        await testPreroll(browser);
        await testImaSdkSettings(browser);
        await testDisplayContainerInitOnFirstPointerdown(browser);
        await testDisplayContainerInitWithAutoplayRace(browser);
        await testRequestOnPlayDefersAdRequest(browser);
        await testVmapSplit(browser);
        await testVmapOnly(browser);
        await testPostroll(browser);
        await testMidroll(browser);
        await testRetry(browser);
        await testNoAdsNoChunk(browser);
        await testAdModeToolbar(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
