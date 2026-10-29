// HopeCorePlayer — Faz 4 (playlist/story/sticky/in-view-autoplay/loop-section/
// gesture) Playwright doğrulama scripti. Bu plugin'lerin hiçbiri gerçek bir
// ağ SDK'sına bağımlı değil (yalnızca IntersectionObserver/pointer/scroll gibi
// gerçek tarayıcı API'leri), bu yüzden ads/prebid testlerinin aksine mock
// gerektirmiyor — gerçek DOM etkileşimleri ve gerçek scroll ile sürülüyor.
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

async function openFeature(browser, feature, { extraHtml = '' } = {}) {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    await page.goto(`${BASE}/?feature=${feature}`);
    if (extraHtml) {
        await page.evaluate((html) => {
            const spacerTop = document.createElement('div');
            spacerTop.id = 'spacer-top';
            spacerTop.style.height = '1200px';
            document.body.insertBefore(spacerTop, document.body.firstChild);
            const spacerBottom = document.createElement('div');
            spacerBottom.id = 'spacer-bottom';
            spacerBottom.style.height = '1200px';
            document.body.appendChild(spacerBottom);
        }, extraHtml);
    }
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    if (consoleErrors.length) console.log('  console errors:', consoleErrors);
    return page;
}

async function collectChunkUrls(browser, feature) {
    const page = await browser.newPage();
    const urls = new Set();
    page.on('request', (req) => { if (/\/chunks\//.test(req.url())) urls.add(req.url()); });
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
    console.log('\n[1] Plugin izolasyonu: her Faz 4 plugin\'i yalnızca kendi feature\'ı açıkken yeni chunk indiriyor mu?');
    const baseline = await collectChunkUrls(browser, null);
    for (const feature of ['gesture', 'loop', 'inview', 'sticky', 'playlist', 'story']) {
        const withFeature = await collectChunkUrls(browser, feature);
        const newChunks = [...withFeature].filter((u) => !baseline.has(u));
        ok(newChunks.length > 0, `?feature=${feature} → en az 1 yeni chunk (${newChunks.length})`);
    }
}

async function testGesture(browser) {
    console.log('\n[2] Gesture: basılı tutma → playbackRate değişiyor, bırakınca 1\'e dönüyor mu?');
    const page = await openFeature(browser, 'gesture');
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForTimeout(100);

    const video = page.locator('hope-player').first();
    const box = await video.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // holdDelayMs=50 (demo config) sonra hold başlar.
    await page.waitForTimeout(250);
    const rateDuringHold = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').playbackRate);
    await page.mouse.up();
    await page.waitForTimeout(50);
    const rateAfterRelease = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').playbackRate);

    ok(rateDuringHold === 2, `basılı tutarken playbackRate=2 (${rateDuringHold})`);
    ok(rateAfterRelease === 1, `bırakınca playbackRate 1'e döndü (${rateAfterRelease})`);
    await page.close();
}



async function testTapToTogglePlayPause(browser) {
    console.log('\n[2b] "Ekrana tıkla → oynat/duraklat" (YouTube tarzı): gesture plugin\'siz çalışıyor mu, gesture AÇIKKEN bir hold ile çakışmıyor mu?');

    // gesture plugin KURULU DEĞİLKEN de temel toggle çalışmalı — bu davranış
    // artık core'un kendisinde (HopePlayerElement), bir plugin'e bağlı değil.
    {
        const page = await openFeature(browser, 'none');
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
        await page.waitForTimeout(100);
        const box = await page.locator('hope-player').first().boundingBox();
        const click = () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

        await click();
        await page.waitForTimeout(100);
        const pausedAfterClick = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(pausedAfterClick === true, `plugin'siz: oynarken videoya tıklayınca duraklatıldı (${pausedAfterClick})`);

        await click();
        await page.waitForTimeout(100);
        const playingAfterSecondClick = await page.evaluate(() => !document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(playingAfterSecondClick === true, `plugin'siz: tekrar tıklayınca (center button üzerinden) devam etti (${playingAfterSecondClick})`);
        await page.close();
    }

    // gesture plugin KURULUYKEN: kısa tık hâlâ toggle yapmalı (tek doğruluk
    // kaynağı artık core'da — GestureControls kendi toggle'ını kaldırdı), AMA
    // bir HOLD sırasında/sonrasında ASLA ek bir toggle TETİKLENMEMELİ — bu,
    // basılı tutma (sar/hızlandır) ile çakışmaması gereken asıl senaryo.
    {
        const page = await openFeature(browser, 'gesture');
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
        await page.waitForTimeout(100);
        const box = await page.locator('hope-player').first().boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        await page.mouse.click(cx, cy);
        await page.waitForTimeout(100);
        const pausedAfterShortClick = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(pausedAfterShortClick === true, `gesture AÇIKKEN: kısa tık hâlâ duraklatıyor (çifte tetiklenme/titreme yok) (${pausedAfterShortClick})`);
        await page.mouse.click(cx, cy); // resume
        await page.waitForTimeout(100);

        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.waitForTimeout(250); // holdDelayMs=50 (demo config) aşılır
        const pausedWhileHolding = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(pausedWhileHolding === false, `gesture AÇIKKEN: basılı tutarken video DURAKLAMIYOR (${pausedWhileHolding})`);
        await page.mouse.up();
        await page.waitForTimeout(100);
        const pausedAfterHoldRelease = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(pausedAfterHoldRelease === false, `gesture AÇIKKEN: hold bırakılınca ek bir toggle tetiklenmedi, oynatma devam ediyor (${pausedAfterHoldRelease})`);
        await page.close();
    }

    // Kontrol çubuğu butonları (videoEl'in DIŞINDA, ayrı bir element) bu
    // dinleyiciyi hiç tetiklememeli — tek bir tıklama tek bir toggle yapmalı.
    {
        const page = await openFeature(browser, 'none');
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
        await page.waitForTimeout(100);
        const btn = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[part="play-pause-button"]'));
        const box = await btn.asElement().boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(100);
        const paused = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(paused === true, `kontrol çubuğu play/pause butonu tek bir toggle yapıyor, videoEl'deki dinleyiciyle çakışmıyor (${paused})`);
        await page.close();
    }
}

async function testVolumePanel(browser) {
    console.log('\n[2c] VolumePanel: butondan panele hover geçişi kaybolmuyor mu (gerçek bug), scroll ile ses ayarlanıyor mu?');
    const page = await openFeature(browser, 'none');

    const btnHandle = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[part="volume-button"]'));
    const sliderHandle = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[part="volume-slider"]'));
    const btnBox = await btnHandle.asElement().boundingBox();
    const sliderOpacity = () =>
        page.evaluate(() => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="volume-slider"]')).opacity);

    // GERÇEK BUG (bulundu): eskiden butonla panel arasında 8px'lik gerçek bir
    // boşluk vardı (`mb-2`) — :hover/group-hover bu boşlukta kopuyor, panel
    // tam fareye ulaşmadan kayboluyordu. Şimdi sıfır boşluk + kısa bir JS
    // debounce var; fare butondan panele doğru YAVAŞÇA (çoklu ara adımla)
    // hareket ederken panel HİÇ kapanmamalı.
    await page.mouse.move(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
    await page.waitForTimeout(200);
    const sliderBox = await sliderHandle.asElement().boundingBox();
    let everClosedDuringTransition = false;
    for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const x = btnBox.x + btnBox.width / 2;
        const y = btnBox.y + btnBox.height / 2 - t * (btnBox.height / 2 + sliderBox.height / 2);
        await page.mouse.move(x, y, { steps: 1 });
        await page.waitForTimeout(15);
        if ((await sliderOpacity()) !== '1') everClosedDuringTransition = true;
    }
    ok(!everClosedDuringTransition, 'butondan panele hareket ederken panel hiç kapanmadı (hover-gap bug\'ı yok)');

    // Fare tamamen ayrılınca (debounce süresi sonunda) kapanmalı.
    await page.mouse.move(10, 10);
    await page.waitForTimeout(400);
    ok((await sliderOpacity()) === '0', 'fare tamamen ayrılınca (debounce sonrası) panel kapandı');

    // Scroll wheel (butonun/panelin üzerindeyken) ses seviyesini ayarlıyor mu?
    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        v.volume = 0.5;
        v.muted = false;
    });
    await page.mouse.move(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
    await page.waitForTimeout(150);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(150);
    const volAfterUp = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').volume);
    ok(volAfterUp > 0.5, `scroll yukarı → ses arttı (${volAfterUp.toFixed(2)})`);

    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 100);
    await page.waitForTimeout(150);
    const mutedAtZero = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').muted);
    ok(mutedAtZero === true, 'scroll ile sesi tamamen kısınca otomatik mute oldu');

    await page.close();
}



async function testAutoHide(browser) {
    console.log('\n[2d] Auto-hide: fare ayrılınca kontrol çubuğunun kaybolma süresi `options.autoHideDelayMs` ile özelleştirilebiliyor mu?');

    // Özel (150ms) senaryo — istek üzerine eklendi: "bu da ayara bağlanabilir,
    // options'tan set edilebilmeli".
    const pageFast = await openFeature(browser, 'autohide-fast');
    const chromeOpacity = (page) =>
        page.evaluate(() => {
            const controlBar = document.getElementById('player').shadowRoot.querySelector('[part="control-bar"]');
            return getComputedStyle(controlBar.parentElement).opacity;
        });

    await pageFast.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await pageFast.mouse.move(400, 300);
    await pageFast.waitForTimeout(100);
    ok((await chromeOpacity(pageFast)) === '1', 'fare player üzerindeyken kontrol çubuğu görünür');

    await pageFast.mouse.move(10, 500); // player'dan tamamen ayrıl
    await pageFast.waitForTimeout(150); // 400ms'den AZ — hâlâ görünür kalmalı
    ok((await chromeOpacity(pageFast)) === '1', '400ms dolmadan hâlâ görünür');

    await pageFast.waitForTimeout(400); // toplam ~550ms — 400ms'yi geçti, gizlenmiş olmalı
    ok((await chromeOpacity(pageFast)) === '0', 'özel 400ms süresi dolunca kontrol çubuğu gizlendi');
    await pageFast.close();

    // Varsayılan senaryo — istek üzerine 2500ms'den kısaltıldı (bkz.
    // HopePlayerElement.ts DEFAULT_AUTO_HIDE_DELAY_MS), ama hâlâ makul bir
    // süre: 150ms'de HENÜZ gizlenmemiş, ~1.3sn'de gizlenmiş olmalı.
    const pageDefault = await openFeature(browser, 'none');
    await pageDefault.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await pageDefault.mouse.move(400, 300);
    await pageDefault.waitForTimeout(100);
    await pageDefault.mouse.move(10, 500);
    await pageDefault.waitForTimeout(150);
    ok((await chromeOpacity(pageDefault)) === '1', 'varsayılan süre 150ms\'de henüz dolmadı, hâlâ görünür');
    await pageDefault.waitForTimeout(1200);
    ok((await chromeOpacity(pageDefault)) === '0', 'varsayılan süre (~1.3sn) dolunca kontrol çubuğu gizlendi');
    await pageDefault.close();
}

async function testLoopSection(browser) {
    console.log('\n[3] LoopSection: toggle → aktif + marker ekleniyor, tekrar toggle → kapanıyor mu?');
    const page = await openFeature(browser, 'loop');
    await page.evaluate(async () => {
        const video = document.getElementById('player').shadowRoot.querySelector('video');
        await video.play();
        video.currentTime = 20;
        await new Promise((r) => setTimeout(r, 150));
    });

    const loopBtn = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Döngü"]'));
    await loopBtn.asElement().click();
    await page.waitForTimeout(50);

    const state1 = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const seekBar = root.querySelector('[part="seek-bar"]');
        return {
            btnActive: root.querySelector('[aria-label="Döngü"]').className.includes('text-accent'),
            markerCount: seekBar.querySelectorAll(':scope > div').length - 1, // track hariç
        };
    });
    ok(state1.btnActive, 'toggle sonrası buton aktif (hp:text-accent) sınıfını aldı');
    ok(state1.markerCount >= 2, `seek bar'da en az 2 marker eklendi (${state1.markerCount})`);

    await loopBtn.asElement().click();
    await page.waitForTimeout(50);
    const state2 = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        return root.querySelector('[aria-label="Döngü"]').className.includes('text-accent');
    });
    ok(!state2, 'tekrar toggle → buton pasif, döngü kapandı');
    await page.close();
}



async function testInViewAutoplay(browser) {
    console.log('\n[4] InViewAutoplay: viewport dışına çıkınca duraklatıyor, geri girince (yalnızca kendi duraklattıysa) devam ettiriyor mu?');
    const page = await openFeature(browser, 'inview', { extraHtml: true });

    // Önce viewport'a getir (IntersectionObserver inView=true kaydetsin), SONRA play.
    await page.evaluate(() => document.getElementById('player').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeout: 2000 });

    await page.evaluate(() => window.scrollTo(0, 0)); // player artık 1200px aşağıda → viewport dışı
    await page.waitForTimeout(600);
    const pausedWhenOut = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(pausedWhenOut === true, 'viewport dışına çıkınca otomatik duraklatıldı');

    await page.evaluate(() => document.getElementById('player').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    const playingWhenBack = await page.evaluate(() => !document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(playingWhenBack === true, 'viewport\'a geri girince (bu plugin duraklattığı için) devam etti');
    await page.close();
}



async function testSticky(browser) {
    console.log('\n[5] Sticky: oynatırken viewport dışına çıkınca köşeye sabitleniyor (data-sticky), geri girince kapanıyor mu?');
    const page = await openFeature(browser, 'sticky', { extraHtml: true });
    // Önce viewport'a getir (hasEverBeenInView/WhilePlaying kaydolsun), SONRA
    // user-gesture + play — aksi halde "hiç viewport'ta oynatılmadı" guard'ı
    // sticky'ye hiç izin vermez.
    await page.evaluate(() => document.getElementById('player').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await page.mouse.move(400, 300); // ilk gesture: "user etkileşimi" penceresi için
    await page.mouse.down();
    await page.mouse.up();
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeout: 2000 });
    // minPlayMs:0 (demo config) → hemen sticky olabilir.
    await page.waitForTimeout(400);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    const sticky1 = await page.evaluate(() => document.getElementById('player').hasAttribute('data-sticky'));
    ok(sticky1 === true, 'viewport dışına çıkınca data-sticky eklendi');

    const logText1 = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
    ok(logText1.includes('sticky:true'), `hp:sticky(true) event'i yayıldı (log: "${logText1.slice(-60)}")`);

    // GERÇEK BUG (bulundu — "sticky-close-button görünmüyor"): kapat butonu
    // eskiden `wrapperEl`'e (host'un KENDİSİ) ekleniyordu — host'un shadow
    // root'unda hiç `<slot>` olmadığından light DOM child'ları flat tree'ye
    // hiç girmiyor, tamamen GÖRÜNMEZ oluyordu (z-index/CSS sorunu değil).
    // Şimdi `.video-area`'ya (shadow root İÇİNDE) ekleniyor — hem DOM'da
    // bulunmalı HEM DE gerçekten render edilen (sıfır olmayan) bir kutusu
    // olmalı.
    const closeBtnBox = await page.evaluate(() => {
        const btn = document.getElementById('player').shadowRoot.querySelector('[part="sticky-close-button"]');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { width: r.width, height: r.height };
    });
    ok(closeBtnBox !== null, 'kapat butonu shadow root İÇİNDE (görünür ağaçta) bulundu');
    ok(!!closeBtnBox && closeBtnBox.width > 0 && closeBtnBox.height > 0, `kapat butonu GERÇEKTEN render ediliyor, sıfır boyutlu değil (${JSON.stringify(closeBtnBox)})`);

    // DİKKAT: stuck haldeyken player position:fixed — document.getElementById('player').scrollIntoView()
    // bu durumda NO-OP'tur (fixed element zaten "viewport'ta" sayılır, sayfa
    // kaymaz). Gerçek test, StickyManager'ın izlediği SENTINEL'in (player'ın
    // DOĞAL doküman-akışı konumunda duran görünmez işaretçi) tekrar viewport'a
    // girmesini sağlayacak şekilde sayfayı KENDİSİ kaydırmak — spacer-top
    // 1200px olduğundan oraya yakın bir scrollY bunu sağlar.
    await page.evaluate(() => window.scrollTo(0, 1100));
    await page.waitForTimeout(600);
    const sticky2 = await page.evaluate(() => document.getElementById('player').hasAttribute('data-sticky'));
    ok(sticky2 === false, 'sentinel viewport\'a geri girince data-sticky kaldırıldı (back_in_view)');
    await page.close();
}



async function testStickyWithAutoplayRace(browser) {
    console.log('\n[5b] GERÇEK BUG (bulundu — "ekrana giriyorum, bekliyorum, scroll ediyorum, sticky olmuyor"): `autoplay` ile StickyManager\'ın (dinamik import edilen) \'play\' dinleyicisi takılmadan video ZATEN oynamaya başlıyorsa sticky hâlâ tetikleniyor mu?');
    const page = await openFeature(browser, 'sticky-autoplay', { extraHtml: true });
    // KASITLI OLARAK video.play() ÇAĞRILMIYOR — `autoplay` attribute'u kendi
    // başına oynatıyor, StickyManager'ın plugin'i dinamik import edip 'play'
    // dinleyicisini bağlamasından ÇOK ÖNCE (gerçek bug buydu: native 'play'
    // event'i yalnızca BİR KEZ ateşlenir, geç bağlanan dinleyici onu kaçırır).
    await page.evaluate(() => document.getElementById('player').scrollIntoView({ block: 'center' }));
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeout: 2000 });
    // Gerçek kullanıcı akışı: "2-3 saniye bekliyorum" — StickyManager'ın
    // plugin chunk'ını indirip register() çağırmasına bolca zaman tanıyor.
    await page.waitForTimeout(1000);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    const sticky1 = await page.evaluate(() => document.getElementById('player').hasAttribute('data-sticky'));
    ok(sticky1 === true, `autoplay ile ZATEN oynarken (gerçek 'play' event'i register()'dan ÖNCE ateşlenmiş olsa bile) viewport dışına çıkınca sticky tetiklendi (data-sticky=${sticky1})`);
    await page.close();
}



async function testPlaylist(browser) {
    console.log('\n[6] PlaylistRunner: next/prev/tıkla-seç + loop wraparound + hp:itemchange');
    const page = await openFeature(browser, 'playlist');
    await page.waitForFunction(() => {
        const log = document.getElementById('log')?.textContent ?? '';
        return log.includes('itemchange:playlist:0');
    }, { timeout: 2000 });

    const nextBtn = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Sonraki"]'));
    await nextBtn.asElement().click();
    await page.waitForFunction(() => (document.getElementById('log')?.textContent ?? '').includes('itemchange:playlist:1'), { timeout: 2000 });

    const activeTitle1 = await page.evaluate(() => {
        const active = document.getElementById('player').shadowRoot.querySelector('li[data-active="true"]');
        return active?.textContent ?? '';
    });
    ok(activeTitle1.includes('Video 2'), `next() sonrası aktif item "Video 2" (${activeTitle1.trim().slice(0, 30)})`);

    // loop wraparound: index 1 -> 2 -> next() -> 0 (loop:true demo config)
    await nextBtn.asElement().click();
    await page.waitForFunction(() => (document.getElementById('log')?.textContent ?? '').includes('itemchange:playlist:2'), { timeout: 2000 });
    await nextBtn.asElement().click();
    await page.waitForFunction(() => (document.getElementById('log')?.textContent ?? '').includes('itemchange:playlist:0'), { timeout: 2000 });

    const logText = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
    const changeCount = (logText.match(/itemchange:playlist/g) || []).length;
    ok(changeCount === 4, `tam 4 itemchange (0 start, 1, 2, loop→0) (${changeCount})`);

    // tıkla-seç: 3. item'a tıkla
    const items = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelectorAll('[part="playlist-panel"] li'));
    const itemsArr = await items.getProperties();
    const thirdLi = itemsArr.get('2');
    await thirdLi.asElement().click();
    await page.waitForFunction(() => {
        const active = document.getElementById('player').shadowRoot.querySelector('li[data-active="true"]');
        return active?.textContent?.includes('Video 3');
    }, { timeout: 2000 });
    ok(true, 'listeden tıklayarak "Video 3" seçildi');
    await page.close();
}



async function testStory(browser) {
    console.log('\n[7] HopeStory: aşağı/yukarı nav butonları + loop wraparound + hp:itemchange');
    const page = await openFeature(browser, 'story');
    await page.waitForFunction(() => (document.getElementById('log')?.textContent ?? '').includes('itemchange:story:0'), { timeout: 2000 });

    const downBtn = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Sonraki video"]'));
    await downBtn.asElement().click();
    await page.waitForFunction(() => (document.getElementById('log')?.textContent ?? '').includes('itemchange:story:1'), { timeout: 2000 });

    const counter1 = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        return root.querySelector('[part="story-counter"]')?.textContent ?? '';
    });
    ok(counter1.trim() === '2 / 3', `downBtn sonrası sayaç "2 / 3" (${counter1})`);

    const upBtn = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Önceki video"]'));
    await upBtn.asElement().click();
    await page.waitForFunction(() => (document.getElementById('log')?.textContent ?? '').includes('itemchange:story:0'), { timeout: 2000 });
    // goTo()'nun switching guard'ı itemchange'den SONRA (loadItem() tamamen
    // bitene kadar) true kalıyor — hemen ikinci bir nav göndermek bu guard'a
    // takılıp sessizce yok sayılabilir, bu yüzden bir sonraki click'ten önce
    // kısa bir yerleşme süresi bırakıyoruz.
    await page.waitForTimeout(300);

    // loop wraparound: index 0'dan prev() -> son item'a (loop:true demo config)
    await upBtn.asElement().click();
    await page.waitForFunction(() => (document.getElementById('log')?.textContent ?? '').includes('itemchange:story:2'), { timeout: 2000 });
    ok(true, 'index 0\'dan prev() → loop ile son item\'a (index 2) geçti');
    await page.close();
}

async function testTimeDisplayToggle(browser) {
    console.log('\n[12] Zaman göstergesi toggle: tıklandığında geçen süre (0:05 / 0:15) ile kalan süre (-0:10 / 0:15) arasında geçiş yapıyor mu?');
    const page = await openFeature(browser, 'none');
    await page.evaluate(() => {
        const video = document.getElementById('player').shadowRoot.querySelector('video');
        video.currentTime = 5;
    });
    await page.waitForTimeout(150);

    const getTimeText = () =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const timeEl = root.querySelector('[part="time-display"]');
            return timeEl ? timeEl.textContent?.trim() : null;
        });

    const initialText = await getTimeText();
    ok(initialText === '0:05 / 0:15', `başlangıçta geçen süre gösteriliyor: "${initialText}"`);

    // Tıkla -> kalan süreye (-0:10 / 0:15) geçmeli
    await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const timeEl = root.querySelector('[part="time-display"]');
        timeEl.click();
    });
    await page.waitForTimeout(50);
    const remainingText = await getTimeText();
    ok(remainingText === '-0:10 / 0:15', `tıklanınca kalan süreye geçti: "${remainingText}"`);

    // Tekrar tıkla -> geçen süreye (0:05 / 0:15) dönmeli
    await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const timeEl = root.querySelector('[part="time-display"]');
        timeEl.click();
    });
    await page.waitForTimeout(50);
    const backText = await getTimeText();
    ok(backText === '0:05 / 0:15', `tekrar tıklanınca geçen süreye döndü: "${backText}"`);

    // options / showRemainingTime API testi
    await page.evaluate(() => {
        const player = document.getElementById('player');
        player.showRemainingTime = true;
    });
    await page.waitForTimeout(50);
    const apiText = await getTimeText();
    ok(apiText === '-0:10 / 0:15', `player.showRemainingTime = true ile kalan süre gösteriliyor: "${apiText}"`);

    // Tutarlılık: 5.9 sn'de de geçen (0:05) + kalan toplamı görünen süreyi (0:15) tutmalı.
    await page.evaluate(() => { document.getElementById('player').shadowRoot.querySelector('video').currentTime = 5.9; });
    await page.waitForTimeout(150);
    const at59 = await getTimeText();
    ok(at59 === '-0:10 / 0:15', `5.9 sn'de kalan "-0:10" (0:05 + 0:10 = 0:15 tutarlı): "${at59}"`);

    // Klavye: süre butonu odaktayken Space butonu çalıştırmalı (oynat/durdur DEĞİL).
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="time-display"]').focus());
    const pausedBefore = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    const afterSpace = await page.evaluate(() => ({ text: document.getElementById('player').shadowRoot.querySelector('[part="time-display"]').textContent.trim(), paused: document.getElementById('player').shadowRoot.querySelector('video').paused }));
    ok(afterSpace.text === '0:05 / 0:15' && afterSpace.paused === pausedBefore, `odakta Space süre modunu değiştirdi, videoyu oynatmadı ("${afterSpace.text}", paused=${afterSpace.paused})`);

    // Kullanıcının seçimi başka bir option güncellemesiyle sıfırlanmamalı.
    await page.evaluate(() => { document.getElementById('player').options = { src: '/sample.mp4', showRemainingTime: false }; });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="time-display"]').click());
    await page.evaluate(() => { document.getElementById('player').options = { src: '/sample.mp4', showRemainingTime: false, muted: true }; });
    await page.waitForTimeout(200);
    const kept = await getTimeText();
    ok(kept?.startsWith('-'), `başka bir option değişince kullanıcının seçtiği kalan süre modu korundu: "${kept}"`);

    await page.close();
}



async function testSkipButtons(browser) {
    console.log('\n[13] İstek üzerine: geri/ileri sarma butonları (options ile süre, tek buton) + klavye sarma adımı (keyboardSeekStep)');
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    try {
        await page.goto(`${BASE}/`);
        await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
        const setOptions = async (extra) => {
            await page.evaluate((extra) => { document.getElementById('player').options = { src: '/sample.mp4', muted: true, ...extra }; }, extra);
            await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1);
            await page.waitForTimeout(150);
        };
        const buttons = () =>
            page.evaluate(() => {
                const root = document.getElementById('player').shadowRoot;
                const info = (part) => {
                    const b = root.querySelector(`[part="${part}"]`);
                    if (!b || getComputedStyle(b).display === 'none') return null;
                    return { label: b.getAttribute('aria-label'), num: b.querySelector('.hp-skip-num').textContent, long: b.querySelector('.hp-skip-num').hasAttribute('data-long') };
                };
                return { back: info('skip-back-button'), forward: info('skip-forward-button') };
            });
        const seekTo = (t) => page.evaluate(async (t) => { const v = document.getElementById('player').shadowRoot.querySelector('video'); v.currentTime = t; await new Promise((r) => setTimeout(r, 100)); }, t);
        const click = (part) => page.evaluate(async (part) => { document.getElementById('player').shadowRoot.querySelector(`[part="${part}"]`).click(); await new Promise((r) => setTimeout(r, 100)); }, part);
        const time = () => page.evaluate(() => Math.round(document.getElementById('player').shadowRoot.querySelector('video').currentTime * 10) / 10);

        await setOptions({});
        let b = await buttons();
        ok(b.back === null && b.forward === null, 'varsayılanda sarma butonu yok');

        await setOptions({ skipButtons: true });
        b = await buttons();
        ok(b.back?.num === '10' && b.forward?.num === '10' && b.back.label === '10 saniye geri' && b.forward.label === '10 saniye ileri', `skipButtons: true → 10 sn geri/ileri ${JSON.stringify(b)}`);
        await seekTo(2);
        await click('skip-forward-button');
        ok((await time()) === 12, `ileri: 2 → ${await time()}`);
        await click('skip-back-button');
        ok((await time()) === 2, `geri: 12 → ${await time()}`);
        await click('skip-back-button');
        ok((await time()) === 0, `başta geri sarma 0'ın altına inmiyor (${await time()})`);
        await seekTo(10);
        await click('skip-forward-button');
        const dur = await page.evaluate(() => Math.round(document.getElementById('player').shadowRoot.querySelector('video').duration * 10) / 10);
        ok((await time()) === dur, `sonda ileri sarma süreyi aşmıyor (${await time()} / ${dur})`);

        await setOptions({ skipButtons: { back: false, forward: 30 } });
        b = await buttons();
        ok(b.back === null && b.forward?.num === '30' && b.forward.label === '30 saniye ileri', `yalnızca ileri butonu, 30 sn ${JSON.stringify(b)}`);

        await setOptions({ skipButtons: { back: 120 } });
        b = await buttons();
        ok(b.back?.num === '120' && b.back.long && b.forward?.num === '10', `3 haneli süre küçük yazılıyor, verilmeyen taraf varsayılan 10 ${JSON.stringify(b)}`);

        await setOptions({ skipButtons: false });
        b = await buttons();
        ok(b.back === null && b.forward === null, 'skipButtons: false → butonlar kalktı');

        // Klavye: varsayılan 5 sn, keyboardSeekStep ile değişir.
        const press = async (key) => {
            await page.evaluate(() => document.getElementById('player').focus());
            await page.keyboard.press(key);
            await page.waitForTimeout(100);
        };
        await seekTo(5);
        await press('ArrowRight');
        ok((await time()) === 10, `klavye varsayılan: → 5 sn ileri (5 → ${await time()})`);
        await setOptions({ keyboardSeekStep: 3 });
        await seekTo(6);
        await press('ArrowLeft');
        ok((await time()) === 3, `keyboardSeekStep: 3 → ← 3 sn geri (6 → ${await time()})`);
        await press('l');
        ok((await time()) === 6, `keyboardSeekStep: 3 → L 3 sn ileri (3 → ${await time()})`);
    } finally {
        await page.close();
    }
}

async function testSeekFeedback(browser) {
    console.log('\n[14] İstek üzerine: sarmada sağda/solda anlık bildirim, ard arda sarmalar toplanıyor');
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    try {
        await page.goto(`${BASE}/`);
        await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
        await page.evaluate(() => { document.getElementById('player').options = { src: '/sample.mp4', muted: true, skipButtons: true }; });
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1);
        await page.evaluate(() => { document.getElementById('player').shadowRoot.querySelector('video').currentTime = 7; });
        const fb = () =>
            page.evaluate(() => {
                const root = document.getElementById('player').shadowRoot;
                const el = root.querySelector('[part="seek-feedback"]');
                const r = el.getBoundingClientRect();
                const area = root.querySelector('.video-area').getBoundingClientRect();
                return {
                    visible: el.hasAttribute('data-visible'),
                    side: el.dataset.side,
                    text: el.querySelector('.hp-seek-fb-value').textContent,
                    live: el.querySelector('[aria-live]').textContent,
                    onRight: r.left > area.left + area.width / 2,
                };
            });

        await page.evaluate(() => {
            const b = document.getElementById('player').shadowRoot.querySelector('[part="skip-forward-button"]');
            b.click();
            b.click();
            b.click();
        });
        let s = await fb();
        ok(s.visible && s.side === 'forward' && s.onRight && s.text === '+30sn' && s.live === '30 saniye ileri', `3 kez ileri → sağda "+30 sn" ${JSON.stringify(s)}`);
        await page.waitForTimeout(1000);
        s = await fb();
        ok(!s.visible, 'bir süre sarılmayınca bildirim kayboldu');

        await page.evaluate(() => document.getElementById('player').focus());
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        s = await fb();
        ok(s.visible && s.side === 'back' && !s.onRight && s.text === '−10sn', `klavyede 2 kez ← → solda "−10 sn" ${JSON.stringify(s)}`);
        await page.keyboard.press('ArrowRight');
        s = await fb();
        ok(s.side === 'forward' && s.text === '+5sn', `yön değişince toplam sıfırlandı ${JSON.stringify(s)}`);
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await chromium.launch();
    try {
        await testPluginIsolation(browser);
        await testGesture(browser);
        await testTapToTogglePlayPause(browser);
        await testVolumePanel(browser);
        await testAutoHide(browser);
        await testLoopSection(browser);
        await testInViewAutoplay(browser);
        await testSticky(browser);
        await testStickyWithAutoplayRace(browser);
        await testPlaylist(browser);
        await testStory(browser);
        await testTimeDisplayToggle(browser);
        await testSkipButtons(browser);
        await testSeekFeedback(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
