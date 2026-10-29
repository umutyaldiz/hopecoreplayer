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

async function testSettingsMenuStaysInside(browser) {
    console.log('\n[1b] Mobil: üst bardaki ayarlar menüsü AŞAĞI açılıyor ve player içinde kalıyor; masaüstünde yukarı açılıyor');
    const read = (page) =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const area = root.querySelector('.video-area').getBoundingClientRect();
            const btn = root.querySelector('[aria-label="Ayarlar"]').getBoundingClientRect();
            const panel = root.querySelector('.hp-chip-panel').getBoundingClientRect();
            return {
                below: panel.top >= btn.bottom - 1,
                above: panel.bottom <= btn.top + 1,
                inside: panel.top >= area.top - 1 && panel.bottom <= area.bottom + 1 && panel.left >= area.left - 1 && panel.right <= area.right + 1,
                h: Math.round(panel.height),
            };
        });
    {
        const { context, page } = await openPlayer(browser, { width: 360, touch: true });
        const pos = await page.evaluate(() => {
            const r = document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.touchscreen.tap(pos.x, pos.y);
        await page.waitForTimeout(250);
        const m = await read(page);
        ok(m.inside && !m.above, `mobil: menü yukarı (ekran dışına) değil, tamamen player içinde açılıyor (içeride=${m.inside}, h=${m.h}px)`);
        await context.close();
    }
    {
        const { context, page } = await openPlayer(browser, { width: 1000, touch: false });
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').click());
        await page.waitForTimeout(250);
        const d = await read(page);
        ok(d.above && d.inside, `masaüstü: menü butonun üstünde ve player içinde (yukarı=${d.above}, içeride=${d.inside})`);
        await context.close();
    }
}

async function testChromeStaysWhileMenuOpen(browser) {
    console.log('\n[1c] Mobil: ayarlar menüsü açıkken kontroller (ve menü) otomatik gizlenmiyor');
    const { context, page } = await openPlayer(browser, { width: 360, touch: true });
    await page.evaluate(async () => { const v = document.getElementById('player').shadowRoot.querySelector('video'); v.muted = true; await v.play().catch(() => {}); });
    const pos = await page.evaluate(() => { const r = document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(pos.x, pos.y);
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        return { chrome: getComputedStyle(root.querySelector('[part="control-bar"]').parentElement).opacity, menuOpen: !root.querySelector('.hp-chip-panel').classList.contains('hp:hidden') };
    });
    ok(st.chrome === '1' && st.menuOpen, `2,5 sn sonra kontroller ve menü hâlâ açık (opacity ${st.chrome}, menü ${st.menuOpen})`);
    await context.close();
}

async function testIphoneFullscreenFallback(browser) {
    console.log('\n[1d] iPhone: element tam ekranı yoksa tam ekran butonu <video>\'nun kendi tam ekranını açıyor');
    const { context, page } = await openPlayer(browser, { width: 390, touch: true });
    await page.evaluate(() => {
        const host = document.getElementById('player');
        const v = host.shadowRoot.querySelector('video');
        // iPhone Safari: element tam ekranı yok, yalnızca video.webkitEnterFullscreen var.
        Object.defineProperty(host, 'requestFullscreen', { value: undefined, configurable: true });
        Object.defineProperty(host, 'webkitRequestFullscreen', { value: undefined, configurable: true });
        v.webkitEnterFullscreen = () => {
            window.__iosFs = true;
            Object.defineProperty(v, 'webkitDisplayingFullscreen', { value: true, configurable: true });
            v.dispatchEvent(new Event('webkitbeginfullscreen'));
        };
    });
    const pos = await page.evaluate(() => { const r = document.getElementById('player').shadowRoot.querySelector('[aria-label="Tam ekran"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(pos.x, pos.y);
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({ called: !!window.__iosFs, exitLabel: !!document.getElementById('player').shadowRoot.querySelector('[aria-label="Tam ekrandan çık"]') }));
    ok(r.called, 'tam ekran butonu video.webkitEnterFullscreen() çağırdı');
    ok(r.exitLabel, 'tam ekran durumu algılandı — buton "Tam ekrandan çık" oldu');
    await context.close();
}

async function testIosNativeFullscreenCaptions(browser) {
    console.log('\n[5] iPhone native tam ekran: altyazı iOS\'a devrediliyor, dönüşte seçim bize aktarılıyor ve çift altyazı olmuyor');
    const { context, page } = await openPlayer(browser, { width: 390, touch: true });
    await page.evaluate(() => {
        document.getElementById('player').options = {
            src: '/sample.mp4',
            muted: true,
            subtitles: [
                { src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true },
                { src: '/sample.en.vtt', label: 'English', srclang: 'en' },
            ],
        };
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1);
    await page.waitForTimeout(600);
    await page.evaluate(() => { document.getElementById('player').shadowRoot.querySelector('video').currentTime = 1; });
    await page.waitForTimeout(400);
    const state = () =>
        page.evaluate(async () => {
            const root = document.getElementById('player').shadowRoot;
            const v = root.querySelector('video');
            const modes = Array.from(v.textTracks).filter((t) => t.kind === 'subtitles').map((t) => `${t.language}:${t.mode}`);
            root.querySelector('[aria-label="Ayarlar"]').click();
            await new Promise((r) => setTimeout(r, 120));
            const row = Array.from(root.querySelectorAll('.hp-chip-panel button')).find((b) => /Altyazı/.test(b.textContent));
            const menu = row?.textContent.replace('Altyazı', '').trim();
            root.querySelector('[aria-label="Ayarlar"]').click();
            await new Promise((r) => setTimeout(r, 120));
            const bubble = root.querySelector('.hp-caption-bubble');
            return { modes, menu, caption: bubble.classList.contains('hp-caption-visible') ? bubble.textContent.trim() : null };
        });
    const fire = (type) =>
        page.evaluate((type) => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            Object.defineProperty(v, 'webkitDisplayingFullscreen', { value: type === 'webkitbeginfullscreen', configurable: true });
            v.dispatchEvent(new Event(type));
        }, type);
    const nativePick = (lang) =>
        page.evaluate((lang) => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            for (const t of v.textTracks) if (t.kind === 'subtitles') t.mode = t.language === lang ? 'showing' : 'disabled';
        }, lang);

    let st = await state();
    ok(JSON.stringify(st.modes) === '["tr:hidden","en:disabled"]' && /volkanik/.test(st.caption ?? ''), `başlangıç: tr bizim katmanda (${JSON.stringify(st)})`);

    await fire('webkitbeginfullscreen');
    st = await state();
    ok(st.modes[0] === 'tr:showing', `tam ekrana girince seçili iz iOS'a devredildi (showing) ${JSON.stringify(st.modes)}`);

    // Kullanıcı iOS menüsünde İngilizceyi seçti, sonra tam ekrandan çıktı.
    await nativePick('en');
    await fire('webkitendfullscreen');
    await page.waitForTimeout(300);
    st = await state();
    ok(JSON.stringify(st.modes) === '["tr:disabled","en:hidden"]', `dönüşte hiçbir iz showing değil — çift altyazı yok ${JSON.stringify(st.modes)}`);
    ok(st.menu === 'English' && /glide/.test(st.caption ?? ''), `iOS'ta seçilen İngilizce bize aktarıldı (menü: ${st.menu}, altyazı: ${st.caption})`);

    // Tam ekranda altyazıyı kapatıp çıktı.
    await fire('webkitbeginfullscreen');
    await nativePick('none');
    await fire('webkitendfullscreen');
    await page.waitForTimeout(300);
    st = await state();
    ok(JSON.stringify(st.modes) === '["tr:disabled","en:disabled"]' && st.menu === 'Kapalı' && st.caption === null, `iOS'ta kapatılan altyazı bizde de kapalı (${JSON.stringify(st)})`);
    await context.close();
}

async function testCenterPlayAboveCaptions(browser) {
    console.log('\n[6] Büyük play butonu altyazının üstünde kalıyor');
    const { context, page } = await openPlayer(browser, { width: 390, touch: true });
    await page.evaluate(() => {
        document.getElementById('player').options = { src: '/sample.mp4', muted: true, subtitles: [{ src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true }] };
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1);
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById('player').shadowRoot.querySelector('video').currentTime = 1; });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-caption-bubble.hp-caption-visible'), { timeout: 5000 });
    const r = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const chip = root.querySelector('.hp-center-play > .hp-chip');
        const bubble = root.querySelector('.hp-caption-bubble');
        const c = chip.getBoundingClientRect();
        // Altyazı balonunu butonun tam üstüne taşı (küçük ekranda üst üste binme durumu).
        const area = root.querySelector('.video-area').getBoundingClientRect();
        bubble.style.bottom = `${area.bottom - (c.top + c.height / 2) - bubble.offsetHeight / 2}px`;
        const b = bubble.getBoundingClientRect();
        const overlaps = b.top < c.bottom && b.bottom > c.top;
        const top = root.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
        return { overlaps, onChip: !!top?.closest('.hp-chip') && !!top.closest('.hp-center-play') };
    });
    ok(r.overlaps && r.onChip, `altyazı butonla çakışınca en üstte play butonu (${JSON.stringify(r)})`);
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
        await testSettingsMenuStaysInside(browser);
        await testChromeStaysWhileMenuOpen(browser);
        await testIphoneFullscreenFallback(browser);
        await testUnmuteBadge(browser);
        await testDesktopLayoutAndResize(browser);
        await testCaptionsDropToBottom(browser);
        await testIosNativeFullscreenCaptions(browser);
        await testCenterPlayAboveCaptions(browser);
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
