// HopeCorePlayer — i18n / hover tooltip doğrulama scripti.
// Kullanıcı isteği: tüm UI elementlerinde hover tooltip label OLMALI ve dil
// SET EDİLEBİLMELİ — bu seçim UI'nin tamamını (çekirdek kontroller + her
// plugin'in kendi chrome metni) VE reklam tarafını (IMA SDK'nın kendi
// ad-UI dili) etkilemeli. Ayrıca (ikinci bir istek üzerine) tarayıcının
// native `title` tooltip'i yerine YouTube tarzı, temaya uyumlu, kısayol
// "pill"li ÖZEL bir popup (`controls/Tooltip.ts`) kullanılıyor.
//
// Mimari: `packages/core/src/i18n/` — TEK, paylaşılan/mutable bir
// `HopeLocaleStrings` objesi (`HopePlayerElement.i18n`), her kontrol/plugin'e
// AYNI referans olarak geçiliyor. Dil değişince alanları yerinde güncelleniyor
// (referans sabit), bu yüzden reaktif render eden yerler (ayarlar menüsü,
// playlist/story panelleri) otomatik güncel metni okuyor; statik (bir kez
// set edilip tekrar render edilmeyen) `aria-label`'lar için her kontrolün/
// plugin'in kendi `refreshLabels()`'ı `HopePlayerElement.applyOptions()`'tan
// çağrılıyor. Tooltip popup'ı `title` DEĞİL bu `aria-label`'ı okuyor —
// `.title` KASITLI OLARAK hiçbir yerde set edilmiyor (iki tooltip'in üst
// üste binmesini önlemek için).
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

async function openScenario(browser, feature, { mockIma = false } = {}) {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    if (mockIma) {
        await page.addInitScript(() => {
            window.__imaSetLocaleCalls = [];
            class FakeAdDisplayContainer { initialize() {} }
            class FakeAdsLoader {
                addEventListener() {}
                requestAds() {}
                contentComplete() {}
            }
            window.google = {
                ima: {
                    AdDisplayContainer: FakeAdDisplayContainer,
                    AdsLoader: FakeAdsLoader,
                    AdsRenderingSettings: class {},
                    AdsRequest: class {},
                    ImaSdkSettings: { CompanionBackfillMode: {}, PpidMode: {} },
                    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: 'x' } },
                    AdErrorEvent: { Type: { AD_ERROR: 'y' } },
                    settings: {
                        setLocale: (loc) => window.__imaSetLocaleCalls.push(loc),
                        setPlayerType: () => {},
                        setPlayerVersion: () => {},
                        setDisableCustomPlaybackForIOS10Plus: () => {},
                        setPpidMode: () => {},
                    },
                    UiElements: {},
                    ViewMode: {},
                },
            };
        });
    }
    await page.goto(`${BASE}/${feature ? `?feature=${feature}` : ''}`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    return page;
}

async function testDefaultAriaLabelsExist(browser) {
    console.log('\n[1] Varsayılan (tr) temada ikon-only butonların GERÇEK bir etiketi (aria-label) var mı?');
    const page = await openScenario(browser, 'none');
    const labels = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        return {
            playPause: root.querySelector('[part="play-pause-button"]')?.getAttribute('aria-label'),
            volumeSlider: root.querySelector('[part="volume-slider"]')?.getAttribute('aria-label'),
            seekBar: root.querySelector('[part="seek-bar"]')?.getAttribute('aria-label'),
            pip: Array.from(root.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Resim içinde resim')?.getAttribute('aria-label'),
            fullscreen: Array.from(root.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Tam ekran')?.getAttribute('aria-label'),
            noNativeTitle: root.querySelector('[part="play-pause-button"]')?.title === '',
        };
    });
    ok(labels.playPause === 'Oynat', `play/pause aria-label = "${labels.playPause}"`);
    ok(labels.volumeSlider === 'Ses seviyesi', `volume slider aria-label = "${labels.volumeSlider}"`);
    ok(labels.seekBar === 'Video konumu', `seek bar aria-label = "${labels.seekBar}" (yine de GÖRSEL tooltip'i yok — bkz. senaryo 6)`);
    ok(labels.pip === 'Resim içinde resim', `PIP aria-label = "${labels.pip}"`);
    ok(labels.fullscreen === 'Tam ekran', `fullscreen aria-label = "${labels.fullscreen}"`);
    ok(labels.noNativeTitle, 'native `title` KASITLI set edilmemiş (özel tooltip onun yerine geçiyor)');
    await page.close();
}

async function testLocaleSwitchUpdatesCoreLive(browser) {
    console.log('\n[2] `locale` attribute\'u sonradan değişince çekirdek kontrollerin etiketleri CANLI güncelleniyor mu?');
    const page = await openScenario(browser, 'none');
    await page.evaluate(() => document.getElementById('player').setAttribute('locale', 'en'));
    await page.waitForTimeout(100);
    const labels = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        return {
            playPause: root.querySelector('[part="play-pause-button"]')?.getAttribute('aria-label'),
            seekBar: root.querySelector('[part="seek-bar"]')?.getAttribute('aria-label'),
            pip: Array.from(root.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Picture-in-picture')?.getAttribute('aria-label'),
        };
    });
    ok(labels.playPause === 'Play', `locale="en" sonrası play/pause aria-label = "${labels.playPause}"`);
    ok(labels.seekBar === 'Seek', `locale="en" sonrası seek bar aria-label = "${labels.seekBar}"`);
    ok(labels.pip === 'Picture-in-picture', `locale="en" sonrası PIP aria-label = "${labels.pip}"`);
    await page.close();
}

async function testLabelsOverrideWinsOverLocale(browser) {
    console.log('\n[3] `.options.labels` ile verilen kısmi override, locale varsayılanını geçersiz kılıyor mu?');
    const page = await openScenario(browser, 'none');
    await page.evaluate(() => {
        document.getElementById('player').options = { locale: 'en', labels: { play: 'GO' } };
    });
    await page.waitForTimeout(100);
    const playLabel = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"]').getAttribute('aria-label'));
    const pauseFallsBackToEn = await page.evaluate(() => {
        document.getElementById('player').shadowRoot.querySelector('video').play();
        return new Promise((resolve) => setTimeout(() => resolve(document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"]').getAttribute('aria-label')), 100));
    });
    ok(playLabel === 'GO', `override edilen "play" alanı kazandı (aria-label="${playLabel}")`);
    ok(pauseFallsBackToEn === 'Pause', `override EDİLMEYEN "pause" alanı locale (en) varsayılanına düştü (aria-label="${pauseFallsBackToEn}")`);
    await page.close();
}

async function testPluginLabelsFollowLocaleToo(browser) {
    console.log('\n[4] Plugin chrome\'u (loop-section butonu) da dil değişimini takip ediyor mu?');
    const page = await openScenario(browser, 'loop');
    const before = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Döngü"]')?.getAttribute('aria-label'));
    ok(before === 'Döngü', `varsayılan (tr) loop butonu aria-label = "${before}"`);

    await page.evaluate(() => document.getElementById('player').setAttribute('locale', 'en'));
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Loop"]')?.getAttribute('aria-label'));
    ok(after === 'Loop', `locale="en" sonrası loop butonu aria-label = "${after}"`);
    await page.close();
}

async function testAdsLocaleFollowsPlayerLocale(browser) {
    console.log('\n[5] Reklamlar: IMA SDK\'nın KENDİ ad-UI dili (skip/sayaç metni) de oynatıcının locale\'ini takip ediyor mu?');
    const page = await openScenario(browser, 'none', { mockIma: true });
    await page.evaluate(() => {
        document.getElementById('player').options = {
            src: '/sample.mp4',
            locale: 'en',
            ads: { adTagPreroll: 'https://example.com/vast/preroll' },
        };
    });
    await page.waitForTimeout(400);
    const calls = await page.evaluate(() => window.__imaSetLocaleCalls);
    ok(calls.includes('en'), `ima.settings.setLocale() oynatıcının locale'iyle ("en") çağrıldı — calls: ${JSON.stringify(calls)}`);
    await page.close();
}

async function hoverAndReadTooltip(page, selector, waitMs = 650) {
    const h = await page.evaluateHandle((sel) => document.getElementById('player').shadowRoot.querySelector(sel), selector);
    const box = await h.asElement().boundingBox();
    await page.mouse.move(10, 10);
    await page.waitForTimeout(80);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(waitMs);
    return page.evaluate(() => {
        const tt = document.getElementById('player').shadowRoot.querySelector('[part="tooltip"]');
        const spans = tt.querySelectorAll('span');
        return {
            visible: tt.style.visibility === 'visible',
            label: spans[0]?.textContent,
            key: spans[1]?.textContent,
            keyHidden: spans[1]?.style.display === 'none',
        };
    });
}

async function testCustomTooltipPopup(browser) {
    console.log('\n[6] Özel tooltip popup\'ı (YouTube tarzı, tema ile uyumlu, kısayol "pill"li) doğru çalışıyor mu?');
    const page = await openScenario(browser, 'none');

    const fs = await hoverAndReadTooltip(page, '[aria-label="Tam ekran"]');
    ok(fs.visible && fs.label === 'Tam ekran' && fs.key === 'F', `fullscreen → "${fs.label}" + kısayol pill "${fs.key}"`);

    const settings = await hoverAndReadTooltip(page, '[aria-label="Ayarlar"]');
    ok(settings.visible && settings.keyHidden, `ayarlar → tooltip var ama kısayolu olmadığı için pill YOK (keyHidden=${settings.keyHidden})`);

    const vol = await hoverAndReadTooltip(page, '[part="volume-button"]');
    ok(vol.key === 'M', `ses butonu kısayol pill'i = "${vol.key}"`);

    // Seek bar: kullanıcı isteği üzerine BİLEREK hariç tutuldu (sürekli üzerinde gezinilen bir kontrol).
    await page.mouse.move(10, 10);
    await page.waitForTimeout(80);
    const seekBarBox = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]'));
    const sbBox = await seekBarBox.asElement().boundingBox();
    await page.mouse.move(sbBox.x + sbBox.width / 2, sbBox.y + sbBox.height / 2);
    await page.waitForTimeout(650);
    const seekVisible = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="tooltip"]').style.visibility === 'visible');
    ok(!seekVisible, 'seek bar hover\'ında tooltip BİLEREK görünmüyor (kullanıcı isteği)');

    // Fare tamamen ayrılınca gizlenir.
    await page.mouse.move(10, 10);
    await page.waitForTimeout(250);
    const hiddenAfterLeave = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="tooltip"]').style.visibility === 'hidden');
    ok(hiddenAfterLeave, 'fare ayrılınca tooltip gizleniyor');

    // KRİTİK REGRESYON (gerçek kullanıcı bug'ı): butonun üstüne gelip
    // gösterim gecikmesi (450ms) DOLMADAN çıkınca, bekleyen show timer'ı
    // iptal edilmiyordu — tooltip fare çoktan çıkmışken açılıp öyle kalıyordu.
    const quick = await hoverAndReadTooltip(page, '[aria-label="Ayarlar"]', 200);
    ok(!quick.visible, `gecikme dolmadan (200ms) henüz görünmüyor (visible=${quick.visible})`);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(700);
    const stuck = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="tooltip"]').style.visibility === 'visible');
    ok(!stuck, 'gecikme dolmadan çıkılınca tooltip SONRADAN açılıp takılı KALMIYOR');

    // Tooltip içeriği de locale/labels'ı takip ediyor (aria-label'ı canlı okuyor).
    await page.evaluate(() => document.getElementById('player').setAttribute('locale', 'en'));
    await page.waitForTimeout(100);
    const en = await hoverAndReadTooltip(page, '[part="play-pause-button"]');
    ok(en.label === 'Play' && en.key === 'K', `locale="en" sonrası tooltip = "${en.label}" + "${en.key}"`);

    await page.close();
}

(async () => {
    const browser = await chromium.launch();
    try {
        await testDefaultAriaLabelsExist(browser);
        await testLocaleSwitchUpdatesCoreLive(browser);
        await testLabelsOverrideWinsOverLocale(browser);
        await testPluginLabelsFollowLocaleToo(browser);
        await testAdsLocaleFollowsPlayerLocale(browser);
        await testCustomTooltipPopup(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
