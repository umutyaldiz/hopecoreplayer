// HopeCorePlayer — Faz 5 (markers/segments/sprite-thumbnails/countdown-screen/
// geo-checker/redirect-screen/dubbing) Playwright doğrulama scripti. geo-checker
// dışında hiçbiri gerçek bir ağ SDK'sına bağımlı değil; geo-checker'ın
// window.fetch çağrısı test içinde mock'lanıyor (gerçek IP servisine bağımlı
// olmasın diye), diğerleri gerçek DOM/zamanlayıcı davranışıyla sürülüyor.
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

async function openFeature(browser, feature, { fetchMock = null } = {}) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    if (fetchMock) await page.addInitScript(fetchMock);
    await page.goto(`${BASE}/?feature=${feature}`);
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
    console.log('\n[1] Plugin izolasyonu: her Faz 5 plugin\'i yalnızca kendi feature\'ı açıkken yeni chunk indiriyor mu?');
    const baseline = await collectChunkUrls(browser, null);
    for (const feature of ['markers', 'segments', 'sprite', 'countdown', 'geo-allow', 'redirect', 'dubbing', 'qr-resume']) {
        const withFeature = await collectChunkUrls(browser, feature);
        const newChunks = [...withFeature].filter((u) => !baseline.has(u));
        ok(newChunks.length > 0, `?feature=${feature} → en az 1 yeni chunk (${newChunks.length})`);
    }
}

async function testMarkers(browser) {
    console.log('\n[2] Markers: once marker popup gösteriyor + duraklatıyor, cooldown marker custom action fırlatıyor mu?');
    const page = await openFeature(browser, 'markers');

    const logs = [];
    page.on('console', (msg) => { if (msg.text().includes('marker_b_hit')) logs.push(msg.text()); });

    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    // Marker A: time=2, tolerance=0.25 (vars.) → ~1.75'te tetiklenir, popup ile
    // gelen pauseOnHit video'yu duraklatır — bu yüzden currentTime>=2 yerine
    // doğrudan pause/popup durumunu bekliyoruz.
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').paused === true, { timeout: 5000 });
    await page.waitForTimeout(150);

    const pausedAtMarkerA = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(pausedAtMarkerA === true, 'Marker A\'ya ulaşınca video duraklatıldı (pauseOnHit)');

    const popupVisible = await page.evaluate(() => {
        const popup = document.getElementById('player').shadowRoot.querySelector('[part="marker-popup"]');
        return !!popup && !popup.className.includes('hp:hidden');
    });
    ok(popupVisible, 'Marker A popup\'ı gösterildi');

    const popupText = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="marker-popup"]')?.textContent ?? '');
    ok(popupText.includes('Marker A popup'), `popup metni doğru ("${popupText.trim()}")`);

    // Devam et (continue butonuna tıkla), Marker B'ye kadar oynat (cooldown'lu, pauseOnHit false, custom log action).
    const continueBtn = await page.evaluateHandle(() => {
        const popup = document.getElementById('player').shadowRoot.querySelector('[part="marker-popup"]');
        return popup.querySelectorAll('button')[1];
    });
    await continueBtn.asElement().click();
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('video').paused, { timeout: 2000 });

    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime >= 6.2, { timeout: 8000 });
    await page.waitForTimeout(100);
    ok(logs.length > 0, `Marker B custom action (console.log) tetiklendi (${logs.length} kez)`);

    // pauseOnHit:false olduğu için video hâlâ oynuyor olmalı.
    const stillPlaying = await page.evaluate(() => !document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(stillPlaying === true, 'Marker B pauseOnHit:false → video duraklamadı');
    await page.close();
}

async function testSegments(browser) {
    console.log('\n[3] Segments (YouTube tarzı chapter): seek bar parçalı, hover popup + parça kalınlaşması, boşluk-farkındalı seek doğru mu?');
    const page = await openFeature(browser, 'segments');
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelectorAll('[part="segment-band"]').length > 0, { timeout: 3000 });
    await page.waitForTimeout(200);

    const layout = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const bar = root.querySelector('[part="seek-bar"]').getBoundingClientRect();
        const parts = Array.from(root.querySelectorAll('[part="segment-band"]')).map((el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left - bar.left, right: r.right - bar.left, width: r.width, top: r.top, bottom: r.bottom };
        });
        const singleTrack = root.querySelector('[part="seek-bar"]').firstElementChild;
        return { parts, barWidth: bar.width, barLeft: bar.left, barTop: bar.top, barH: bar.height, singleTrackHidden: getComputedStyle(singleTrack).display === 'none' };
    });
    const p = layout.parts;
    ok(p.length === 3, `seek bar 3 ayrı parçaya bölündü (${p.length})`);
    ok(layout.singleTrackHidden, 'tek parça track gizlendi (yalnızca parçalar görünüyor)');
    ok(p.length === 3 && p[1].left - p[0].right >= 1.5 && p[2].left - p[1].right >= 1.5, `parçalar arasında boşluk var (${p.length === 3 ? (p[1].left - p[0].right).toFixed(1) + 'px, ' + (p[2].left - p[1].right).toFixed(1) + 'px' : '-'})`);
    ok(p.length === 3 && Math.abs(p[0].width - p[1].width) < 2, `eşit süreli bölümler eşit genişlikte (${p[0]?.width.toFixed(1)} / ${p[1]?.width.toFixed(1)})`);

    // Hover: 2. bölümün ortası — popup "Bölüm 2" + zaman, parça kalınlaşıyor.
    const midX = layout.barLeft + (p[1].left + p[1].right) / 2;
    const midY = layout.barTop + layout.barH / 2;
    await page.mouse.move(midX, midY);
    await page.waitForTimeout(250);
    const hover = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const tip = root.querySelector('[part="segment-tooltip"]');
        const bands = Array.from(root.querySelectorAll('[part="segment-band"]'));
        return {
            visible: getComputedStyle(tip).visibility === 'visible',
            title: tip.querySelector('.hp-chapter-tooltip-title').textContent,
            time: tip.querySelector('.hp-chapter-tooltip-time').textContent,
            hovered: bands.map((b) => b.hasAttribute('data-hover')),
            heights: bands.map((b) => b.getBoundingClientRect().height),
        };
    });
    ok(hover.visible, 'bölüm üzerine gelince popup görünüyor');
    const defaultTime = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="seek-time"]').hasAttribute('data-visible'));
    ok(!defaultTime, 'segments açıkken varsayılan hover zamanı GÖSTERİLMİYOR (popup zaten zamanı yazıyor)');
    ok(hover.title === 'Bölüm 2', `popup başlığı doğru ("${hover.title}")`);
    ok(/^0:0[6-9]$/.test(hover.time), `popup imlecin altındaki zamanı gösteriyor (${hover.time})`);
    ok(hover.hovered[1] && !hover.hovered[0] && !hover.hovered[2], 'yalnızca üzerine gelinen parça data-hover taşıyor');
    ok(hover.heights[1] > hover.heights[0], `üzerine gelinen parça diğerlerinden kalın (${hover.heights[1]}px > ${hover.heights[0]}px)`);

    // Seek: 2. parçanın ortasına tıklama, boşluklara rağmen ~7.5 sn'ye gitmeli.
    await page.mouse.click(midX, midY);
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const fills = Array.from(root.querySelectorAll('[part="segment-band"] .hp-chapter-played')).map((f) => f.style.transform);
        return { t: root.querySelector('video').currentTime, fills };
    });
    ok(Math.abs(after.t - 7.5) < 0.4, `2. parçanın ortasına tıklama ~7.5 sn'ye sardı (${after.t.toFixed(2)})`);
    ok(after.fills[0] === 'scaleX(1)' && after.fills[2] === 'scaleX(0)', `önceki parça dolu, sonraki boş (${after.fills.join(' | ')})`);

    // Fare ayrılınca popup gizleniyor.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
    const hiddenAfter = await page.evaluate(() => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="segment-tooltip"]')).visibility === 'hidden');
    ok(hiddenAfter, 'fare ayrılınca popup gizleniyor');
    await page.close();
}

async function spriteHoverAt(page, seconds) {
    const pos = await page.evaluate((t) => {
        const root = document.getElementById('player').shadowRoot;
        const r = root.querySelector('[part="seek-bar"]').getBoundingClientRect();
        const d = root.querySelector('video').duration;
        return { x: r.left + (t / d) * r.width, y: r.top + r.height / 2 };
    }, seconds);
    await page.mouse.move(pos.x, pos.y);
}

async function readSprite(page) {
    return page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const tip = root.querySelector('[part="sprite-tooltip"]');
        const img = tip.querySelector('.hp-sprite-image');
        const bar = root.querySelector('[part="seek-bar"]').getBoundingClientRect();
        const r = tip.getBoundingClientRect();
        return {
            visible: tip.hasAttribute('data-visible'),
            bg: img.style.backgroundImage,
            pos: img.style.backgroundPosition,
            time: tip.querySelector('.hp-sprite-time').textContent,
            inside: r.left >= bar.left - 1 && r.right <= bar.right + 1,
        };
    });
}

async function openSprite(browser, feature) {
    const page = await openFeature(browser, feature);
    const requests = [];
    page.on('request', (r) => {
        const u = r.url();
        if (/sprite[^/]*\.jpg|thumbs\.vtt/.test(u)) requests.push(u.split('/').pop());
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('[part="sprite-tooltip"]'), { timeout: 3000 });
    await page.waitForTimeout(300);
    return { page, requests };
}

async function testSpriteThumbnails(browser) {
    console.log('\n[3b] Sprite önizleme: tek sprite / çok parçalı (otomatik sheetDuration) / WebVTT — doğru kare, lazy yükleme, sınırlar');

    // ── Tek sprite (4×4, 1 sn'lik kareler) ──
    {
        const { page, requests } = await openSprite(browser, 'sprite');
        ok(requests.length === 0, `kurulumda HİÇ sprite indirilmedi — ilk hover'a kadar lazy (${requests.join(', ') || 'yok'})`);
        await spriteHoverAt(page, 7.5);
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-sprite-image').style.backgroundPosition !== '', { timeout: 3000 });
        const s = await readSprite(page);
        ok(s.visible && s.bg.includes('sprite.jpg'), `hover'da tek sprite gösteriliyor (${s.bg})`);
        ok(s.pos === '-480px -90px', `7.5 sn → 8. kare (sütun 3, satır 2) doğru konumda (${s.pos})`);
        ok(s.time === '0:07', `önizlemenin altında zaman yazıyor (${s.time})`);
        const dup = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="seek-time"]').hasAttribute('data-visible'));
        ok(!dup, 'sprite açıkken varsayılan hover zamanı GÖSTERİLMİYOR (iki kez yazılmıyor)');
        await spriteHoverAt(page, 15.3);
        await page.waitForTimeout(150);
        const edge = await readSprite(page);
        ok(edge.inside, 'seek bar sağ kenarında önizleme taşmıyor');
        ok(edge.pos === '-480px -270px', `videonun sonu → son kare (${edge.pos})`);
        await page.close();
    }

    // ── Çok parçalı: /sprite-%d.jpg, 2×2 sheet'ler, sheetDuration VERİLMEDİ ──
    {
        const { page, requests } = await openSprite(browser, 'sprite-multi');
        await spriteHoverAt(page, 7.5);
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-sprite-image').style.backgroundImage.includes('sprite-2'), { timeout: 3000 });
        const s = await readSprite(page);
        ok(s.pos === '-160px -90px', `7.5 sn → sprite-2.jpg'nin 4. karesi (sheetDuration ilk sheet'ten 4 sn hesaplandı) (${s.bg} ${s.pos})`);
        await page.waitForTimeout(200);
        ok(requests.includes('sprite-3.jpg'), `komşu sheet önceden yüklendi (${requests.join(', ')})`);
        ok(!requests.includes('sprite-4.jpg'), 'uzaktaki sheet (sprite-4) gereksiz yere indirilmedi');
        await spriteHoverAt(page, 8.02);
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-sprite-image').style.backgroundImage.includes('sprite-3'), { timeout: 3000 });
        const b = await readSprite(page);
        ok(b.pos === '0px 0px', `sheet sınırı (8. sn) → sprite-3.jpg'nin İLK karesi, önceki sheet'in olmayan karesi değil (${b.pos})`);

        // 3 saatlik video simülasyonu (4 sn'lik sheet'lerle 2700 sheet): 2. saate gelince
        // yalnızca O sheet + komşusu istenmeli — hepsi değil.
        await page.mouse.move(5, 5);
        await page.evaluate(() => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            Object.defineProperty(v, 'duration', { value: 3 * 3600, configurable: true });
        });
        await page.waitForTimeout(200);
        requests.length = 0;
        await spriteHoverAt(page, 7200.5);
        await page.waitForTimeout(400);
        const expected = `sprite-${Math.floor(7200.5 / 4) + 1}.jpg`;
        ok(requests.includes(expected), `3 saatlik videoda 2. saat → doğru sheet istendi (${expected})`);
        ok(requests.length <= 3, `yalnızca o sheet + komşuları istendi, 2700 sheet'in hepsi değil (${requests.length}: ${requests.join(', ')})`);
        await page.close();
    }

    // ── WebVTT (#xywh) ──
    {
        const { page } = await openSprite(browser, 'sprite-vtt');
        await spriteHoverAt(page, 7.5);
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-sprite-image').style.backgroundPosition !== '', { timeout: 3000 });
        const s = await readSprite(page);
        ok(s.bg.includes('sprite.jpg') && s.pos === '-480px -90px', `VTT cue'sunun #xywh=480,90 koordinatı uygulandı (${s.pos})`);
        await page.close();
    }
}

async function testCountdownScreen(browser) {
    console.log('\n[4] CountdownScreen: geri sayım bitene kadar chrome bloklu, bitince serbest bırakıyor mu?');
    const page = await openFeature(browser, 'countdown');
    // Plugin dinamik import() ile asenkron kuruluyor — DOM'da görünene kadar bekle.
    await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('[part="countdown-screen"]'), { timeout: 2000 });
    // centerPlayButton'da opacity geçişi (hp:transition-opacity) var — stil
    // ataması anında computed opacity ara bir değerde yakalanabilir, geçiş
    // bitsin diye kısa bir bekleme.
    await page.waitForTimeout(350);

    const blockedEarly = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const centerBtn = root.querySelector('[part="center-play-button"]');
        return getComputedStyle(centerBtn).opacity === '0' && !!root.querySelector('[part="countdown-screen"]');
    });
    ok(blockedEarly, 'geri sayım gösteriliyor, merkez play butonu gizli (chrome bloklu)');

    // İstek üzerine ("başlangıçta player hiç init olmamalı, geri sayım bitince
    // init olacak player"): geri sayım AKTİFKEN video'ya HİÇ kaynak atanmamış
    // olmalı — network isteği/buffering YOK, yalnızca geri sayım ekranı var.
    const notInitedYet = await page.evaluate(() => {
        const video = document.getElementById('player').shadowRoot.querySelector('video');
        return { currentSrc: video.currentSrc, readyState: video.readyState };
    });
    ok(notInitedYet.currentSrc === '', `geri sayım sırasında video'ya kaynak atanmamış (currentSrc="${notInitedYet.currentSrc}")`);
    ok(notInitedYet.readyState === 0, `geri sayım sırasında video.readyState HAVE_NOTHING (${notInitedYet.readyState})`);

    // play() çağrısı denense bile hemen re-pause edilmeli (blockChrome 'play' guard'ı).
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {}));
    await page.waitForTimeout(150);
    const stillPaused = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(stillPaused === true, 'geri sayım sırasında play() denemesi guard tarafından engellendi');

    // demo config: time = now+6000ms.
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('[part="countdown-screen"]'), { timeout: 10000 });
    await page.waitForTimeout(350);
    const unblocked = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const centerBtn = root.querySelector('[part="center-play-button"]');
        return getComputedStyle(centerBtn).opacity !== '0';
    });
    ok(unblocked, 'geri sayım bitince chrome serbest bırakıldı, merkez play butonu tekrar görünür');

    await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('video').currentSrc, { timeout: 2000 });
    const initedAfter = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentSrc);
    ok(initedAfter.includes('sample.mp4'), `geri sayım bitince video kaynağı GERÇEKTEN yüklendi (${initedAfter})`);
    await page.close();
}

async function testGeoCheckerDeny(browser) {
    console.log('\n[5] GeoChecker (izin verilmeyen ülke): uyarı gösteriliyor, erişim KALICI kapalı mı?');
    const page = await openFeature(browser, 'geo-deny', {
        fetchMock: () => {
            window.fetch = async () => ({ ok: true, json: async () => ({ country: 'Türkiye', country_code: 'TR', country_code3: 'TUR' }) });
        },
    });
    await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('[part="geo-warning"]'), { timeout: 3000 });

    const warningText = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="geo-warning"]')?.textContent ?? '');
    ok(warningText.includes('TR'), `uyarı ekranında tespit edilen ülke gösterildi ("${warningText.trim().slice(0, 60)}")`);

    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {}));
    await page.waitForTimeout(200);
    const stillBlocked = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(stillBlocked === true, 'izin verilmeyen ülkede play() denemesi KALICI olarak engelleniyor');
    await page.close();
}

async function testGeoCheckerAllow(browser) {
    console.log('\n[6] GeoChecker (izin verilen ülke): chrome serbest bırakılıyor mu?');
    const page = await openFeature(browser, 'geo-allow', {
        fetchMock: () => {
            window.fetch = async () => ({ ok: true, json: async () => ({ country: 'Türkiye', country_code: 'TR', country_code3: 'TUR' }) });
        },
    });
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('[part="geo-loading"]'), { timeout: 3000 });
    const warningShown = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="geo-warning"]'));
    ok(!warningShown, 'izin verilen ülkede uyarı gösterilmedi');

    const unblocked = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const centerBtn = root.querySelector('[part="center-play-button"]');
        return getComputedStyle(centerBtn).opacity !== '0';
    });
    ok(unblocked, 'izin verilen ülkede chrome serbest bırakıldı');
    await page.close();
}

async function testGeoCheckerCustomApi(browser) {
    console.log('\n[6c] GeoChecker: kendi API (apiUrl + iç içe parameter yolu) ve getCountry() fonksiyonu çalışıyor mu?');
    // geo-allow senaryosu allowedCountries: ['TR'] — options'ı sayfada yeniden set ediyoruz.
    const page = await openFeature(browser, 'geo-allow', {
        fetchMock: () => {
            window.__geoCalls = [];
            window.fetch = async (url) => {
                window.__geoCalls.push(String(url));
                return { ok: true, json: async () => ({ location: { country: { code: 'tr' } } }) };
            };
        },
    });
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('[part="geo-loading"]'), { timeout: 3000 });
    await page.evaluate(() => {
        const old = document.getElementById('player');
        const el = document.createElement('hope-player');
        el.id = 'player2';
        old.after(el);
        el.options = { src: '/sample.mp4', geoChecker: { allowedCountries: ['TR'], apiUrl: 'https://geo.example.com/me', parameter: 'location.country.code' } };
    });
    await page.waitForFunction(() => {
        const r = document.getElementById('player2')?.shadowRoot;
        return r && r.querySelector('video') && !r.querySelector('[part="geo-loading"]');
    }, { timeout: 3000 });
    const custom = await page.evaluate(() => ({
        warning: !!document.getElementById('player2').shadowRoot.querySelector('[part="geo-warning"]'),
        calls: window.__geoCalls,
    }));
    ok(custom.calls.includes('https://geo.example.com/me'), `kendi apiUrl'iniz çağrıldı (${custom.calls.join(', ')})`);
    ok(!custom.warning, 'iç içe parameter yolu (location.country.code) + küçük harf "tr" → izin verildi');

    await page.evaluate(() => {
        const el = document.createElement('hope-player');
        el.id = 'player3';
        document.getElementById('player2').after(el);
        el.options = { src: '/sample.mp4', geoChecker: { allowedCountries: ['DE'], getCountry: async () => 'TR' } };
    });
    await page.waitForFunction(() => !!document.getElementById('player3')?.shadowRoot?.querySelector('[part="geo-warning"]'), { timeout: 3000 });
    const callsAfter = await page.evaluate(() => window.__geoCalls.length);
    ok(callsAfter === custom.calls.length, `getCountry() verilince fetch HİÇ çağrılmadı ve TR ∉ [DE] → engellendi (${callsAfter} çağrı)`);
    await page.close();
}

async function testGeoCheckerFetchFailsOpen(browser) {
    console.log('\n[6b] GeoChecker: API hatası durumunda fail-open (erişime izin verilir) mi?');
    const page = await openFeature(browser, 'geo-allow', {
        fetchMock: () => {
            window.fetch = async () => { throw new Error('network down'); };
        },
    });
    await page.waitForFunction(() => !document.getElementById('player').shadowRoot.querySelector('[part="geo-loading"]'), { timeout: 3000 });
    const unblocked = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const centerBtn = root.querySelector('[part="center-play-button"]');
        return getComputedStyle(centerBtn).opacity !== '0';
    });
    ok(unblocked, 'API hatasında fail-open: chrome serbest bırakıldı (kısıt güvenlik mekanizması değil)');
    await page.close();
}

async function testRedirectScreen(browser) {
    console.log('\n[7] RedirectScreen: içerik bitince sayaç gösteriyor, iptal → öneriler listesine geçiyor mu?');
    const page = await openFeature(browser, 'redirect');
    await page.evaluate(() => {
        const video = document.getElementById('player').shadowRoot.querySelector('video');
        video.currentTime = video.duration > 1 ? video.duration - 0.1 : 0;
        video.dispatchEvent(new Event('ended'));
    });
    await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('[part="redirect-screen"]'), { timeout: 2000 });

    const counterText = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="redirect-screen"]')?.textContent ?? '');
    ok(counterText.includes('3 saniye') || counterText.includes('2 saniye'), `geri sayım metni gösteriliyor ("${counterText.trim().slice(0, 50)}")`);

    const cancelBtn = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[part="redirect-screen"] button'));
    await cancelBtn.asElement().click();

    const suggestionsShown = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="redirect-suggestions"]'));
    ok(suggestionsShown, 'iptal sonrası öneriler grid\'i gösterildi');
    await page.close();
}

async function testDubbing(browser) {
    console.log('\n[8] Dubbing: ayarlar menüsünde "Ses / Dil" alt menüsü var, seçim kaynağı değiştiriyor + currentTime koruyor mu?');
    const page = await openFeature(browser, 'dubbing');
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime >= 1, { timeout: 5000 });
    const resumeAt = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);

    const settingsBtn = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]'));
    await settingsBtn.asElement().click();
    await page.waitForTimeout(50);

    const dubRow = await page.evaluateHandle(() => {
        const root = document.getElementById('player').shadowRoot;
        return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Ses / Dil'));
    });
    ok(!!(await dubRow.asElement()), 'ana menüde "Ses / Dil" satırı var');
    await dubRow.asElement().click();
    await page.waitForTimeout(50);

    const englishRow = await page.evaluateHandle(() => {
        const root = document.getElementById('player').shadowRoot;
        return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('English'));
    });
    await englishRow.asElement().click();

    await page.waitForFunction(
        (t) => document.getElementById('player').shadowRoot.querySelector('video').currentTime >= t - 0.5,
        resumeAt,
        { timeout: 3000 }
    );
    const resumedTime = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
    ok(resumedTime >= resumeAt - 0.5, `dub değişimi sonrası currentTime korundu (${resumeAt.toFixed(1)} → ${resumedTime.toFixed(1)})`);
    await page.close();
}

async function testSubtitlesWithoutTrackElements(browser) {
    console.log('\n[SUB] Altyazılar <track> elementi olmadan yükleniyor (iOS out-of-band iz kod 4 hatası), kaynak değişince havuz yeniden kullanılıyor');
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    try {
        await page.goto(`${BASE}/`);
        await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
        const subs = [
            { src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true },
            { src: '/sample.en.vtt', label: 'English', srclang: 'en' },
        ];
        const state = () =>
            page.evaluate(() => {
                const v = document.getElementById('player').shadowRoot.querySelector('video');
                const tracks = Array.from(v.textTracks).filter((t) => t.kind === 'subtitles');
                return {
                    trackEls: v.querySelectorAll('track').length,
                    tracks: tracks.map((t) => {
                        const mode = t.mode;
                        if (mode === 'disabled') t.mode = 'hidden';
                        const n = t.cues?.length ?? 0;
                        t.mode = mode;
                        return `${t.language}:${mode}:${n}`;
                    }),
                };
            });

        await page.evaluate((subtitles) => { document.getElementById('player').options = { src: '/sample.mp4', muted: true, subtitles }; }, subs);
        await page.waitForTimeout(800);
        let st = await state();
        ok(st.trackEls === 0, `video'da <track> elementi yok (${st.trackEls})`);
        ok(JSON.stringify(st.tracks) === JSON.stringify(['tr:hidden:5', 'en:disabled:5']), `cue'lar fetch ile yüklendi ${JSON.stringify(st.tracks)}`);

        await page.evaluate(async () => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.currentTime = 4; // ilk cue 3. saniyede başlıyor
            await new Promise((r) => setTimeout(r, 400));
        });
        const caption = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-caption-bubble')?.textContent?.trim());
        ok(/volkanik/.test(caption ?? ''), `altyazı ekranda (${caption})`);

        // Aynı izlerle tekrar kur → havuz yeniden kullanılır, iz sayısı artmaz.
        await page.evaluate((subtitles) => { document.getElementById('player').options = { src: '/sample.mp4', muted: true, subtitles }; }, subs);
        await page.waitForTimeout(800);
        st = await state();
        ok(st.tracks.length === 2 && JSON.stringify(st.tracks) === JSON.stringify(['tr:hidden:5', 'en:disabled:5']), `yeniden kurulumda iz çoğalmadı, cue'lar çiftlenmedi ${JSON.stringify(st.tracks)}`);

        // Altyazısız kaynağa geçiş → izler kapalı ve boş.
        await page.evaluate(() => { document.getElementById('player').options = { src: '/sample.mp4', muted: true }; });
        await page.waitForTimeout(500);
        st = await state();
        ok(JSON.stringify(st.tracks) === JSON.stringify(['tr:disabled:0', 'en:disabled:0']), `altyazısız kaynakta izler kapalı ve boş ${JSON.stringify(st.tracks)}`);
    } finally {
        await page.close();
    }
}

async function testQrResume(browser) {
    console.log('\n[9] QrResume: yeterince izlenmiş noktada duraklatınca QR gösteriyor, "Devam Et"/"Bir daha gösterme" + ?vtime= ile geri dönüş çalışıyor mu?');
    const page = await openFeature(browser, 'qr-resume');
    // Her alt senaryo kendi temiz localStorage'ıyla başlasın — "Bir daha
    // gösterme" tercihi SİTE GENELİNDE kalıcı, testler arasında sızmasın.
    await page.evaluate(() => localStorage.clear());

    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime >= 1.5, { timeout: 5000 });
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
    await page.waitForTimeout(400);

    const screenAfterPause = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="qr-resume-screen"]'));
    ok(screenAfterPause, 'yeterince izlendikten (minElapsed=1, minRemaining=1) sonra duraklatınca QR ekranı gösterildi');

    const qrInfo = await page.evaluate(() => {
        const wrapper = document.getElementById('player').shadowRoot.querySelector('[part="qr-resume-screen"]');
        const svg = wrapper?.querySelector('svg');
        return { hasSvg: !!svg, rectCount: svg ? svg.querySelectorAll('rect').length : 0, hasImage: !!svg?.querySelector('image') };
    });
    ok(qrInfo.hasSvg && qrInfo.rectCount > 10, `QR SVG gerçekten çizildi (${qrInfo.rectCount} modül dikdörtgeni)`);
    ok(qrInfo.hasImage === false, 'logo verilmemiş senaryoda <image> elementi YOK');

    // Oynatınca ekran kapanmalı.
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForTimeout(100);
    const screenAfterPlay = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="qr-resume-screen"]'));
    ok(!screenAfterPlay, 'tekrar play\'e basınca QR ekranı kapandı');

    // "Bir daha gösterme" → kalıcı, bir SONRAKİ duraklatmada da gösterilmemeli.
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
    await page.waitForTimeout(400);
    const dismissBtn = await page.evaluateHandle(() => {
        const wrapper = document.getElementById('player').shadowRoot.querySelector('[part="qr-resume-screen"]');
        return wrapper?.querySelectorAll('button')[0];
    });
    await dismissBtn.asElement().click();
    const dismissedKey = await page.evaluate(() => localStorage.getItem('hope-qr-resume-dismissed'));
    ok(dismissedKey === '1', '"Bir daha gösterme" localStorage\'a (site geneli, sabit anahtar) yazıldı');

    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForTimeout(100);
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
    await page.waitForTimeout(400);
    const screenAfterDismiss = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="qr-resume-screen"]'));
    ok(!screenAfterDismiss, '"Bir daha gösterme" sonrası SONRAKİ duraklatmada bile QR tekrar gösterilmedi');

    // İstek üzerine: "bir daha gösterme dedikten sonra tekrar açılabilmesi
    // için ayar menüsünde de görünmeli" — ayarlar menüsünden tekrar açılabiliyor mu?
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('button[aria-label="Ayarlar"]').click());
    await page.waitForTimeout(150);
    const toggleRowText = await page.evaluate(() => {
        const panel = document.getElementById('player').shadowRoot.querySelector('.hp-chip-panel');
        const btn = Array.from(panel.querySelectorAll('button')).find((b) => /QR ile Devam Et/.test(b.textContent));
        return btn?.textContent ?? null;
    });
    ok(toggleRowText !== null && toggleRowText.includes('Kapalı'), `ayarlar menüsünde "QR ile Devam Et: Kapalı" satırı var (${toggleRowText})`);

    await page.evaluate(() => {
        const panel = document.getElementById('player').shadowRoot.querySelector('.hp-chip-panel');
        const btn = Array.from(panel.querySelectorAll('button')).find((b) => /QR ile Devam Et/.test(b.textContent));
        btn.click();
    });
    const reEnabledKey = await page.evaluate(() => localStorage.getItem('hope-qr-resume-dismissed'));
    ok(reEnabledKey === '0', 'ayarlar menüsünden tıklayınca "Bir daha gösterme" tercihi geri alındı (localStorage=0)');
    const toggleRowTextAfter = await page.evaluate(() => {
        const panel = document.getElementById('player').shadowRoot.querySelector('.hp-chip-panel');
        const btn = Array.from(panel.querySelectorAll('button')).find((b) => /QR ile Devam Et/.test(b.textContent));
        return btn?.textContent ?? null;
    });
    ok(toggleRowTextAfter !== null && toggleRowTextAfter.includes('Açık'), `satır metni anında "Açık"a güncellendi (${toggleRowTextAfter})`);

    // Tekrar açıldığı için SONRAKİ duraklatmada QR GERÇEKTEN geri gelmeli.
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('button[aria-label="Ayarlar"]').click());
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await page.waitForTimeout(100);
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
    await page.waitForTimeout(400);
    const screenAfterReEnable = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="qr-resume-screen"]'));
    ok(screenAfterReEnable, 'ayarlar menüsünden yeniden açıldıktan sonra duraklatınca QR GERÇEKTEN tekrar gösterildi');
    await page.close();

    // Logo senaryosu — ayrı bir sayfa/instance, farklı bir feature param'ıyla.
    const logoPage = await openFeature(browser, 'qr-resume-logo');
    await logoPage.evaluate(() => localStorage.clear());
    await logoPage.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
    await logoPage.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime >= 1.5, { timeout: 5000 });
    await logoPage.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
    await logoPage.waitForTimeout(400);
    const logoInfo = await logoPage.evaluate(() => {
        const svg = document.getElementById('player').shadowRoot.querySelector('[part="qr-resume-screen"] svg');
        const img = svg?.querySelector('image');
        return { hasImage: !!img, href: img?.getAttribute('href') };
    });
    ok(logoInfo.hasImage && logoInfo.href === '/sample-logo.svg', `logo verilince QR ortasına <image href="${logoInfo.href}"> eklendi`);
    await logoPage.close();

    // ?vtime=N ile sayfa açılışında o saniyeye atlıyor mu?
    const resumePage = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await resumePage.goto(`${BASE}/?feature=qr-resume&vtime=7`);
    await resumePage.waitForSelector('hope-player');
    await resumePage.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    await resumePage.waitForTimeout(300);
    const resumedTime = await resumePage.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
    ok(resumedTime >= 6.5, `?vtime=7 ile sayfa açılışında video 7sn'ye atladı (${resumedTime.toFixed(1)})`);
    const urlCleaned = await resumePage.evaluate(() => location.search);
    ok(!urlCleaned.includes('vtime'), `vtime URL'den temizlendi (kalan query: "${urlCleaned}")`);
    await resumePage.close();
}

(async () => {
    const browser = await chromium.launch();
    try {
        await testPluginIsolation(browser);
        await testMarkers(browser);
        await testSegments(browser);
        await testSpriteThumbnails(browser);
        await testCountdownScreen(browser);
        await testGeoCheckerDeny(browser);
        await testGeoCheckerAllow(browser);
        await testGeoCheckerFetchFailsOpen(browser);
        await testGeoCheckerCustomApi(browser);
        await testRedirectScreen(browser);
        await testDubbing(browser);
        await testQrResume(browser);
        await testSubtitlesWithoutTrackElements(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
