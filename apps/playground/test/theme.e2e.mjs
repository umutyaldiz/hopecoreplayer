// HopeCorePlayer — Faz 7 (tema sistemi) Playwright doğrulama scripti.
// En kritik senaryo: theme attribute'u SONRA gelen bir .options = {...}
// (theme alanı OLMADAN) çağrısıyla sessizce sıfırlanmamalı — bu gerçek bir
// bug'dı (HopePlayerElement.options setter'ı attribute'larla hiç
// birleşmiyordu), tema seçici ilk kullanımda yakalandı.
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else { console.log(`  FAIL ${msg}`); failures++; }
};

async function openBase(browser) {
    const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
    await page.goto(`${BASE}/`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    return page;
}

async function testPresetsApplyDataTheme(browser) {
    console.log('\n[1] Her preset data-theme attribute\'unu doğru set ediyor mu?');
    const page = await openBase(browser);
    for (const theme of ['glass-light', 'glass-dark', 'neo-dark', 'mono']) {
        await page.evaluate((t) => document.getElementById('player').setAttribute('theme', t), theme);
        const dataTheme = await page.evaluate(() => document.getElementById('player').getAttribute('data-theme'));
        ok(dataTheme === theme, `theme="${theme}" → data-theme="${dataTheme}"`);
    }
    await page.close();
}

async function testSeekBarHoverTime(browser) {
    console.log('\n[1b] İstek üzerine: seek bar\'da gezinirken zaman VARSAYILAN olarak (plugin olmadan) gösteriliyor mu?');
    const page = await openBase(browser);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    const bar = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const r = root.querySelector('[part="seek-bar"]').getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, d: root.querySelector('video').duration };
    });
    const read = () =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const el = root.querySelector('[part="seek-time"]');
            const b = root.querySelector('[part="seek-bar"]').getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return { visible: el.hasAttribute('data-visible'), text: el.textContent, inside: r.left >= b.left - 1 && r.right <= b.right + 1 };
        });
    await page.mouse.move(bar.x + bar.w * (7.5 / bar.d), bar.y + bar.h / 2);
    await page.waitForTimeout(150);
    const mid = await read();
    ok(mid.visible && mid.text === '0:07', `hover'da imlecin altındaki zaman gösteriliyor (${mid.text})`);
    await page.mouse.move(bar.x + bar.w - 1, bar.y + bar.h / 2);
    await page.waitForTimeout(150);
    ok((await read()).inside, 'sağ kenarda zaman etiketi seek bar dışına taşmıyor');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
    ok(!(await read()).visible, 'fare ayrılınca gizleniyor');

    // Canlı yayında (duration Infinity) süre yok — gösterilmemeli.
    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        Object.defineProperty(v, 'duration', { value: Infinity, configurable: true });
        // Geri sarılamayan canlı (DVR yok) — DVR'lı canlıda seek bar aktif (live.e2e [4i]).
        Object.defineProperty(v, 'seekable', { value: { length: 0, start: () => 0, end: () => 0 }, configurable: true });
    });
    await page.mouse.move(bar.x + bar.w / 2, bar.y + bar.h / 2);
    await page.waitForTimeout(150);
    ok(!(await read()).visible, 'geri sarılamayan canlı yayında varsayılan hover zamanı gösterilmiyor');
    await page.close();
}

async function testMiniProgress(browser) {
    console.log('\n[1c] İstek üzerine: options.miniProgress — kontroller gizliyken en altta kenardan kenara 1px ilerleme çizgisi');
    const page = await openBase(browser);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    const absent = await page.evaluate(() => !document.getElementById('player').shadowRoot.querySelector('[part="mini-progress"]'));
    ok(absent, 'seçenek verilmezse çizgi hiç oluşturulmuyor (varsayılan kapalı)');

    await page.evaluate(() => {
        document.getElementById('player').options = { src: '/sample.mp4', muted: true, miniProgress: true };
    });
    await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('[part="mini-progress"]'));
    const read = () =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const el = root.querySelector('[part="mini-progress"]');
            const area = root.querySelector('.video-area').getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return {
                opacity: getComputedStyle(el).opacity,
                height: r.height,
                fullWidth: Math.abs(r.left - area.left) < 0.5 && Math.abs(r.right - area.right) < 0.5,
                atBottom: Math.abs(r.bottom - area.bottom) < 0.5,
                played: el.querySelector('.hp-mini-progress-played').style.transform,
            };
        });

    // Fare player'ın dışında, video oynuyor → otomatik gizleme (1200ms) sonrası çizgi görünür.
    await page.mouse.move(2, 2);
    await page.evaluate(async () => {
        await document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {});
    });
    await page.waitForTimeout(1900);
    const hidden = await read();
    ok(hidden.opacity === '1', `kontroller gizlenince çizgi görünür (opacity ${hidden.opacity})`);
    ok(hidden.height === 1 && hidden.fullWidth && hidden.atBottom, `1px yükseklikte, kenardan kenara, en altta (h=${hidden.height}, tam genişlik=${hidden.fullWidth}, altta=${hidden.atBottom})`);
    ok(/scaleX\(0\.[0-9]*[1-9]/.test(hidden.played), `oynatıldıkça doluyor (${hidden.played})`);

    // Fare player'a gelince kontroller açılır → çizgi kaybolur.
    const box = await page.evaluate(() => {
        const r = document.getElementById('player').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(350);
    ok((await read()).opacity === '0', 'kontroller görününce çizgi gizleniyor');

    // Canlı yayın (duration Infinity) — gösterilmemeli.
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1900);
    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        Object.defineProperty(v, 'duration', { value: Infinity, configurable: true });
        // Geri sarılamayan canlı (DVR yok) — DVR'lı canlıda seek bar aktif (live.e2e [4i]).
        Object.defineProperty(v, 'seekable', { value: { length: 0, start: () => 0, end: () => 0 }, configurable: true });
        v.dispatchEvent(new Event('durationchange'));
    });
    await page.waitForTimeout(350);
    ok((await read()).opacity === '0', 'canlı yayında çizgi gösterilmiyor');
    await page.close();
}

async function testSeekThumbAndHoverDot(browser) {
    console.log('\n[1d] İstek üzerine: thumb hep görünür + küçük, hover\'da büyür; imleci takip eden küçük hover noktası');
    const page = await openBase(browser);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    await page.evaluate(() => {
        document.getElementById('player').shadowRoot.querySelector('video').currentTime = 5;
    });
    await page.waitForTimeout(200);
    const read = () =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const thumb = root.querySelector('[part="seek-thumb"]');
            const dot = root.querySelector('[part="seek-hover-dot"]');
            const bar = root.querySelector('[part="seek-bar"]').getBoundingClientRect();
            const d = dot.getBoundingClientRect();
            const t = getComputedStyle(thumb);
            const tr = thumb.getBoundingClientRect();
            const played = root.querySelector('[part="seek-bar"] > div > div:last-child').getBoundingClientRect();
            return {
                thumbCenterX: tr.left + tr.width / 2,
                playedEndX: played.right,
                thumbScale: t.scale,
                thumbDisplay: t.display,
                dotVisible: getComputedStyle(dot).opacity !== '0',
                dotCenterX: d.left + d.width / 2,
                dotCenterY: d.top + d.height / 2,
                dotSize: d.height,
                barCenterY: bar.top + bar.height / 2,
                trackHover: parseFloat(getComputedStyle(root.host).getPropertyValue('--hp-seek-track-h-hover')),
            };
        });

    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    const idle = await read();
    ok(idle.thumbDisplay !== 'none' && idle.thumbScale === '0.5', `fare yokken thumb görünür ve küçük (scale ${idle.thumbScale})`);
    ok(!idle.dotVisible, 'fare yokken hover noktası yok');
    ok(Math.abs(idle.thumbCenterX - idle.playedEndX) < 1.5, `küçükken de thumb oynatma konumunda (fark ${Math.abs(idle.thumbCenterX - idle.playedEndX).toFixed(1)}px)`);

    const bar = await page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]').getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const cursorX = bar.x + bar.w * 0.7;
    await page.mouse.move(cursorX, bar.y + bar.h / 2);
    await page.waitForTimeout(250);
    const hover = await read();
    ok(hover.thumbScale === '1', `seek bar hover'ında thumb büyüdü (scale ${hover.thumbScale})`);
    ok(Math.abs(hover.thumbCenterX - hover.playedEndX) < 1.5, `büyüyünce de aynı konumda (fark ${Math.abs(hover.thumbCenterX - hover.playedEndX).toFixed(1)}px)`);
    ok(hover.dotVisible && Math.abs(hover.dotCenterX - cursorX) < 2, `hover noktası imlecin altında (fark ${Math.abs(hover.dotCenterX - cursorX).toFixed(1)}px)`);
    ok(Math.abs(hover.dotSize - hover.trackHover) < 0.5 && Math.abs(hover.dotCenterY - hover.barCenterY) < 1, `nokta çizgiye sığıyor ve dikeyde ortalı (${hover.dotSize}px)`);

    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    ok(!(await read()).dotVisible, 'fare ayrılınca hover noktası gizleniyor');

    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        Object.defineProperty(v, 'duration', { value: Infinity, configurable: true });
        // Geri sarılamayan canlı (DVR yok) — DVR'lı canlıda seek bar aktif (live.e2e [4i]).
        Object.defineProperty(v, 'seekable', { value: { length: 0, start: () => 0, end: () => 0 }, configurable: true });
        v.dispatchEvent(new Event('timeupdate'));
    });
    await page.waitForTimeout(100);
    ok((await read()).thumbDisplay === 'none', 'geri sarılamayan canlı yayında thumb gizli');
    await page.close();
}

async function testMediaElementIosAttrsAndErrors(browser) {
    console.log('\n[1e] iOS: playsinline + webkit-playsinline, preload (vars. metadata), kaynaksız hata ekranı açmaz, "Tekrar dene" kaynağı yeniden yükler');
    const page = await openBase(browser);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    const attrs = await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        return { playsinline: v.hasAttribute('playsinline') && v.playsInline, webkit: v.hasAttribute('webkit-playsinline'), preload: v.preload };
    });
    ok(attrs.playsinline && attrs.webkit, `playsinline + webkit-playsinline var (${JSON.stringify(attrs)})`);
    ok(attrs.preload === 'metadata', `preload varsayılanı "metadata" (${attrs.preload})`);
    await page.evaluate(() => {
        document.getElementById('player').options = { src: '/sample.mp4', muted: true, preload: 'none' };
    });
    await page.waitForTimeout(150);
    ok((await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').preload)) === 'none', 'options.preload uygulanıyor ("none")');

    const errorVisible = () => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="error-screen"]').hasAttribute('data-visible'));
    // Kaynak yokken gelen hata (iOS'ta kaynak değişimi sırasında kod 4) → ekran AÇILMAMALI.
    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        const src = v.getAttribute('src');
        v.removeAttribute('src');
        v.dispatchEvent(new Event('error'));
        v.setAttribute('src', src);
    });
    ok(!(await errorVisible()), 'kaynak yokken gelen hata olayı hata ekranını açmıyor');
    // Gerçek kaynak hatası → açılmalı; "Tekrar dene" kaynağı SourceManager üzerinden yeniden yüklemeli.
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').dispatchEvent(new Event('error')));
    ok(await errorVisible(), 'kaynak varken gelen hata ekranı açıyor');
    const onTop = await page.evaluate(() => {
        const host = document.getElementById('player');
        const r = host.getBoundingClientRect();
        const el = host.shadowRoot.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!el?.closest('[part="error-screen"]');
    });
    ok(onTop, 'hata ekranı merkez play butonunun/kontrollerin ÜSTÜNDE');
    await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        root.querySelector('video').removeAttribute('src');
        root.querySelector('[part="error-screen"] button').click();
    });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').getAttribute('src'));
    ok(!(await errorVisible()) && /sample\.mp4$/.test(after ?? ''), `"Tekrar dene" ekranı kapatıp kaynağı yeniden yükledi (src=${after})`);
    await page.close();
}

async function testChromeStaysWhileHovered(browser) {
    console.log('\n[1f] İstek üzerine: oynarken fare video üzerinde hareketsizse kontroller gizleniyor, hareket edince geliyor, kontrol üzerindeyken kalıyor');
    const page = await openBase(browser);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    const box = await page.evaluate(() => { const r = document.getElementById('player').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 3 }; });
    await page.mouse.move(box.x, box.y);
    await page.evaluate(async () => { const v = document.getElementById('player').shadowRoot.querySelector('video'); v.muted = true; await v.play().catch(() => {}); });
    const chromeOpacity = () => page.evaluate(() => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="control-bar"]').parentElement).opacity);
    await page.waitForTimeout(1900);
    ok((await chromeOpacity()) === '0', 'fare video üzerinde hareketsiz → kontroller gizlendi');
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.waitForTimeout(150);
    ok((await chromeOpacity()) === '1', 'fare hareket edince kontroller geri geldi');
    const btn = await page.evaluate(() => { const r = document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(btn.x, btn.y);
    await page.waitForTimeout(2500);
    ok((await chromeOpacity()) === '1', 'fare bir kontrolün üzerinde 2,5 sn dururken kontroller açık kaldı');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1900);
    ok((await chromeOpacity()) === '0', 'fare çıkınca kontroller gizlendi');
    await page.close();
}

async function testTooltipBehindOpenMenu(browser) {
    console.log('\n[1h] İstek üzerine: ayarlar menüsü açıkken ayarlar butonunun tooltip\'i menünün altında kalıyor (gösterilmiyor), menüyle çakışmayan tooltipler çalışıyor');
    const page = await openBase(browser);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    const center = (label) =>
        page.evaluate((label) => {
            const root = document.getElementById('player').shadowRoot;
            const sel = `[aria-label="${label}"]`;
            const r = (root.querySelector('[part="control-bar"]').querySelector(sel) ?? root.querySelector(sel)).getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, label);
    const tooltip = () =>
        page.evaluate(() => {
            const t = document.getElementById('player').shadowRoot.querySelector('[part="tooltip"]');
            return t.style.visibility === 'visible' ? t.textContent.trim() : null;
        });
    const s = await center('Ayarlar');
    await page.mouse.move(s.x, s.y);
    await page.waitForTimeout(700);
    ok((await tooltip()) === 'Ayarlar', `menü kapalıyken ayarlar tooltip'i görünüyor (${await tooltip()})`);
    await page.mouse.click(s.x, s.y);
    await page.mouse.move(s.x + 1, s.y);
    await page.mouse.move(s.x - 1, s.y);
    await page.waitForTimeout(700);
    const open = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('.hp-chip-panel:not(.hp\\:hidden)'));
    ok(open && (await tooltip()) === null, `menü açıkken ayarlar butonunda tooltip gösterilmiyor (menü açık: ${open}, tooltip: ${await tooltip()})`);
    const p = await center('Oynat');
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(700);
    ok((await tooltip())?.startsWith('Oynat'), `menüyle çakışmayan oynat butonunun tooltip'i çalışıyor (${await tooltip()})`);
    await page.close();
}

async function testCursorHide(browser) {
    console.log('\n[1i] İstek üzerine: oynarken fare hareketsiz kalınca imleç gizleniyor (cursorHideDelayMs), kıpırdayınca geri geliyor');
    const page = await openBase(browser);
    try {
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
        const box = await page.evaluate(() => { const r = document.getElementById('player').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 3 }; });
        const cursor = () =>
            page.evaluate(() => {
                const el = document.getElementById('player');
                return { hidden: el.hasAttribute('data-cursor-hidden'), css: getComputedStyle(el.shadowRoot.querySelector('video')).cursor };
            });
        const play = () => page.evaluate(async () => { const v = document.getElementById('player').shadowRoot.querySelector('video'); v.muted = true; await v.play().catch(() => {}); });
        const pause = () => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());

        await page.evaluate(() => { const el = document.getElementById('player'); el.options = { ...el.options, cursorHideDelayMs: 600 }; });
        await page.waitForTimeout(200);
        await page.mouse.move(box.x, box.y);
        await play();
        await page.mouse.move(box.x + 5, box.y);
        await page.waitForTimeout(300);
        ok(!(await cursor()).hidden, 'süre dolmadan imleç görünür');
        await page.waitForTimeout(500);
        let c = await cursor();
        ok(c.hidden && c.css === 'none', `oynarken 600 ms hareketsiz → imleç gizli (cursor: ${c.css})`);
        await page.mouse.move(box.x + 20, box.y + 10);
        c = await cursor();
        ok(!c.hidden && c.css !== 'none', `fare kıpırdayınca imleç geri geldi (${c.css})`);

        await pause();
        await page.mouse.move(box.x + 25, box.y + 10);
        await page.waitForTimeout(900);
        ok(!(await cursor()).hidden, 'duraklatılmışken imleç gizlenmiyor');

        await play();
        const btn = await page.evaluate(() => { const r = document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        await page.mouse.move(btn.x, btn.y);
        await page.waitForTimeout(900);
        ok(!(await cursor()).hidden, 'imleç bir kontrolün üzerindeyken gizlenmiyor');

        await page.evaluate(() => { const el = document.getElementById('player'); el.options = { ...el.options, cursorHideDelayMs: false }; });
        await page.waitForTimeout(200);
        await play();
        await page.mouse.move(box.x, box.y);
        await page.waitForTimeout(900);
        ok(!(await cursor()).hidden, 'cursorHideDelayMs: false → hiç gizlenmiyor');

        // Varsayılan 5 sn.
        await page.evaluate(() => { const el = document.getElementById('player'); const { cursorHideDelayMs, ...rest } = el.options; el.options = rest; });
        await page.waitForTimeout(200);
        await play();
        await page.mouse.move(box.x + 3, box.y);
        await page.waitForTimeout(4500);
        const early = (await cursor()).hidden;
        await page.waitForTimeout(800);
        ok(!early && (await cursor()).hidden, 'varsayılan: 4,5 sn\'de görünür, 5 sn sonra gizli');
    } finally {
        await page.close();
    }
}

async function testLoadingRing(browser) {
    console.log('\n[1j] İstek üzerine: medya yüklenirken sol grubun kenarında dönen ışık (yükleme halkası), oynayınca kayboluyor');
    const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
    try {
        await page.goto(`${BASE}/`);
        await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
        const ringOn = () => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-group-left').hasAttribute('data-loading'));
        ok(!(await ringOn()), 'başlangıçta (duraklatılmış) halka yok');

        // Video isteklerini geciktir → oynat'a basınca buffer beklenir.
        await page.route('**/sample.mp4*', async (route) => {
            await new Promise((r) => setTimeout(r, 1500));
            await route.continue();
        });
        await page.evaluate(() => { document.getElementById('player').options = { src: '/sample.mp4?slow', muted: true, preload: 'none' }; });
        await page.waitForTimeout(200);
        await page.evaluate(() => { void document.getElementById('player').shadowRoot.querySelector('video').play().catch(() => {}); });
        await page.waitForTimeout(700);
        const during = await ringOn();
        const anim = await page.evaluate(() => {
            const span = document.getElementById('player').shadowRoot.querySelector('.hp-loading-ring-mask > span');
            return { state: getComputedStyle(span).animationPlayState, opacity: getComputedStyle(span.closest('.hp-loading-ring')).opacity };
        });
        ok(during && anim.state === 'running', `yüklenirken halka açık ve dönüyor ${JSON.stringify(anim)}`);
        await page.waitForFunction(() => { const v = document.getElementById('player').shadowRoot.querySelector('video'); return !v.paused && v.readyState >= 3; }, { timeout: 15000 });
        await page.waitForTimeout(300);
        ok(!(await ringOn()), 'video oynamaya başlayınca halka kayboldu');
    } finally {
        await page.close();
    }
}

async function testChromeStaysWhenPaused(browser) {
    console.log('\n[1g] İstek üzerine: oynarken kurulan gizleme zamanlayıcısı varken durdurulursa kontroller açık kalıyor');
    const page = await openBase(browser);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, { timeout: 5000 });
    await page.mouse.move(2, 2);
    await page.evaluate(async () => { const v = document.getElementById('player').shadowRoot.querySelector('video'); v.muted = true; await v.play().catch(() => {}); });
    await page.waitForTimeout(600); // gizleme zamanlayıcısı (1200ms) beklemede
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
    await page.waitForTimeout(1500);
    const opacity = await page.evaluate(() => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="control-bar"]').parentElement).opacity);
    ok(opacity === '1', `durdurulunca kontroller açık kaldı (opacity ${opacity})`);
    await page.close();
}

async function testFullscreenContainCentered(browser) {
    console.log('\n[10b] İstek üzerine: tam ekranda video ekrana tam sığıyor (contain), dikeyde/yatayda ortalı, kontroller ekran içinde');
    for (const [w, h, name] of [[390, 844, 'dikey'], [1600, 600, 'geniş yatay']]) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        await page.goto(`${BASE}/`);
        await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video')?.readyState >= 1);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Tam ekran"]').click());
        await page.waitForTimeout(600);
        const r = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const v = root.querySelector('video');
            const a = root.querySelector('.video-area').getBoundingClientRect();
            const bar = root.querySelector('[part="control-bar"]').getBoundingClientRect();
            const s = Math.min(a.width / v.videoWidth, a.height / v.videoHeight);
            return { fills: Math.round(a.width) === innerWidth && Math.round(a.height) === innerHeight, fit: getComputedStyle(v).objectFit, offX: (a.width - v.videoWidth * s) / 2, offY: (a.height - v.videoHeight * s) / 2, barInside: bar.bottom <= innerHeight + 1 };
        });
        ok(r.fills && r.fit === 'contain' && r.barInside, `${name}: alan ekranı dolduruyor, contain, kontroller ekran içinde`);
        ok(r.offX >= 0 && r.offY >= 0 && (r.offX < 1 || r.offY < 1), `${name}: görüntü tek eksende tam sığıp diğerinde ortalı (x ${r.offX.toFixed(0)} / y ${r.offY.toFixed(0)})`);
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForTimeout(400);
        const after = await page.evaluate(() => { const a = document.getElementById('player').shadowRoot.querySelector('.video-area').getBoundingClientRect(); return Math.abs(a.width / a.height - 16 / 9) < 0.02; });
        ok(after, `${name}: tam ekrandan çıkınca 16:9 düzene döndü`);
        await page.close();
    }
}

async function testChipSurfaceChangesPerPreset(browser) {
    // Renk-varyantı preset'i yok (accent her preset'te beyaz) — preset'ler
    // STİLİ değiştiriyor. glass-dark'ın asıl farkı buton grubu yüzeyinin
    // koyu tonlu olması; bunu gerçek computed arkaplandan doğruluyoruz.
    console.log('\n[2] glass-dark seçilince buton grubu yüzeyi (computed) gerçekten koyulaşıyor mu?');
    const page = await openBase(browser);
    const getGroupBg = () =>
        page.evaluate(() => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('.hp-group')).backgroundColor);

    await page.evaluate(() => document.getElementById('player').removeAttribute('theme'));
    const lightBg = await getGroupBg();

    await page.evaluate(() => document.getElementById('player').setAttribute('theme', 'glass-dark'));
    const darkBg = await getGroupBg();

    ok(lightBg.startsWith('rgba(255, 255, 255'), `varsayılan (glass-light) grup yüzeyi beyaz tonlu (${lightBg})`);
    ok(darkBg.startsWith('rgba(10, 10, 14'), `glass-dark grup yüzeyi koyu tonlu (${darkBg})`);
    await page.close();
}

async function testOptionsDoesNotClearAttributeTheme(browser) {
    console.log('\n[3] KRİTİK REGRESYON: attribute ile set edilen tema, theme alanı İÇERMEYEN bir .options = {...} çağrısıyla sıfırlanmamalı');
    const page = await openBase(browser);

    await page.evaluate(() => document.getElementById('player').setAttribute('theme', 'neo-dark'));
    const before = await page.evaluate(() => document.getElementById('player').getAttribute('data-theme'));
    ok(before === 'neo-dark', `attribute sonrası data-theme="${before}"`);

    // Tema alanı OLMAYAN bir .options güncellemesi — eskiden bu, attribute'tan
    // gelen temayı sessizce siliyordu (options setter attribute'larla hiç
    // birleşmiyordu).
    await page.evaluate(() => {
        document.getElementById('player').options = { muted: true, src: '/sample.mp4' };
    });
    const after = await page.evaluate(() => document.getElementById('player').getAttribute('data-theme'));
    ok(after === 'neo-dark', `theme alanı olmayan .options sonrası data-theme HÂLÂ "neo-dark" (${after})`);
    await page.close();
}

async function testExplicitOptionsThemeOverridesAttribute(browser) {
    console.log('\n[4] .options içinde AÇIKÇA verilen theme, attribute\'u override etmeli (öncelik: explicit JS > attribute)');
    const page = await openBase(browser);
    await page.evaluate(() => document.getElementById('player').setAttribute('theme', 'mono'));
    await page.evaluate(() => {
        document.getElementById('player').options = { muted: true, theme: 'glass-dark' };
    });
    const dataTheme = await page.evaluate(() => document.getElementById('player').getAttribute('data-theme'));
    ok(dataTheme === 'glass-dark', `.options.theme açıkça verildiğinde attribute'u override etti (${dataTheme})`);
    await page.close();
}

async function testRemovingThemeAttributeReverts(browser) {
    console.log('\n[5] theme attribute\'u kaldırılınca data-theme de kaldırılıyor mu (varsayılana dönüş)?');
    const page = await openBase(browser);
    await page.evaluate(() => document.getElementById('player').setAttribute('theme', 'glass-dark'));
    await page.evaluate(() => document.getElementById('player').removeAttribute('theme'));
    const dataTheme = await page.evaluate(() => document.getElementById('player').getAttribute('data-theme'));
    ok(dataTheme === null, `theme attribute kaldırılınca data-theme de kaldırıldı (${dataTheme})`);
    await page.close();
}

async function testDefaultThemeSeekBarIsVisible(browser) {
    console.log('\n[6] KRİTİK REGRESYON: theme HİÇ verilmezken (varsayılan glass-light) seek bar gerçekten görünür renklerde mi?');
    const page = await openBase(browser);
    // Gerçek bug (bulundu): `@import "tailwindcss" prefix(hp)` @theme
    // içindeki değişken adlarını da prefixliyor (`--color-accent` →
    // `--hp-color-accent`), bu yüzden eski `--color-accent:
    // var(--hp-color-accent, #ff5a1f)` kendi kendine referans veren bir
    // custom property'ye derleniyordu (guaranteed-invalid) — preset
    // AKTİF DEĞİLKEN `bg-accent`/`bg-on-surface/*` kullanan HER şey
    // (seekbar played/thumb, settings menü metni, loading spinner, error
    // screen, playlist/story/markers metinleri...) tamamen saydamdı.
    // Önceki test (#2) bunu kaçırmıştı çünkü yalnızca "preset değişince
    // DEĞİŞİYOR mu" kontrol ediyordu — ikisi de boş string olsa bile
    // "farklı" sayılırdı. Bu test varsayılan durumda GERÇEK, saydam
    // OLMAYAN bir renk olduğunu doğruluyor.
    await page.evaluate(() => {
        document.getElementById('player').shadowRoot.querySelector('video').currentTime = 2;
    });
    await page.waitForTimeout(100);
    const colors = await page.evaluate(() => {
        const seekBar = document.getElementById('player').shadowRoot.querySelector('[part="seek-bar"]');
        const track = seekBar.firstElementChild;
        const buffered = track.children[0];
        const played = track.children[1];
        return {
            buffered: getComputedStyle(buffered).backgroundColor,
            played: getComputedStyle(played).backgroundColor,
        };
    });
    ok(colors.played !== 'rgba(0, 0, 0, 0)', `played bar saydam DEĞİL (${colors.played})`);
    ok(colors.buffered !== 'rgba(0, 0, 0, 0)', `buffered bar saydam DEĞİL (${colors.buffered})`);
    await page.close();
}

async function testSettingsPanelBackgroundStaysOpaqueOnHover(browser) {
    console.log('\n[7] KRİTİK REGRESYON: ayarlar menüsü paneli, içindeki bir satırın üzerine gelince (hover) beyaza dönmüyor mu?');
    const page = await openBase(browser);
    // Gerçek bug (bulundu): `:hover` pseudo-class'ı specificity'yi artırır —
    // `.hp-chip:hover` (0,2,0) düz `.hp-chip-panel` (0,1,0)'dan HER ZAMAN
    // kazanır, kaynak sırasından bağımsız. Fare panelin (ya da içindeki
    // herhangi bir satırın) üzerine gelince panel kendi `:hover` durumuna
    // giriyor ve `.hp-chip:hover`'ın `--hp-chip-bg-hover`'ı (varsayılan glass-light'ta
    // beyazımsı) panelin opak arkaplanının ÜSTÜNE çıkıyordu — panel önce
    // koyu görünüp fare değer değmez beyaza dönüyordu.
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').click());
    await page.waitForTimeout(100);

    const bgBefore = await page.evaluate(() =>
        getComputedStyle(document.getElementById('player').shadowRoot.querySelector('.hp-chip-panel')).backgroundColor
    );
    const row = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('.hp-chip-panel button'));
    const box = await row.asElement().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);
    const bgDuringHover = await page.evaluate(() =>
        getComputedStyle(document.getElementById('player').shadowRoot.querySelector('.hp-chip-panel')).backgroundColor
    );

    ok(bgBefore === bgDuringHover, `panel arkaplanı satır hover'ında DEĞİŞMİYOR (önce="${bgBefore}", hover sırasında="${bgDuringHover}")`);
    // Tam `--hp-panel-bg` değerini (ayarlanabilir bir tasarım parametresi,
    // test'i kırılgan yapmasın) değil, sadece `--hp-chip-bg-hover`'ın
    // DEVREYE GİRMEDİĞİNİ doğruluyoruz — bug tam olarak buydu. (Panel artık
    // glass-light'ta kendisi de beyaz tonlu, bu yüzden "beyaz içermesin"
    // kontrolü yerine gerçek chip-hover değeriyle karşılaştırılıyor.)
    const chipHoverBg = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--hp-chip-bg-hover)';
        document.getElementById('player').shadowRoot.appendChild(probe);
        const bg = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return bg;
    });
    ok(bgDuringHover !== chipHoverBg, `panel hover sırasında --hp-chip-bg-hover'a DÖNMEDİ (panel="${bgDuringHover}", chip-hover="${chipHoverBg}")`);
    await page.close();
}

async function testPanelAndTooltipFollowTheme(browser) {
    console.log('\n[7b] İstek üzerine: ayarlar paneli ve tooltip temayı takip ediyor mu (glass-light → açık, glass-dark → koyu)?');
    const page = await openBase(browser);
    const read = () =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const panel = root.querySelector('.hp-chip-panel');
            const row = panel.querySelector('button');
            const tip = root.querySelector('.hp-tooltip');
            return {
                panelBg: getComputedStyle(panel).backgroundColor,
                rowText: getComputedStyle(row).color,
                tipBg: getComputedStyle(tip).backgroundColor,
                tipText: getComputedStyle(tip).color,
            };
        });
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').click());
    await page.waitForTimeout(100);

    const light = await read();
    ok(light.panelBg.startsWith('rgba(255, 255, 255'), `glass-light: panel beyaz tonlu (${light.panelBg})`);
    ok(light.rowText === 'rgb(21, 23, 28)', `glass-light: panel satır metni koyu (${light.rowText})`);
    ok(light.tipBg.startsWith('rgba(255, 255, 255'), `glass-light: tooltip beyaz tonlu (${light.tipBg})`);
    ok(light.tipText === 'rgb(21, 23, 28)', `glass-light: tooltip metni koyu (${light.tipText})`);

    await page.evaluate(() => document.getElementById('player').setAttribute('theme', 'glass-dark'));
    // .hp-chip'in 160ms background-color transition'ı bitsin — aksi halde
    // computed değer geçişin başlangıcını (eski tema) döndürüyor.
    await page.waitForTimeout(300);
    const dark = await read();
    ok(!dark.panelBg.startsWith('rgba(255, 255, 255'), `glass-dark: panel koyu tonlu (${dark.panelBg})`);
    ok(dark.rowText === 'rgb(255, 255, 255)', `glass-dark: panel satır metni beyaz (${dark.rowText})`);
    ok(!dark.tipBg.startsWith('rgba(255, 255, 255'), `glass-dark: tooltip koyu (${dark.tipBg})`);
    ok(dark.tipText === 'rgb(255, 255, 255)', `glass-dark: tooltip metni beyaz (${dark.tipText})`);
    await page.close();
}

async function testControlBarHasNoBackgroundButGroupsDo(browser) {
    console.log('\n[8] İstek üzerine: `[part="control-bar"]`in kendisi arkaplansız, sol/sağ buton grupları (`.hp-group`) kendi transparan pill yüzeyini taşıyor mu?');
    const page = await openBase(browser);
    const result = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const bar = root.querySelector('[part="control-bar"]');
        // Yalnızca GÖRÜNEN gruplar — kompakt düzenin tam ekran grubu geniş player'da gizli (display:none) duruyor.
        const groups = Array.from(root.querySelectorAll('.hp-group')).filter((g) => getComputedStyle(g).display !== 'none');
        const barBg = getComputedStyle(bar).backgroundColor;
        const groupBgs = Array.from(groups).map((g) => getComputedStyle(g).backgroundColor);
        return { barBg, groupCount: groups.length, groupBgs };
    });
    ok(result.barBg === 'rgba(0, 0, 0, 0)', `control-bar'ın kendisi arkaplansız/transparan (${result.barBg})`);
    ok(result.groupCount === 2, `tam 2 buton grubu var (sol+sağ) (${result.groupCount})`);
    ok(result.groupBgs.every((bg) => bg !== 'rgba(0, 0, 0, 0)'), `her iki grubun da kendi (saydam-ama-boş-olmayan) arkaplanı var (${JSON.stringify(result.groupBgs)})`);
    await page.close();
}

async function testVolumeSliderAlignsWithSettingsPanel(browser) {
    console.log('\n[9] Ses çubuğu artık ayarlar menüsüyle AYNI boşlukla (mb-2) açılıyor mu? (istek üzerine: "hizası ayarlar menüsü ile aynı olmalı")');
    const page = await openBase(browser);
    const result = await page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const settingsBtn = root.querySelector('[aria-label="Ayarlar"]');
        settingsBtn.click();
        const panel = root.querySelector('.hp-chip-panel');
        const slider = root.querySelector('[part="volume-slider"]');
        slider.style.opacity = '1'; // normalde yalnızca JS mouseenter ile açılıyor
        const panelGap = settingsBtn.getBoundingClientRect().top - panel.getBoundingClientRect().bottom;
        const volBtn = root.querySelector('[part="volume-button"]');
        const sliderGap = volBtn.getBoundingClientRect().top - slider.getBoundingClientRect().bottom;
        return { panelGap, sliderGap };
    });
    ok(Math.abs(result.panelGap - result.sliderGap) < 0.5, `ayarlar paneli (${result.panelGap}px) ve ses çubuğu (${result.sliderGap}px) AYNI boşlukla açılıyor`);
    await page.close();
}

async function testFullscreenEnlargesControls(browser) {
    console.log('\n[10] Fullscreen moduna geçince kontrol boyutları (--hp-ctrl-btn-size/--hp-seek-hit-h) büyüyor mu?');
    const page = await openBase(browser);
    const before = await page.evaluate(() =>
        getComputedStyle(document.getElementById('player')).getPropertyValue('--hp-ctrl-btn-size').trim()
    );
    const fsBtn = await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Tam ekran"]'));
    const box = await fsBtn.asElement().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
        const el = document.getElementById('player');
        const cs = getComputedStyle(el);
        return {
            isFullscreen: document.fullscreenElement === el,
            btnSize: cs.getPropertyValue('--hp-ctrl-btn-size').trim(),
            seekHitH: cs.getPropertyValue('--hp-seek-hit-h').trim(),
        };
    });
    ok(after.isFullscreen, 'fullscreen\'e geçti');
    ok(before === '32px', `fullscreen ÖNCESİ varsayılan buton boyutu 32px (${before})`);
    ok(after.btnSize === '44px', `fullscreen SIRASINDA buton boyutu büyüdü: 44px (${after.btnSize})`);
    ok(after.seekHitH === '26px', `fullscreen SIRASINDA seek bar tıklama alanı büyüdü: 26px (${after.seekHitH})`);
    await page.evaluate(() => document.exitFullscreen().catch(() => {}));
    await page.close();
}

(async () => {
    const browser = await chromium.launch();
    try {
        await testPresetsApplyDataTheme(browser);
        await testSeekBarHoverTime(browser);
        await testMiniProgress(browser);
        await testSeekThumbAndHoverDot(browser);
        await testMediaElementIosAttrsAndErrors(browser);
        await testChromeStaysWhileHovered(browser);
        await testTooltipBehindOpenMenu(browser);
        await testCursorHide(browser);
        await testLoadingRing(browser);
        await testChromeStaysWhenPaused(browser);
        await testChipSurfaceChangesPerPreset(browser);
        await testOptionsDoesNotClearAttributeTheme(browser);
        await testExplicitOptionsThemeOverridesAttribute(browser);
        await testRemovingThemeAttributeReverts(browser);
        await testDefaultThemeSeekBarIsVisible(browser);
        await testSettingsPanelBackgroundStaysOpaqueOnHover(browser);
        await testPanelAndTooltipFollowTheme(browser);
        await testControlBarHasNoBackgroundButGroupsDo(browser);
        await testVolumeSliderAlignsWithSettingsPanel(browser);
        await testFullscreenEnlargesControls(browser);
        await testFullscreenContainCentered(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
