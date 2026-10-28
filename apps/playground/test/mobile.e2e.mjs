// HopeCorePlayer — mobil / küçük player düzeni Playwright doğrulama scripti.
// Gerçek dokunmatik emülasyonu (isMobile + hasTouch → `(hover: none) and
// (pointer: coarse)`) ve gerçek viewport boyutlarıyla, mock'suz:
// kompakt düzen (sağ grup üst sağda, tam ekran altta, taşma yok), dokunmatikte
// ses butonunun gizlenmesi + sessiz videoda "Sesi aç" rozeti, masaüstünde
// normal düzen, canlı yeniden boyutlandırma ve altyazının kontroller
// gizlenince en alta inmesi.
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

async function openPlayer(browser, { width, touch }) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: touch, hasTouch: touch });
    const page = await context.newPage();
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video') && el.shadowRoot.querySelector('video').readyState >= 1);
    });
    await page.waitForTimeout(200);
    return { context, page };
}

const layout = (page) =>
    page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const host = root.host.getBoundingClientRect();
        const inside = (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.left >= host.left - 1 && r.right <= host.right + 1;
        };
        const settings = root.querySelector('[aria-label="Ayarlar"]');
        const fullscreen = root.querySelector('[aria-label="Tam ekran"]');
        const volume = root.querySelector('[part="volume-button"]');
        return {
            compact: root.querySelector('[part="control-bar"]').hasAttribute('data-compact'),
            settingsInTop: !!settings.closest('[part="top-bar"]'),
            fullscreenInBottom: !!fullscreen.closest('[part="control-bar"]'),
            fullscreenInside: inside(fullscreen),
            allGroupsInside: Array.from(root.querySelectorAll('.hp-group')).filter((g) => g.getBoundingClientRect().width > 0).every(inside),
            volumeVisible: getComputedStyle(volume.parentElement).display !== 'none',
            badgeVisible: getComputedStyle(root.querySelector('[part="unmute-badge"]')).display !== 'none',
        };
    });

async function testCompactTouchLayout(browser) {
    console.log('\n[1] Mobil (360px, dokunmatik): sağ grup üst sağda, tam ekran altta, hiçbir buton taşmıyor, ses butonu gizli');
    const { context, page } = await openPlayer(browser, { width: 360, touch: true });
    const l = await layout(page);
    ok(l.compact, 'küçük player kompakt düzene geçti');
    ok(l.settingsInTop, 'ayarlar butonu üst sağdaki bara taşındı');
    ok(l.fullscreenInBottom && l.fullscreenInside, 'tam ekran altta kaldı ve player içinde (eskiden ekran dışına taşıyordu)');
    ok(l.allGroupsInside, 'hiçbir buton grubu player sınırlarını aşmıyor');
    ok(!l.volumeVisible, 'dokunmatikte ses butonu gizli (ses donanım tuşlarıyla)');

    // Butona dokununca tooltip boşuna açılmamalı (hover yok).
    const settingsPos = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.touchscreen.tap(settingsPos.x, settingsPos.y);
    await page.waitForTimeout(700); // tooltip gecikmesi (450ms) geçsin
    const tipVisible = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="tooltip"]').style.visibility === 'visible');
    ok(!tipVisible, 'dokunmatikte butona dokununca/odaklanınca tooltip açılmıyor');
    await context.close();
}

async function testUnmuteBadge(browser) {
    console.log('\n[2] Mobil: sessiz oynayan videoda "Sesi aç" rozeti görünüyor, dokununca ses açılıyor ve rozet kayboluyor');
    const { context, page } = await openPlayer(browser, { width: 360, touch: true });
    ok(!(await layout(page)).badgeVisible, 'duraklatılmış videoda rozet yok');
    await page.evaluate(async () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        v.muted = true;
        await v.play().catch(() => {});
    });
    await page.waitForTimeout(300);
    ok((await layout(page)).badgeVisible, 'sessiz oynarken "Sesi aç" rozeti görünüyor');
    // Kontroller otomatik gizlense bile rozet görünür kalmalı (chrome katmanının dışında).
    await page.waitForTimeout(1600);
    const stillVisible = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const badge = root.querySelector('[part="unmute-badge"]');
        return getComputedStyle(badge).display !== 'none' && getComputedStyle(badge).opacity !== '0';
    });
    ok(stillVisible, 'kontroller otomatik gizlendikten sonra da rozet görünür');
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="unmute-badge"]').click());
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        return { muted: v.muted, paused: v.paused };
    });
    ok(!after.muted, 'rozete dokununca ses açıldı');
    ok(!after.paused, 'rozete dokunmak oynatmayı duraklatmadı (videoya dokunma olarak sayılmadı)');
    ok(!(await layout(page)).badgeVisible, 'ses açılınca rozet kayboldu');
    await context.close();
}

async function testDesktopLayoutAndResize(browser) {
    console.log('\n[3] Masaüstü: normal düzen, rozet yok; pencere daraltılınca kompakta, genişletilince geri dönüyor');
    const { context, page } = await openPlayer(browser, { width: 1000, touch: false });
    let l = await layout(page);
    ok(!l.compact && !l.settingsInTop, 'geniş player normal düzende (ayarlar altta)');
    ok(l.volumeVisible, 'masaüstünde ses butonu görünür');
    await page.evaluate(async () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        v.muted = true;
        await v.play().catch(() => {});
    });
    await page.waitForTimeout(300);
    ok(!(await layout(page)).badgeVisible, 'masaüstünde (fare) sessizken bile rozet çıkmıyor — ses butonu zaten var');

    await page.setViewportSize({ width: 400, height: 800 });
    await page.waitForTimeout(300);
    l = await layout(page);
    ok(l.compact && l.settingsInTop && l.allGroupsInside, 'pencere daraltılınca kompakt düzene geçti (player genişliğine göre)');
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForTimeout(300);
    l = await layout(page);
    ok(!l.compact && !l.settingsInTop && l.fullscreenInBottom, 'genişletilince normal düzene döndü');
    await context.close();
}

async function testCaptionsDropToBottom(browser) {
    console.log('\n[4] Altyazı: kontroller görünürken seek bar\'ın üstünde, gizlenince en altta (mobilde ortada kalmıyor)');
    const { context, page } = await openPlayer(browser, { width: 360, touch: true });
    await page.evaluate(() => {
        document.getElementById('player').options = {
            src: '/sample.mp4',
            muted: true,
            subtitles: [{ src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true }],
        };
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1);
    await page.evaluate(() => {
        document.getElementById('player').shadowRoot.querySelector('video').currentTime = 1;
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-caption-bubble.hp-caption-visible'), { timeout: 5000 });
    await page.waitForTimeout(300);
    const read = () =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const area = root.querySelector('.video-area').getBoundingClientRect();
            const bubble = root.querySelector('.hp-caption-bubble').getBoundingClientRect();
            const seek = root.querySelector('[part="seek-bar"]').getBoundingClientRect();
            return { gapToBottom: Math.round(area.bottom - bubble.bottom), aboveSeek: bubble.bottom <= seek.top, areaH: area.height };
        });
    const visibleChrome = await read();
    ok(visibleChrome.aboveSeek, `kontroller görünürken altyazı seek bar'ın üstünde (alttan ${visibleChrome.gapToBottom}px)`);

    await page.evaluate(async () => {
        await document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {});
    });
    await page.waitForTimeout(1900); // otomatik gizleme (1200ms) + geçiş
    const hiddenChrome = await read();
    ok(hiddenChrome.gapToBottom <= Math.max(12, hiddenChrome.areaH * 0.05), `kontroller gizlenince altyazı en alta indi (alttan ${hiddenChrome.gapToBottom}px, eskiden ${visibleChrome.gapToBottom}px)`);
    await context.close();
}

(async () => {
    const browser = await chromium.launch();
    try {
        await testCompactTouchLayout(browser);
        await testUnmuteBadge(browser);
        await testDesktopLayoutAndResize(browser);
        await testCaptionsDropToBottom(browser);
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
