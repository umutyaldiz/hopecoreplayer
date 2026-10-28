// HopeCorePlayer — Faz 3 (Prebid + consent) Playwright doğrulama scripti.
// window.google.ima + window.pbjs tamamen mock'lanarak VideoPrebid auction
// akışı (direkt VAST + GAM modu, retry'da auction tekrarlanmaması) ve generic
// consentAware (TCF/USP) non-personalized ads zorlaması network'ten bağımsız,
// deterministik olarak doğrulanıyor.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

const MOCK_IMA = readFileSync(new URL('./_mock-ima.js', import.meta.url), 'utf8');
const MOCK_PBJS = readFileSync(new URL('./_mock-pbjs.js', import.meta.url), 'utf8');

async function openScenario(browser, scenario, { withPbjs = false, extraInit = null } = {}) {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    await page.addInitScript(MOCK_IMA);
    if (withPbjs) await page.addInitScript(MOCK_PBJS);
    if (extraInit) await page.addInitScript(extraInit);
    await page.goto(`${BASE}/?ads=${scenario}`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    if (consoleErrors.length) console.log('  console errors:', consoleErrors);
    return page;
}

function custParam(url, key) {
    try {
        const cust = new URL(url).searchParams.get('cust_params') ?? '';
        const match = cust.split('&').find((p) => p.startsWith(`${key}=`));
        return match ? decodeURIComponent(match.slice(key.length + 1)) : null;
    } catch {
        return null;
    }
}

async function testPrebidDirectVast(browser) {
    console.log('\n[1] Prebid (direkt VAST modu): kazanan bid vastUrl\'i nihai ad tag olarak kullanılıyor mu?');
    const page = await openScenario(browser, 'prebid', { withPbjs: true });
    await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), { timeout: 2000 });
    const log = await page.evaluate(() => window.__adsLog);
    const pbjsLog = await page.evaluate(() => window.__pbjsLog);
    const req = log.find((e) => e.ev === 'requestAds');

    ok(pbjsLog.some((e) => e.ev === 'requestBids'), 'pbjs.requestBids çağrıldı');
    ok(req?.adTagUrl === 'https://cache.example.com/cache?uuid=mock-uuid-1', `nihai istek kazanan bid'in vastUrl'i (${req?.adTagUrl})`);
    await page.close();
}

async function testPrebidGam(browser) {
    console.log('\n[2] Prebid (GAM modu): pbjs.adServers.gam.buildVideoUrl\'ün döndürdüğü URL kullanılıyor mu?');
    const page = await openScenario(browser, 'prebid-gam', { withPbjs: true });
    await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), { timeout: 2000 });
    const log = await page.evaluate(() => window.__adsLog);
    const pbjsLog = await page.evaluate(() => window.__pbjsLog);
    const req = log.find((e) => e.ev === 'requestAds');

    ok(pbjsLog.some((e) => e.ev === 'buildVideoUrl' && e.iu === '/123456/site-preroll'), 'buildVideoUrl doğru gamAdUnit (iu) ile çağrıldı');
    ok(req?.adTagUrl?.startsWith('https://pubads.g.doubleclick.net/gampad/ads?iu=%2F123456%2Fsite-preroll'), `nihai istek GAM URL'i (${req?.adTagUrl})`);
    await page.close();
}

async function testPrebidGamCustParamsForwarded(browser) {
    // Üst-repo güncellemesi: buildVideoUrl artık fallback tag'in cust_params'ını
    // (adTaxonomy + adrefreshCount, hb_* hariç) ayrı bir params.cust_params
    // objesi olarak alıyor — GAM modu URL'i sıfırdan kurduğu için bu alan
    // taşınmazsa adTaxonomy key-value'ları (ve retry'daki adrefreshCount)
    // GAM isteğinde tamamen kaybolurdu.
    console.log('\n[2b] Prebid (GAM modu): fallback tag\'in cust_params\'ı (adTaxonomy) buildVideoUrl\'e ayrı obje olarak forward ediliyor mu?');
    const page = await openScenario(browser, 'prebid-gam', {
        withPbjs: true,
        extraInit: () => {
            window.adTaxonomy = { keyValues: { ht_category: 'gundem' } };
        },
    });
    await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), { timeout: 2000 });
    const pbjsLog = await page.evaluate(() => window.__pbjsLog);
    const call = pbjsLog.find((e) => e.ev === 'buildVideoUrl');

    ok(!!call?.custParams, `buildVideoUrl çağrısında params.cust_params objesi var (${JSON.stringify(call?.custParams)})`);
    ok(call?.custParams?.ht_category === 'gundem', `adTaxonomy.keyValues (ht_category=gundem) cust_params objesine taşındı`);
    ok(!('hb_pb' in (call?.custParams || {})), 'hb_* targeting key\'leri cust_params objesine KOPYALANMADI (Prebid kendi ekliyor, çakışma riski yok)');
    await page.close();
}

async function testPrebidUnavailableFallsBack(browser) {
    console.log('\n[3] Prebid.enabled=true ama window.pbjs HİÇ yüklenmemiş: sessizce normal fallback VAST\'e düşüyor mu?');
    const page = await openScenario(browser, 'prebid', { withPbjs: false });
    await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), { timeout: 2000 });
    const log = await page.evaluate(() => window.__adsLog);
    const req = log.find((e) => e.ev === 'requestAds');
    ok(req?.adTagUrl?.startsWith('https://example.com/vast/preroll-fallback'), `pbjs yokken normal fallback VAST kullanıldı (${req?.adTagUrl?.slice(0, 50)})`);
    await page.close();
}

async function testPrebidSkippedOnRetry(browser) {
    console.log('\n[4] Prebid + retry: ilk denemede auction çalışıyor, RETRY\'de TEKRAR çalışmıyor mu?');
    const page = await openScenario(browser, 'prebid-retry', { withPbjs: true });
    await page.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), { timeout: 2000 });

    let pbjsLog = await page.evaluate(() => window.__pbjsLog);
    ok(pbjsLog.filter((e) => e.ev === 'requestBids').length === 1, 'install sırasında tam 1 kez requestBids çağrıldı');

    await page.evaluate(() => {
        const loader = window.__mockIma.adsLoaderInstances[0];
        loader.dispatch('adError', new window.google.ima.AdErrorEvent('mock-ad-error'));
    });
    await page.waitForFunction(() => window.__adsLog.filter((e) => e.ev === 'requestAds').length === 2, { timeout: 2000 });

    pbjsLog = await page.evaluate(() => window.__pbjsLog);
    ok(pbjsLog.filter((e) => e.ev === 'requestBids').length === 1, 'retry sonrası requestBids SAYISI DEĞİŞMEDİ (auction tekrar koşulmadı)');

    const log = await page.evaluate(() => window.__adsLog);
    const retryReq = log.filter((e) => e.ev === 'requestAds')[1];
    ok(retryReq?.adTagUrl?.startsWith('https://example.com/vast/preroll-fallback'), `retry isteği doğrudan fallback VAST (prebid URL değil) (${retryReq?.adTagUrl?.slice(0, 50)})`);
    ok(retryReq?.adTagUrl?.includes('adrefreshCount'), 'retry isteğinde adrefreshCount cust_params var');
    await page.close();
}

async function testConsentAwareOptIn(browser) {
    console.log('\n[5] consentAware:true + USP opt-out: setPrivacySettings({nonPersonalizedAds:true}) zorlanıyor mu?');
    const page2 = await browser.newPage();
    await page2.addInitScript(MOCK_IMA);
    await page2.addInitScript(() => {
        window.__uspapi = (cmd, ver, cb) => cb({ uspString: '1YYN' }, true);
    });
    await page2.goto(`${BASE}/?ads=consentaware`);
    await page2.waitForSelector('hope-player');
    await page2.waitForFunction(() => window.__adsLog?.some((e) => e.ev === 'setPrivacySettings'), { timeout: 2000 }).catch(() => {});
    const log = await page2.evaluate(() => window.__adsLog ?? []);
    ok(log.some((e) => e.ev === 'setPrivacySettings' && e.value?.nonPersonalizedAds === true), 'USP opt-out (1YYN) -> setPrivacySettings({nonPersonalizedAds:true}) çağrıldı');
    await page2.close();
}

async function testConsentAwareOffByDefault(browser) {
    console.log('\n[6] consentAware VERİLMEMİŞ (preroll senaryosu) + USP opt-out mevcut: setPrivacySettings çağrılMAMALI');
    const page = await browser.newPage();
    await page.addInitScript(MOCK_IMA);
    await page.addInitScript(() => {
        window.__uspapi = (cmd, ver, cb) => cb({ uspString: '1YYN' }, true);
    });
    await page.goto(`${BASE}/?ads=preroll`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    await page.waitForTimeout(300);
    const log = await page.evaluate(() => window.__adsLog ?? []);
    ok(!log.some((e) => e.ev === 'setPrivacySettings'), 'consentAware opt-in verilmemişken setPrivacySettings HİÇ çağrılmadı (USP mevcut olsa bile)');
    await page.close();
}

async function testPrebidChunkIsolation(browser) {
    console.log('\n[7] Plugin izolasyonu: prebid.enabled yokken (düz preroll) VideoPrebid chunk\'ı indirilmiyor mu?');
    const page = await browser.newPage();
    const prebidChunkRequests = [];
    page.on('request', (req) => { if (/VideoPrebid/.test(req.url())) prebidChunkRequests.push(req.url()); });
    await page.addInitScript(MOCK_IMA);
    await page.goto(`${BASE}/?ads=preroll`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    await page.waitForTimeout(300);
    ok(prebidChunkRequests.length === 0, `prebid kullanılmayan kurulumda VideoPrebid chunk'ı hiç indirilmedi (${JSON.stringify(prebidChunkRequests)})`);
    await page.close();

    console.log('\n[7b] Plugin izolasyonu: prebid.enabled=true iken VideoPrebid chunk\'ı indiriliyor mu?');
    const page2 = await browser.newPage();
    const prebidChunkRequests2 = [];
    page2.on('request', (req) => { if (/VideoPrebid/.test(req.url())) prebidChunkRequests2.push(req.url()); });
    await page2.addInitScript(MOCK_IMA);
    await page2.addInitScript(MOCK_PBJS);
    await page2.goto(`${BASE}/?ads=prebid`);
    await page2.waitForSelector('hope-player');
    await page2.waitForFunction(() => window.__adsLog.some((e) => e.ev === 'requestAds'), { timeout: 2000 });
    ok(prebidChunkRequests2.length > 0, `prebid.enabled=true iken VideoPrebid chunk'ı indirildi (${JSON.stringify(prebidChunkRequests2)})`);
    await page2.close();
}

(async () => {
    const browser = await chromium.launch();
    try {
        await testPrebidDirectVast(browser);
        await testPrebidGam(browser);
        await testPrebidGamCustParamsForwarded(browser);
        await testPrebidUnavailableFallsBack(browser);
        await testPrebidSkippedOnRetry(browser);
        await testConsentAwareOptIn(browser);
        await testConsentAwareOffByDefault(browser);
        await testPrebidChunkIsolation(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
