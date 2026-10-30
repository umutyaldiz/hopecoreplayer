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
        // Preroll kapısı (1.0.12): yüklenen preroll, içerik oynatılmak istenene kadar start() edilmez.
        await page.evaluate(() => document.getElementById('player').play());
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

async function testOptionsBeforeConnect(browser) {
    console.log('\n[6b] GERÇEK BUG: .options element sayfaya eklenmeden önce verilince reklam İKİ KEZ isteniyordu');
    // createElement → .options → appendChild: hem setter hem connectedCallback applyOptions'ı başlatıyor, ikisi de
    // `!this.adsController` kontrolünü geçip AdsController'ı iki kez kuruyordu (iki IMA köprüsü, iki preroll).
    await withPage(browser, 'none', async (page) => {
        await page.evaluate(() => {
            window.__adsLog.length = 0;
            const el = document.createElement('hope-player');
            el.id = 'pre-connect-player';
            el.options = { src: '/sample.mp4', muted: true, ads: { adTagPreroll: 'https://example.com/vast/preroll' } };
            document.body.appendChild(el);
        });
        await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), null, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
        const reqEvents = await page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'requestAds'));
        ok(reqEvents.length === 1, `tam 1 requestAds çağrısı (${reqEvents.length})`);
        await page.evaluate(() => document.getElementById('pre-connect-player')?.remove());
    });
}

async function testAdModeToolbar(browser) {
    console.log('\n[7] İstek üzerine: reklam sırasında kontrol çubuğu TAMAMEN gizlenmiyor — yalnızca oynat/duraklat + ses kalıyor, seek bar/süre/ayarlar/PIP/tam ekran gizleniyor');
    await withPage(browser, 'preroll', async (page) => {
        // Reklam modundaki sade toolbar temanın kendi renklerini kullanır (istek üzerine — önceden #202020'ye zorlanıyordu).
        const themeColors = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            return {
                icon: getComputedStyle(root.querySelector('[part="play-pause-button"] .hp-icon')).color,
                sliderFill: getComputedStyle(root.querySelector('[part="volume-slider"] > div > div')).backgroundColor,
            };
        });
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
        ok(iconColorDuringAd === themeColors.icon, `reklam SIRASINDA ikon rengi temanınkiyle aynı (${iconColorDuringAd})`);
        const sliderFillDuringAd = await page.evaluate(() =>
            getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="volume-slider"] > div > div')).backgroundColor
        );
        ok(sliderFillDuringAd === themeColors.sliderFill, `reklam SIRASINDA ses çubuğu dolgusu temanınkiyle aynı (${sliderFillDuringAd})`);

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
        ok(iconColorAfterAd === themeColors.icon, `reklam bitince ikon rengi temanınkiyle aynı (${iconColorAfterAd})`);
        const sliderFillAfterAd = await page.evaluate(() =>
            getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="volume-slider"] > div > div')).backgroundColor
        );
        ok(sliderFillAfterAd === themeColors.sliderFill, `reklam bitince ses çubuğu dolgusu temanınkiyle aynı (${sliderFillAfterAd})`);

        const after = await page.evaluate(() =>
            getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]')).display
        );
        ok(after !== 'none', 'reklam bitince (contentResumeRequested) seek bar geri geldi');
    });
}

// ── Pause reklamı (GPT mock'lu): gerçek gpt.js yerine sahte googletag; slotRenderEnded mock tarafından tetikleniyor. ──
const MOCK_GPT_INIT = () => {
    const listeners = [];
    const slots = {};
    window.__gpt = { define: 0, display: 0, refresh: 0, empty: window.__gptEmpty === true };
    function render(slot) {
        setTimeout(() => {
            const empty = window.__gpt.empty;
            const div = document.getElementById(slot.id);
            if (div) div.innerHTML = empty ? '' : '<div class="mock-creative" style="width:300px;height:250px;background:#e33"></div>';
            listeners.forEach((fn) => fn({ slot, isEmpty: empty, size: empty ? null : [300, 250] }));
        }, 40);
    }
    const pubads = {
        addEventListener: (type, fn) => listeners.push(fn),
        removeEventListener: (type, fn) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
        },
        refresh: (list) => {
            window.__gpt.refresh++;
            list.forEach(render);
        },
        isInitialLoadDisabled: () => false,
    };
    window.googletag = {
        cmd: { push: (fn) => fn() },
        defineSlot: (path, sizes, id) => {
            window.__gpt.define++;
            window.__gpt.lastSizes = sizes;
            window.__gpt.lastPath = path;
            slots[id] = { id, addService() { return this; }, setTargeting() { return this; }, getSlotElementId: () => id };
            return slots[id];
        },
        pubads: () => pubads,
        enableServices: () => {},
        display: (id) => {
            window.__gpt.display++;
            render(slots[id]);
        },
        destroySlots: () => true,
    };
};

async function pausePage(browser, { width = 960, empty = false } = {}) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('https://securepubads.g.doubleclick.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    if (empty) await page.addInitScript(() => { window.__gptEmpty = true; });
    await page.addInitScript(MOCK_GPT_INIT);
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((w) => {
        const el = document.getElementById('player');
        el.style.width = `${w}px`;
        el.style.display = 'block';
        window.__pauseEvents = [];
        el.addEventListener('hp:pausead', (e) => window.__pauseEvents.push(e.detail));
        el.options = { src: '/sample.mp4', muted: true, pauseAd: { adUnitPath: '/6355419/Travel/Europe/France/Paris', delayMs: 50 } };
    }, width);
    await page.waitForTimeout(400);
    return page;
}

const pauseAdState = (page) =>
    page.evaluate(() => {
        const el = document.getElementById('player');
        const root = el.shadowRoot;
        const panel = root.querySelector('.hp-pause-ad');
        const area = root.querySelector('.video-area');
        const layer = root.querySelector('.media-layer');
        const adDiv = el.querySelector('[slot="hp-pause-ad"]');
        return {
            open: panel?.hasAttribute('data-open') ?? false,
            areaFlag: area.hasAttribute('data-pause-ad'),
            layerRight: Math.round(area.getBoundingClientRect().right - layer.getBoundingClientRect().right),
            panelW: Math.round(panel?.getBoundingClientRect().width ?? 0),
            fit: getComputedStyle(root.querySelector('video')).objectFit,
            slotted: !!adDiv?.assignedSlot,
            creative: !!adDiv?.querySelector('.mock-creative'),
            paused: root.querySelector('video').paused,
            gpt: window.__gpt,
            events: window.__pauseEvents.map((d) => d.state + (d.reason ? `:${d.reason}` : '')),
        };
    });

const playThenPause = (page) =>
    page.evaluate(async () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        await v.play();
        await new Promise((r) => setTimeout(r, 250));
        v.pause();
    });

async function testPauseAd(browser) {
    console.log('\n[PA1] Pause reklamı: duraklatınca GPT isteği, dolunca video sola sıkışıyor, panel sağda');
    const page = await pausePage(browser);
    try {
        let st = await pauseAdState(page);
        ok(st.gpt.define === 0 && !st.open, 'oynatılmadan reklam istenmedi');
        await playThenPause(page);
        await page.waitForTimeout(700);
        st = await pauseAdState(page);
        ok(st.gpt.define === 1 && st.gpt.display === 1 && st.gpt.lastPath === '/6355419/Travel/Europe/France/Paris', `slot tanımlandı + display (${JSON.stringify(st.gpt)})`);
        ok(JSON.stringify(st.gpt.lastSizes) === JSON.stringify([[300, 250], [336, 280], [250, 250], [200, 200]]), `alana sığan boyutlar istendi ${JSON.stringify(st.gpt.lastSizes)}`);
        ok(st.open && st.areaFlag && st.creative && st.slotted, `panel açık, reklam light DOM'da ve slot'a yansıyor (${JSON.stringify(st)})`);
        ok(st.panelW === 332 && Math.abs(st.layerRight - 332) <= 1, `video ${st.layerRight}px sola sıkıştı (panel ${st.panelW}px)`);
        ok(st.fit === 'cover', `sıkışıkken video cover (${st.fit})`);
        ok(st.events.join() === 'shown', `hp:pausead shown (${st.events})`);

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-pause-ad-resume').click());
        await page.waitForTimeout(600);
        st = await pauseAdState(page);
        ok(!st.paused && !st.open && !st.areaFlag && st.layerRight === 0 && st.fit === 'contain', `"Videoya devam et" → oynuyor, panel kapandı, video eski haline döndü (${st.layerRight}px, ${st.fit})`);

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
        await page.waitForTimeout(600);
        st = await pauseAdState(page);
        ok(st.open && st.gpt.define === 1 && st.gpt.display === 1 && st.gpt.refresh === 0, `30 sn içinde tekrar pause → yeni istek atılmadan aynı reklam (${JSON.stringify(st.gpt)})`);

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-pause-ad-close').click());
        await page.waitForTimeout(500);
        st = await pauseAdState(page);
        ok(!st.open && st.paused && st.layerRight === 0, 'kapat (×) → panel kapandı, video duraklatılmış kaldı');
        ok(st.events.join() === 'shown,hidden:resumed,shown,hidden:closed', `olay sırası (${st.events})`);
    } finally {
        await page.close();
    }

    console.log('\n[PA2] Pause reklamı boş dönerse hiçbir şey açılmıyor');
    const p2 = await pausePage(browser, { empty: true });
    try {
        await playThenPause(p2);
        await p2.waitForTimeout(700);
        const st = await pauseAdState(p2);
        ok(st.gpt.define === 1 && !st.open && !st.areaFlag && st.layerRight === 0, 'boş reklam → panel açılmadı, video sıkışmadı');
        ok(st.events.join() === 'empty', `hp:pausead empty (${st.events})`);
    } finally {
        await p2.close();
    }

    console.log('\n[PA3] Dar player (minPlayerWidth altı) → reklam istenmiyor');
    const p3 = await pausePage(browser, { width: 520 });
    try {
        await playThenPause(p3);
        await p3.waitForTimeout(500);
        const st = await pauseAdState(p3);
        ok(st.gpt.define === 0 && !st.open, 'dar playerda GPT isteği yok');
    } finally {
        await p3.close();
    }
}

// --- Preroll kapısı (1.0.12) ---------------------------------------------------------------------------------------
// İstek üzerine: "video hiç başlamadan prerollu beklesin" — önceden içerik 1-2 sn oynuyor, reklam cevabı gelince
// duruyordu. Kapı: preroll sonuçlanana kadar içerik oynamaz; beklerken sol gruptaki halka döner, toolbar görünür kalır.

const gateState = (page) => page.evaluate(() => {
    const el = document.getElementById('player');
    const root = el.shadowRoot;
    const video = root.querySelector('video');
    return {
        paused: video.paused,
        time: video.currentTime,
        loading: root.querySelector('.hp-group-left').hasAttribute('data-loading'),
        chromeOpacity: root.querySelector('[part="control-bar"]').parentElement.style.opacity,
        centerOpacity: root.querySelector('[part="center-play-button"]').style.opacity,
        playIcon: root.querySelector('[part="play-pause-button"]').getAttribute('aria-label'),
        hpPlay: (window.__hpEvents || []).filter((e) => e === 'hp:play').length,
        adErrors: (window.__hpEvents || []).filter((e) => e.startsWith('hp:aderror')),
        log: window.__adsLog.map((e) => e.ev),
    };
});

const trackHpEvents = (page) => page.evaluate(() => {
    window.__hpEvents = [];
    const el = document.getElementById('player');
    el.addEventListener('hp:play', () => window.__hpEvents.push('hp:play'));
    el.addEventListener('hp:aderror', (e) => window.__hpEvents.push(`hp:aderror:${e.detail.message}`));
});

const loadAdManager = (page, cuePoints) => page.evaluate((cues) => {
    const loader = window.__mockIma.adsLoaderInstances[0];
    const mgr = new window.google.ima.AdsManager();
    if (cues) mgr.getCuePoints = () => cues;
    window.__mockIma.adsManagerInstances.push(mgr);
    loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
}, cuePoints ?? null);

const lastManager = (page, type) => page.evaluate((t) => {
    const mgr = window.__mockIma.adsManagerInstances.at(-1);
    mgr.dispatch(t, new window.google.ima.AdEvent(t));
}, type);

async function testPrerollGateAdReadyFirst(browser) {
    console.log('\n[8] Preroll kapısı: reklam önce hazırsa start() play\'e kadar bekliyor, içerik HİÇ oynamadan reklam başlıyor');
    await withPage(browser, 'preroll', async (page) => {
        await trackHpEvents(page);
        await loadAdManager(page);
        let s = await gateState(page);
        // init() de ertelenir: VMAP'te gerçek IMA init() anında preroll'u kendiliğinden oynatıyor.
        ok(!s.log.includes('adsManager.init') && !s.log.includes('adsManager.start'), 'reklam yüklendi ama kullanıcı oynatmadan init()/start() çağrılmadı (AdError 400 de olmaz)');

        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(500);
        s = await gateState(page);
        ok(s.log.includes('adsManager.init') && s.log.includes('adsManager.start'), 'play() → bekleyen preroll anında init + start edildi');
        ok(s.paused && s.time === 0, `içerik oynamadı (paused: ${s.paused}, t: ${s.time})`);
        ok(s.hpPlay === 0, `içerik için hp:play gönderilmedi (${s.hpPlay})`);

        await lastManager(page, 'contentPauseRequested');
        await page.waitForTimeout(100);
        s = await gateState(page);
        ok(!s.loading, 'reklam başlayınca bekleme halkası kapandı');

        await lastManager(page, 'contentResumeRequested');
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime > 0.2, null, { timeout: 5000 }).catch(() => {});
        s = await gateState(page);
        ok(!s.paused && s.time > 0.2, `reklam bitince içerik baştan başladı (t: ${s.time.toFixed(2)})`);
    });
}

async function testPrerollGatePlayFirst(browser) {
    console.log('\n[8b] Preroll kapısı: play önce, reklam sonra geliyor — beklerken halka döner, toolbar görünür, içerik 0. saniyede');
    await withPage(browser, 'preroll', async (page) => {
        await trackHpEvents(page);
        // Kullanıcı yolu: doğrudan video.play() (merkez buton / dokunma bunu çağırıyor) — kapı 'play' olayını yutar.
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {}));
        await page.waitForTimeout(2500); // otomatik gizleme süresinden (1200 ms) uzun
        let s = await gateState(page);
        // video.play() ile kapı arasında video 1 kare bile ilerleyebiliyor (~1 ms) — görünür bir oynatma değil.
        ok(s.paused && s.time < 0.05, `reklam beklenirken içerik oynamadı (t: ${s.time})`);
        ok(s.loading, 'sol gruptaki yükleme halkası dönüyor');
        ok(s.chromeOpacity === '1', `toolbar beklerken görünür kaldı (opacity ${s.chromeOpacity})`);
        ok(s.centerOpacity === '0', 'merkez oynat butonu beklerken gizli');
        ok(s.playIcon !== null && s.hpPlay === 0, `hp:play gönderilmedi (${s.hpPlay})`);

        await loadAdManager(page);
        s = await gateState(page);
        ok(s.log.includes('adsManager.start'), 'reklam gelince bekleyen oynatma isteğiyle hemen start() çağrıldı');
    });
}

async function testPrerollGateNoFill(browser) {
    console.log('\n[8c] Preroll kapısı: reklam gelmezse (hata / boş VAST) içerik hemen başlıyor');
    await withPage(browser, 'preroll', async (page) => {
        await trackHpEvents(page);
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(300);
        ok((await gateState(page)).paused, 'cevap gelene kadar içerik bekledi');
        await page.evaluate(() => window.__mockIma.adsLoaderInstances[0].dispatch('adError', new window.google.ima.AdErrorEvent('no-fill')));
        await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, null, { timeout: 3000 }).catch(() => {});
        const s = await gateState(page);
        ok(!s.paused, 'hata sonrası içerik başladı');
        ok(!s.loading, 'halka kapandı');
        ok(s.adErrors.some((e) => e.includes('no-fill')), `hp:aderror gönderildi (${s.adErrors.join(', ')})`);
    });
}

async function testPrerollGateNoPlayNoAutostart(browser) {
    console.log('\n[8d] Preroll kapısı: kullanıcı oynatmadan reklam hata verirse içerik KENDİLİĞİNDEN başlamıyor');
    await withPage(browser, 'preroll', async (page) => {
        await page.evaluate(() => window.__mockIma.adsLoaderInstances[0].dispatch('adError', new window.google.ima.AdErrorEvent('no-fill')));
        await page.waitForTimeout(500);
        let s = await gateState(page);
        ok(s.paused && s.time === 0, 'içerik oynatılmadan başlamadı');
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(500);
        s = await gateState(page);
        ok(!s.paused, 'kapı açıldıktan sonra play() normal çalıştı');
    });
}

async function testPrerollGateTimeout(browser) {
    console.log('\n[8e] Preroll kapısı: zaman aşımı (prerollTimeoutMs) dolunca içerik başlıyor, geç gelen reklam araya GİRMİYOR');
    await withPage(browser, 'preroll-timeout', async (page) => {
        await trackHpEvents(page);
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(400);
        ok((await gateState(page)).paused, 'süre dolmadan içerik bekliyor');
        await page.waitForTimeout(900);
        let s = await gateState(page);
        ok(!s.paused, 'süre dolunca içerik reklamsız başladı');
        ok(s.adErrors.some((e) => e.includes('preroll-timeout')), `hp:aderror: preroll-timeout (${s.adErrors.join(', ')})`);

        await loadAdManager(page);
        await page.waitForTimeout(300);
        s = await gateState(page);
        ok(s.log.includes('adsManager.destroy') && !s.log.includes('adsManager.start'), 'geç gelen preroll yok edildi, başlatılmadı');
        ok(!s.paused, 'içerik kesilmeden oynamaya devam ediyor');
    });
}

async function testPrerollGateVmapWithoutPreroll(browser) {
    console.log('\n[8f] Preroll kapısı: yalnızca VMAP, 0 noktasında reklam yoksa içerik beklemeden başlıyor');
    await withPage(browser, 'vmaponly', async (page) => {
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(300);
        ok((await gateState(page)).paused, 'VMAP cevabı gelene kadar bekledi');
        await loadAdManager(page, [30, -1]);
        await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, null, { timeout: 3000 }).catch(() => {});
        const s = await gateState(page);
        ok(!s.paused, 'preroll olmayan VMAP → içerik başladı');
        ok(s.log.includes('adsManager.start'), 'midroll/postroll için VMAP yine başlatıldı');
    });
}

async function testPrerollGateCancel(browser) {
    console.log('\n[8g] Preroll kapısı: beklerken oynat/duraklat butonuna basmak beklemeyi iptal ediyor');
    await withPage(browser, 'preroll', async (page) => {
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(300);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"]').click());
        await page.waitForTimeout(200);
        let s = await gateState(page);
        ok(!s.loading, 'iptal sonrası halka kapandı');
        ok(s.centerOpacity === '1', 'merkez oynat butonu geri geldi');
        await loadAdManager(page);
        s = await gateState(page);
        ok(!s.log.includes('adsManager.start'), 'iptalden sonra gelen reklam kendiliğinden başlamadı');
    });
}

async function testPrerollGateAutoplay(browser) {
    console.log('\n[8h] Preroll kapısı: autoplay — plugin yüklenmeden ÖNCE başlayan autoplay da kapıda tutuluyor');
    await withPage(browser, 'preroll-autoplay', async (page) => {
        await page.waitForTimeout(800);
        let s = await gateState(page);
        ok(s.paused && s.time < 0.05, `autoplay reklam beklenirken içeriği oynatmadı (t: ${s.time})`);
        ok(s.loading, 'autoplay beklemesinde halka dönüyor');
        await loadAdManager(page);
        s = await gateState(page);
        ok(s.log.includes('adsManager.start'), 'reklam gelince hemen başladı');
    });
}

async function testVmapBreakTypesAndPostroll(browser) {
    console.log('\n[8i] VMAP: aranın tipi IMA konumundan (midroll "preroll" diye bildirilmiyordu), içerik bitince contentComplete (postroll hiç oynamıyordu)');
    await withPage(browser, 'vmaponly', async (page) => {
        await page.evaluate(() => {
            window.__types = [];
            const el = document.getElementById('player');
            el.addEventListener('hp:adstart', (e) => window.__types.push('start:' + e.detail.type));
            el.addEventListener('hp:adend', (e) => window.__types.push('end:' + e.detail.type));
            el.play();
        });
        await loadAdManager(page, [0, 15, -1]);
        await page.evaluate(() => {
            const mgr = window.__mockIma.adsManagerInstances.at(-1);
            const ev = (type, offset) => {
                const e = new window.google.ima.AdEvent(type);
                e.getAd = () => ({ getAdPodInfo: () => ({ getAdPosition: () => 1, getTotalAds: () => 1, getPodIndex: () => 0, getTimeOffset: () => offset }) });
                return e;
            };
            mgr.dispatch('contentPauseRequested', ev('contentPauseRequested', 0));
            mgr.dispatch('contentResumeRequested', ev('contentResumeRequested', 0));
            mgr.dispatch('contentPauseRequested', ev('contentPauseRequested', 15));
            mgr.dispatch('contentResumeRequested', ev('contentResumeRequested', 15));
        });
        const types = await page.evaluate(() => window.__types);
        ok(JSON.stringify(types) === JSON.stringify(['start:preroll', 'end:preroll', 'start:midroll', 'end:midroll']), `aralar doğru tiple bildirildi (${types.join(', ')})`);

        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').dispatchEvent(new Event('ended')));
        const log = await page.evaluate(() => window.__adsLog.map((e) => e.ev));
        ok(log.filter((e) => e === 'contentComplete').length === 1, 'içerik bitince IMA\'ya contentComplete bildirildi (VMAP postroll için)');
        ok(log.filter((e) => e === 'requestAds').length === 1, 'VMAP için ayrıca postroll isteği atılmadı');
    });
}

async function testMediaStallKeepsToolbar(browser) {
    console.log('\n[9] Medya takılınca: halka dönüyor ve toolbar otomatik gizlenmiyor; takılma bitince normal gizleniyor');
    await withPage(browser, 'none', async (page) => {
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(400);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').dispatchEvent(new Event('waiting')));
        await page.waitForTimeout(2500);
        let s = await gateState(page);
        ok(s.loading, 'takılmada halka dönüyor');
        ok(s.chromeOpacity === '1', `takılma sürerken toolbar gizlenmedi (opacity ${s.chromeOpacity})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').dispatchEvent(new Event('playing')));
        await page.waitForTimeout(2500);
        s = await gateState(page);
        ok(!s.loading, 'takılma bitince halka kapandı');
        ok(s.chromeOpacity === '0', `takılma bitince toolbar normal şekilde gizlendi (opacity ${s.chromeOpacity})`);
    });
}

// --- requestWhen (1.0.12) -------------------------------------------------------------------------------------------
// İstek üzerine: "uzun bir makalenin en altındaki, daha ekranda olmayan player için reklam isteği atmak sorun olabilir"
// — varsayılan 'visible': istek player ekrana yaklaşınca (bir ekran boyu kala) atılır.

/** Player'ı sayfanın çok altına iter (uzun makale), sayfa scriptleri çalışmadan önce. */
const PUSH_PLAYER_DOWN = () => {
    // initScript belge kurulmadan çalışıyor — stil <head> oluşur oluşmaz eklenir (sayfa scriptlerinden önce).
    const add = () => {
        if (!document.head || document.getElementById('push-down')) return false;
        const style = document.createElement('style');
        style.id = 'push-down';
        style.textContent = 'hope-player#player { margin-top: 4000px !important; }';
        document.head.appendChild(style);
        return true;
    };
    if (add()) return;
    const mo = new MutationObserver(() => { if (add()) mo.disconnect(); });
    mo.observe(document, { childList: true, subtree: true });
};

async function withOffscreenPage(browser, scenario, fn) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.addInitScript(MOCK_IMA_INIT_SCRIPT);
    await page.addInitScript(PUSH_PLAYER_DOWN);
    await page.goto(`${BASE}/?ads=${scenario}`);
    await page.waitForFunction(() => window.__mockIma.adsLoaderInstances.length > 0, null, { timeout: 8000 });
    await page.waitForTimeout(500);
    try {
        await fn(page);
    } finally {
        await page.close();
    }
}

const requestCount = (page) => page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length);

async function testRequestWhenVisible(browser) {
    console.log('\n[10] requestWhen: \'visible\' (varsayılan) — sayfanın altındaki player için istek ekrana yaklaşınca atılıyor');
    await withOffscreenPage(browser, 'preroll', async (page) => {
        ok((await requestCount(page)) === 0, 'player ekrandan uzakken reklam isteği atılmadı');
        // Bir ekran boyu kala: player'ın üst kenarı görünüm altından < 1 ekran boyu uzakta.
        await page.evaluate(() => {
            const top = document.getElementById('player').getBoundingClientRect().top + window.scrollY;
            window.scrollTo(0, top - window.innerHeight * 1.8);
        });
        await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), null, { timeout: 3000 }).catch(() => {});
        ok((await requestCount(page)) === 1, 'player ekrana yaklaşınca (henüz görünmeden) tam 1 istek atıldı');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(300);
        ok((await requestCount(page)) === 1, 'yeniden görünüme girip çıkmak ikinci istek atmadı');
    });
}

async function testRequestWhenVisiblePlayOffscreen(browser) {
    console.log('\n[10b] requestWhen: \'visible\' — player görünmeden play() çağrılırsa istek hemen atılıyor');
    await withOffscreenPage(browser, 'preroll', async (page) => {
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(200);
        ok((await requestCount(page)) === 1, 'programatik play() → istek beklemeden atıldı');
    });
}

async function testRequestWhenLoad(browser) {
    console.log('\n[10c] requestWhen: \'load\' — player ekrandan uzakta olsa da istek hemen atılıyor');
    await withOffscreenPage(browser, 'preroll-load', async (page) => {
        ok((await requestCount(page)) === 1, 'sayfa açılınca tam 1 istek');
    });
}

async function testRequestWhenPlay(browser) {
    console.log('\n[10d] requestWhen: \'play\' — istek oynatma isteğinde (preroll kapısı \'play\'i yutsa da) atılıyor');
    await withPage(browser, 'preroll-play', async (page) => {
        ok((await requestCount(page)) === 0, 'oynatmadan istek yok');
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {}));
        await page.waitForTimeout(300);
        ok((await requestCount(page)) === 1, 'oynat\'a basınca istek atıldı');
        const paused = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(paused, 'cevap gelene kadar içerik bekliyor');
    });
}

async function testStalePrerollRefetched(browser) {
    console.log('\n[10e] Hazırda bekleyen preroll 5 dakikadan eskiyse oynatılırken taze istek atılıyor');
    await withPage(browser, 'preroll', async (page) => {
        await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), null, { timeout: 3000 });
        await loadAdManager(page);
        // 6 dakika ileri sar.
        await page.evaluate(() => {
            const real = Date.now.bind(Date);
            Date.now = () => real() + 6 * 60 * 1000;
        });
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(300);
        const log = await page.evaluate(() => window.__adsLog.map((e) => e.ev));
        ok(log.filter((e) => e === 'requestAds').length === 2, 'eski reklam yerine ikinci (taze) istek atıldı');
        ok(log.includes('adsManager.destroy') && !log.includes('adsManager.start'), 'eski reklam yok edildi, başlatılmadı');
        const paused = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(paused, 'taze reklam beklenirken içerik oynamıyor');
    });
}

async function testNonLinearOverlay(browser) {
    console.log('\n[11] Overlay (non-linear) reklam: içerik beklemeden başlıyor, katman alt şerit, video tıklanabilir, kapatınca gizleniyor');
    // GERÇEK BUG: overlay içeriği durdurmuyor (CONTENT_PAUSE_REQUESTED gelmiyor) — preroll kapısı onu beklediği için içerik
    // 8 sn zaman aşımına kadar bekliyor, overlay de hiç gösterilmiyordu. Google örnek tag'leri: nonlinear / VPAID non-linear.
    await withPage(browser, 'preroll', async (page) => {
        await page.evaluate(() => {
            window.__nl = [];
            const el = document.getElementById('player');
            el.addEventListener('hp:adstart', (e) => window.__nl.push(`start:${e.detail.type}:${e.detail.linear}`));
            el.addEventListener('hp:adend', (e) => window.__nl.push(`end:${e.detail.type}:${e.detail.linear}`));
            el.play();
        });
        await loadAdManager(page);
        await page.evaluate(() => {
            const mgr = window.__mockIma.adsManagerInstances.at(-1);
            const e = new window.google.ima.AdEvent('loaded');
            e.getAd = () => ({ getAdPodInfo: () => ({ getTimeOffset: () => 0 }), isLinear: () => false, getHeight: () => 70 });
            mgr.dispatch('loaded', e);
        });
        await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, null, { timeout: 3000 }).catch(() => {});
        const s = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const layer = root.querySelector('[part="ad-layer"]');
            const area = root.querySelector('.video-area').getBoundingClientRect();
            const lr = layer.getBoundingClientRect();
            const mid = root.elementFromPoint(area.left + area.width / 2, area.top + area.height / 3);
            return {
                paused: root.querySelector('video').paused,
                nonlinear: layer.hasAttribute('data-nonlinear'),
                visible: !layer.classList.contains('hp:hidden'),
                layerH: Math.round(lr.height),
                areaH: Math.round(area.height),
                midHit: mid?.tagName,
                events: window.__nl.slice(),
            };
        });
        ok(!s.paused, 'overlay yüklenince içerik zaman aşımı beklemeden başladı');
        ok(s.nonlinear && s.visible, 'reklam katmanı overlay modunda görünür');
        ok(s.layerH < s.areaH / 2, `katman yalnızca alt şerit (${s.layerH}px / ${s.areaH}px) — videonun üstü kapanmıyor`);
        ok(s.midHit === 'VIDEO', `videonun üst kısmı tıklanabilir (${s.midHit})`);
        ok(s.events.includes('start:preroll:false'), `hp:adstart linear:false (${s.events.join(', ')})`);

        await page.evaluate(() => window.__mockIma.adsManagerInstances.at(-1).dispatch('userClose', new window.google.ima.AdEvent('userClose')));
        const after = await page.evaluate(() => {
            const layer = document.getElementById('player').shadowRoot.querySelector('[part="ad-layer"]');
            return { nonlinear: layer.hasAttribute('data-nonlinear'), hidden: layer.classList.contains('hp:hidden'), events: window.__nl.slice() };
        });
        ok(!after.nonlinear && after.hidden, 'kullanıcı kapatınca katman gizlendi');
        ok(after.events.includes('end:preroll:false'), 'hp:adend linear:false gönderildi');
    });
}

async function testNoSpuriousAdEnd(browser) {
    console.log('\n[11b] Preroll\'u olmayan VMAP: başlangıçtaki "içeriğe dön" sinyali sahte hp:adend üretmiyor');
    await withPage(browser, 'vmaponly', async (page) => {
        await page.evaluate(() => {
            window.__ends = 0;
            document.getElementById('player').addEventListener('hp:adend', () => window.__ends++);
            document.getElementById('player').play();
        });
        await loadAdManager(page, [15, -1]);
        await page.evaluate(() => {
            const mgr = window.__mockIma.adsManagerInstances.at(-1);
            mgr.dispatch('contentResumeRequested', new window.google.ima.AdEvent('contentResumeRequested'));
        });
        ok((await page.evaluate(() => window.__ends)) === 0, 'başlamamış bir ara için hp:adend gönderilmedi');
    });
}

async function testAdCountdown(browser) {
    console.log('\n[12] Reklam geri sayımı + pod göstergesi toolbar\'da ("Reklam 2/3 · 0:13"), reklam bitince gizleniyor');
    await withPage(browser, 'preroll', async (page) => {
        await page.evaluate(() => document.getElementById('player').play());
        await loadAdManager(page);
        await page.evaluate(() => {
            const mgr = window.__mockIma.adsManagerInstances.at(-1);
            mgr.getRemainingTime = () => 12.3;
            mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
            const e = new window.google.ima.AdEvent('started');
            e.getAd = () => ({ isLinear: () => true, getAdPodInfo: () => ({ getAdPosition: () => 2, getTotalAds: () => 3, getPodIndex: () => 0 }) });
            mgr.dispatch('started', e);
        });
        const text = await page.evaluate(() => {
            const el = document.getElementById('player').shadowRoot.querySelector('[part="ad-countdown"]');
            return el.style.display === 'none' ? null : el.textContent;
        });
        ok(text === 'Reklam 2/3 · 0:13', `gösterge "${text}"`);
        await lastManager(page, 'contentResumeRequested');
        const hidden = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="ad-countdown"]').style.display === 'none');
        ok(hidden, 'reklam bitince gösterge gizlendi');
    });
}

async function testAdErrorDetailsAndDebugLog(browser) {
    console.log('\n[13] Gelişmiş hata ayrıntısı: hp:aderror IMA kodlarıyla; options.debug ile sağ tık → "Hata ayıklama" penceresi');
    await withPage(browser, 'preroll', async (page) => {
        await page.evaluate(() => {
            window.__adErr = null;
            const el = document.getElementById('player');
            el.addEventListener('hp:aderror', (e) => (window.__adErr = e.detail));
            const err = new window.google.ima.AdErrorEvent('No ads VAST response');
            err.getError = () => ({ getMessage: () => 'No ads VAST response', getErrorCode: () => 1009, getVastErrorCode: () => 303, getType: () => 'adLoadError' });
            window.__mockIma.adsLoaderInstances[0].dispatch('adError', err);
        });
        const detail = await page.evaluate(() => window.__adErr);
        ok(detail?.code === 1009 && detail?.vastCode === 303 && detail?.errorType === 'adLoadError' && detail?.breakType === 'preroll',
            `hp:aderror ayrıntıları (${JSON.stringify(detail)})`);

        const rightClickMenu = () =>
            page.evaluate(() => {
                const el = document.getElementById('player');
                const r = el.getBoundingClientRect();
                el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true, composed: true }));
                el.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.left + 50, clientY: r.top + 50, bubbles: true, composed: true, cancelable: true }));
                return [...el.shadowRoot.querySelectorAll('.hp-context-menu-item')].map((i) => i.textContent);
            });
        let items = await rightClickMenu();
        ok(!items.some((t) => t.startsWith('Hata ayıklama')), `debug kapalıyken menüde "Hata ayıklama" yok (${items.join(' | ')})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-context-menu')?.removeAttribute('data-open'));

        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, debug: true };
        });
        await page.waitForTimeout(200);
        items = await rightClickMenu();
        ok(items.some((t) => t.startsWith('Hata ayıklama')), `debug açıkken menüde "Hata ayıklama" var (${items.join(' | ')})`);
        await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('button.hp-context-menu-item')].at(-1).click());
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-debug'), null, { timeout: 3000 }).catch(() => {});
        const panel = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const p = root.querySelector('.hp-debug');
            if (!p) return null;
            const area = root.querySelector('.video-area').getBoundingClientRect();
            const r = p.getBoundingClientRect();
            const list = p.querySelector('.hp-debug-list');
            return {
                rows: p.querySelectorAll('.hp-debug-row').length,
                text: p.textContent,
                inside: r.left >= area.left && r.right <= area.right && r.top >= area.top && r.bottom <= area.bottom,
                hOverflow: list.scrollWidth > list.clientWidth,
            };
        });
        ok(panel && panel.rows >= 1, `pencere açıldı, ${panel?.rows} kayıt`);
        ok(panel?.text.includes('1009') && panel?.text.includes('303'), 'kayıtta IMA hata kodu ve VAST kodu var');
        ok(panel?.inside && !panel?.hOverflow, 'pencere player\'ın içinde, yatay taşma yok');

        // Açıkken gelen yeni hata canlı eklenir.
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').dispatchEvent(new Event('error')));
        await page.evaluate(() => {
            document.getElementById('player').errorLog.add({ source: 'stream', message: 'networkError: fragLoadError', fatal: true, details: { httpStatus: 404 } });
        });
        const rows = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-debug-row').length);
        ok(rows === panel.rows + 1, `açık pencere canlı güncellendi (${rows} kayıt)`);
        await page.keyboard.press('Escape');
        const closed = await page.evaluate(() => !document.getElementById('player').shadowRoot.querySelector('.hp-debug'));
        ok(closed, 'ESC ile kapandı');
    });
}

async function testOmidAccess(browser) {
    console.log('\n[15] Open Measurement: varsayılan tüm ölçüm firmalarına full; firma bazında ayar');
    await withPage(browser, 'preroll', async (page) => {
        const rules = await page.evaluate(() => window.__lastRequest?.omidAccessModeRules);
        const vals = rules ? Object.values(rules) : [];
        ok(vals.length === 9 && vals.every((v) => v === 'full'), `varsayılan: 9 firma, hepsi full (${JSON.stringify(rules)})`);
        await page.evaluate(() => {
            window.__mockIma.adsLoaderInstances.length = 0;
            window.__lastRequest = null;
            const el = document.createElement('hope-player');
            document.body.appendChild(el);
            el.options = {
                muted: true,
                src: '/sample.mp4',
                ads: { adTagPreroll: 'https://example.com/vast/preroll', requestWhen: 'load', omidAccessMode: { default: 'limited', GOOGLE: 'full', DOUBLEVERIFY: 'domain' } },
            };
        });
        await page.waitForFunction(() => window.__lastRequest, null, { timeout: 5000 }).catch(() => {});
        const custom = await page.evaluate(() => window.__lastRequest?.omidAccessModeRules);
        ok(custom?.[9] === 'full' && custom?.[3] === 'domain' && custom?.[1] === 'limited' && custom?.[4] === 'limited',
            `firma bazında: GOOGLE full, DOUBLEVERIFY domain, diğerleri limited (${JSON.stringify(custom)})`);
    });
}

async function testIosNativeFullscreen(browser) {
    console.log('\n[16] iPhone native tam ekran: midroll başlarken çıkılıyor, bitince "Tam ekrana dön"; postroll’dan sonra buton yok');
    await withPage(browser, 'vmaponly', async (page) => {
        await page.evaluate(() => {
            const el = document.getElementById('player');
            const video = el.shadowRoot.querySelector('video');
            window.__nativeFs = true;
            window.__fsLog = [];
            Object.defineProperty(video, 'webkitDisplayingFullscreen', { get: () => window.__nativeFs, configurable: true });
            video.webkitExitFullscreen = () => { window.__nativeFs = false; window.__fsLog.push('exit'); };
            video.webkitEnterFullscreen = () => { window.__nativeFs = true; window.__fsLog.push('enter'); };
            // iPhone: element tam ekranı yok.
            el.requestFullscreen = undefined;
            el.webkitRequestFullscreen = undefined;
            el.play();
        });
        await loadAdManager(page, [0, 15, -1]);
        const ev = (type, offset) => page.evaluate(([type, offset]) => {
            const mgr = window.__mockIma.adsManagerInstances.at(-1);
            const e = new window.google.ima.AdEvent(type);
            e.getAd = () => ({ getAdPodInfo: () => ({ getAdPosition: () => 1, getTotalAds: () => 1, getPodIndex: () => 0, getTimeOffset: () => offset }) });
            mgr.dispatch(type, e);
        }, [type, offset]);
        const button = () => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="ad-return"]')?.textContent ?? null);

        await ev('contentPauseRequested', 15);
        const afterStart = await page.evaluate(() => ({ log: window.__fsLog.slice(), fs: window.__nativeFs }));
        ok(afterStart.log.includes('exit') && !afterStart.fs, `midroll başlarken native tam ekrandan çıkıldı (${afterStart.log.join(',')})`);
        ok((await button()) === null, 'reklam sırasında geri dön butonu yok');

        await ev('contentResumeRequested', 15);
        const label = await button();
        ok(label === 'Tam ekrana dön', `reklam bitince buton göründü ("${label}")`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="ad-return"]').click());
        const afterClick = await page.evaluate(() => ({ log: window.__fsLog.slice(), fs: window.__nativeFs }));
        ok(afterClick.log.at(-1) === 'enter' && afterClick.fs, 'butona dokununca native tam ekrana dönüldü');
        ok((await button()) === null, 'dokununca buton kayboldu');

        // Tam ekran açıkken postroll: çıkılır, ama içerik bittiği için geri dönüş önerilmez.
        await ev('contentPauseRequested', -1);
        await ev('contentResumeRequested', -1);
        ok(!(await page.evaluate(() => window.__nativeFs)), 'postroll başlarken de çıkıldı');
        ok((await button()) === null, 'postroll’dan sonra geri dön butonu yok');

        // Tam ekranda değilken reklam: hiçbir şey yapılmaz.
        await page.evaluate(() => { window.__fsLog.length = 0; });
        await ev('contentPauseRequested', 15);
        await ev('contentResumeRequested', 15);
        ok((await page.evaluate(() => window.__fsLog.length)) === 0 && (await button()) === null, 'normal görünümde reklam: çıkış / buton yok');
    });
}

async function testIosFullscreenDefer(browser) {
    console.log('\n[16b] iosFullscreen: "defer" — native tam ekrandayken aralıklı midroll istenmiyor, çıkınca isteniyor');
    await withPage(browser, 'preroll', async (page) => {
        await page.evaluate(() => {
            window.__mockIma.adsLoaderInstances.length = 0;
            const el = document.createElement('hope-player');
            el.id = 'defer-player';
            document.body.appendChild(el);
            el.options = {
                muted: true,
                src: '/sample.mp4',
                ads: { adTagMidroll: 'https://example.com/vast/midroll', midrollIntervalSeconds: 5, iosFullscreen: 'defer' },
            };
        });
        await page.waitForFunction(() => window.__mockIma.adsLoaderInstances.length > 0, null, { timeout: 5000 }).catch(() => {});
        const requests = () => page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length);
        const before = await requests();
        await page.evaluate(() => {
            const video = document.getElementById('defer-player').shadowRoot.querySelector('video');
            window.__nativeFs = true;
            Object.defineProperty(video, 'webkitDisplayingFullscreen', { get: () => window.__nativeFs, configurable: true });
            Object.defineProperty(video, 'currentTime', { value: 61, writable: true, configurable: true });
            video.dispatchEvent(new Event('timeupdate'));
        });
        ok((await requests()) === before, 'tam ekrandayken midroll istenmedi');
        await page.evaluate(() => {
            window.__nativeFs = false;
            document.getElementById('defer-player').shadowRoot.querySelector('video').dispatchEvent(new Event('timeupdate'));
        });
        ok((await requests()) === before + 1, 'tam ekrandan çıkınca midroll istendi');
    });
}

async function testAdResize(browser) {
    console.log('\n[17] Reklam boyutu: player küçülünce / tam ekrana girip çıkınca adsManager.resize doğru boyut ve modla çağrılıyor');
    await withPage(browser, 'preroll', async (page) => {
        await page.evaluate(() => document.getElementById('player').play());
        await loadAdManager(page);
        await lastManager(page, 'contentPauseRequested');
        const lastResize = () => page.evaluate(() => {
            const r = window.__adsLog.filter((e) => e.ev === 'adsManager.resize').at(-1);
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            return r ? { ...r, vw: v.clientWidth, vh: v.clientHeight } : null;
        });
        const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));

        await page.evaluate(() => { document.getElementById('player').style.width = '320px'; });
        await frames();
        let r = await lastResize();
        ok(r && r.w === r.vw && r.h === r.vh && r.w <= 320 && r.viewMode === 'normal', `pencere küçülünce: ${r?.w}x${r?.h} (${r?.viewMode})`);

        // Tam ekran: host fullscreenElement olur ve player büyür.
        await page.evaluate(() => {
            const el = document.getElementById('player');
            Object.defineProperty(document, 'fullscreenElement', { get: () => window.__fs ? el : null, configurable: true });
            window.__fs = true;
            el.style.width = '900px';
        });
        await frames();
        r = await lastResize();
        ok(r && r.w === r.vw && r.w > 320 && r.viewMode === 'fullscreen', `tam ekrana girince: ${r?.w}x${r?.h} (${r?.viewMode})`);

        await page.evaluate(() => {
            window.__fs = false;
            document.getElementById('player').style.width = '480px';
        });
        await frames();
        r = await lastResize();
        ok(r && r.w === r.vw && r.w <= 480 && r.viewMode === 'normal', `ESC ile çıkınca küçüldü: ${r?.w}x${r?.h} (${r?.viewMode})`);

        // Bir pencere sürüklemesi boyunca kare başına en fazla bir resize.
        const before = await page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'adsManager.resize').length);
        await page.evaluate(() => {
            const el = document.getElementById('player');
            for (let w = 400; w < 460; w += 5) el.style.width = w + 'px';
        });
        await frames();
        const after = await page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'adsManager.resize').length);
        ok(after - before <= 2, `art arda boyut değişimi tek çağrıya indirildi (${after - before})`);
    });
}

async function testContinuousPlaybackSignal(browser) {
    console.log('\n[14] Sürekli oynatma bildirimi: tekil videoda false, otomatik ilerleyen playlist\'te true');
    await withPage(browser, 'preroll', async (page) => {
        const single = await page.evaluate(() => window.__lastRequest?.continuousPlayback);
        ok(single === false, `tekil video → setContinuousPlayback(false) (${single})`);
        await page.evaluate(() => {
            window.__mockIma.adsLoaderInstances.length = 0;
            const el = document.createElement('hope-player');
            el.id = 'playlist-player';
            document.body.appendChild(el);
            el.options = {
                muted: true,
                playlist: { items: [{ title: 'A', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] }, { title: 'B', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] }] },
                ads: { adTagPreroll: 'https://example.com/vast/preroll', requestWhen: 'load' },
            };
        });
        await page.waitForFunction(() => window.__mockIma.adsLoaderInstances.length > 0 && window.__lastRequest, null, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
        const playlist = await page.evaluate(() => window.__lastRequest?.continuousPlayback);
        ok(playlist === true, `playlist (autoplayNext) → setContinuousPlayback(true) (${playlist})`);
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
        await testOptionsBeforeConnect(browser);
        await testAdModeToolbar(browser);
        await testPauseAd(browser);
        await testPrerollGateAdReadyFirst(browser);
        await testPrerollGatePlayFirst(browser);
        await testPrerollGateNoFill(browser);
        await testPrerollGateNoPlayNoAutostart(browser);
        await testPrerollGateTimeout(browser);
        await testPrerollGateVmapWithoutPreroll(browser);
        await testPrerollGateCancel(browser);
        await testPrerollGateAutoplay(browser);
        await testVmapBreakTypesAndPostroll(browser);
        await testMediaStallKeepsToolbar(browser);
        await testRequestWhenVisible(browser);
        await testRequestWhenVisiblePlayOffscreen(browser);
        await testRequestWhenLoad(browser);
        await testRequestWhenPlay(browser);
        await testStalePrerollRefetched(browser);
        await testNonLinearOverlay(browser);
        await testNoSpuriousAdEnd(browser);
        await testAdCountdown(browser);
        await testAdErrorDetailsAndDebugLog(browser);
        await testContinuousPlaybackSignal(browser);
        await testOmidAccess(browser);
        await testIosNativeFullscreen(browser);
        await testIosFullscreenDefer(browser);
        await testAdResize(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
