// HopeCorePlayer — paylaşım (kopyala, ?t=, ağlar, ?t= ile başlatma), ısı haritası "en çok izlenen an" etiketi,
// sesli betimleme (HLS betimleme izi ve ayrı anlatım dosyası).
// Test dosyaları: public/hls-ad + public/ad-narration.m4a (scripts/make-audio-description.mjs).
import { launchBrowser } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

async function open(browser, query, viewport = { width: 960, height: 540 }) {
    const context = await browser.newContext({ viewport });
    // Ağ paylaşım pencereleri dışarı çıkmasın.
    await context.route(/^https:\/\/(wa\.me|x\.com|www\.facebook\.com|www\.linkedin\.com|t\.me|www\.reddit\.com)\//, (r) => r.fulfill({ contentType: 'text/html', body: '<p>share</p>' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => !/ResizeObserver loop/.test(String(e)) && errors.push(String(e)));
    page.__errors = errors;
    await page.goto(`${BASE}/?${query}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => {
        window.__ev = [];
        const el = document.getElementById('player');
        for (const t of ['hp:share', 'hp:audiodescription']) el.addEventListener(t, (e) => window.__ev.push({ t, ...e.detail }));
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000, polling: 50 });
    await page.waitForTimeout(400);
    return { page, context };
}

const sr = (page, fn, arg) => page.evaluate(fn, arg);

async function testShare(browser) {
    console.log('\n[1] Paylaşım: panel, "bu andan başlat" (?t=), kopyala, ağlar, Escape');
    const { page, context } = await open(browser, 'feature=share');
    try {
        const shareBtn = () => sr(page, () => document.getElementById('player').shadowRoot.querySelector('[aria-label="Paylaş"]')?.click());
        // t=0 → zaman seçeneği yok.
        await shareBtn();
        let s = await sr(page, () => {
            const p = document.getElementById('player').shadowRoot.querySelector('[part="share"]');
            return { open: !!p, url: p?.querySelector('input[type=text]')?.value, check: !!p?.querySelector('input[type=checkbox]'), nets: [...(p?.querySelectorAll('.hp-share-net') ?? [])].map((b) => b.dataset.network) };
        });
        ok(s.open && new URL(s.url).searchParams.get('feature') === 'share' && !new URL(s.url).searchParams.has('t'), `panel açıldı, sayfa adresi, başta zaman yok (${s.url})`);
        ok(!s.check, '0. saniyede "başlat" seçeneği yok');
        ok(['x', 'whatsapp', 'facebook', 'linkedin', 'telegram', 'reddit', 'email'].every((n) => s.nets.includes(n)), `ağlar: ${s.nets.join(', ')}`);
        await page.keyboard.press('Escape');
        ok(!(await sr(page, () => !!document.getElementById('player').shadowRoot.querySelector('[part="share"]'))), 'Escape → kapandı');

        // 3. saniyede → ?t=3, seçenek işaretli.
        await sr(page, () => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 3.4));
        await page.waitForTimeout(300);
        await shareBtn();
        s = await sr(page, () => {
            const p = document.getElementById('player').shadowRoot.querySelector('[part="share"]');
            return { url: p.querySelector('input[type=text]').value, checked: p.querySelector('input[type=checkbox]')?.checked, label: p.querySelector('.hp-share-start')?.textContent };
        });
        ok(new URL(s.url).searchParams.get('t') === '3' && s.checked && s.label === '0:03 itibarıyla başlat', `bu andan: ${s.url} ("${s.label}")`);
        await sr(page, () => {
            const box = document.getElementById('player').shadowRoot.querySelector('[part="share"] input[type=checkbox]');
            box.click();
        });
        s.url2 = await sr(page, () => document.getElementById('player').shadowRoot.querySelector('[part="share"] input[type=text]').value);
        ok(!new URL(s.url2).searchParams.has('t'), `işaret kalkınca zaman yok (${s.url2})`);
        await sr(page, () => document.getElementById('player').shadowRoot.querySelector('[part="share"] input[type=checkbox]').click());

        // Kopyala.
        await sr(page, () => document.getElementById('player').shadowRoot.querySelector('.hp-share-copy').click());
        await page.waitForTimeout(300);
        s = await sr(page, () => ({ txt: document.getElementById('player').shadowRoot.querySelector('.hp-share-copy').textContent, ev: window.__ev.filter((e) => e.t === 'hp:share') }));
        ok(s.txt === 'Kopyalandı' && s.ev.some((e) => e.action === 'copy' && e.time === 3), `kopyala → "${s.txt}", hp:share copy (time 3)`);

        // WhatsApp → yeni pencere wa.me, metinde bağlantı.
        const popupP = context.waitForEvent('page');
        await sr(page, () => document.getElementById('player').shadowRoot.querySelector('.hp-share-net[data-network="whatsapp"]').click());
        const popup = await popupP;
        await popup.waitForLoadState().catch(() => {});
        const wa = popup.url();
        ok(wa.startsWith('https://wa.me/?text=') && decodeURIComponent(wa).includes('t=3'), `WhatsApp: ${decodeURIComponent(wa).slice(0, 80)}…`);
        await popup.close();

        // preventDefault → pencere açılmaz.
        await sr(page, () => {
            document.getElementById('player').addEventListener('hp:share', (e) => e.detail.action === 'x' && e.preventDefault());
        });
        const pages = context.pages().length;
        await sr(page, () => document.getElementById('player').shadowRoot.querySelector('.hp-share-net[data-network="x"]').click());
        await page.waitForTimeout(400);
        ok(context.pages().length === pages, 'hp:share iptal → X penceresi açılmadı');
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await context.close();
    }

    for (const [param, want] of [
        ['t=5', 5],
        ['t=0:07', 7],
        ['t=4s', 4],
    ]) {
        const { page: p2, context: c2 } = await open(browser, `feature=share&${param}`);
        try {
            await p2.waitForTimeout(300);
            const t = await sr(p2, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
            ok(Math.abs(t - want) < 0.3, `?${param} → ${t.toFixed(2)}. saniyeden başladı`);
        } finally {
            await c2.close();
        }
    }
}

async function testHeatmapPeak(browser) {
    console.log('\n[2] Isı haritası: tepe noktasının üzerine gelince "En çok izlenen an"');
    const { page, context } = await open(browser, 'feature=heatmap');
    try {
        const hover = async (ratio) => {
            const b = await sr(page, () => {
                const r = document.getElementById('player').shadowRoot.querySelector('.hp-seekbar').getBoundingClientRect();
                return { x: r.x, y: r.y + r.height / 2, w: r.width };
            });
            await page.mouse.move(b.x + b.w * ratio, b.y);
            await page.waitForTimeout(150);
            return sr(page, () => document.getElementById('player').shadowRoot.querySelector('[part="seek-time"]')?.textContent);
        };
        // Veri [2,3,5,9,20,12,6,8,15,4] — tepe 5. dilim (4–5. sn).
        let text = await hover(0.47);
        ok(text === 'En çok izlenen an · 0:04', `tepe üstü: "${text}"`);
        text = await hover(0.42);
        ok(text === 'En çok izlenen an · 0:04', `dilimin içinde de: "${text}"`);
        text = await hover(0.15);
        ok(!!text && !text.includes('En çok'), `başka yerde düz zaman: "${text}"`);
        const visible = await sr(page, () => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('.hp-heatmap-peak')).visibility);
        ok(visible === 'hidden', 'tepe işareti görünmez (yalnızca etiket)');
    } finally {
        await context.close();
    }
}

/** Ayarlar menüsünde bir satıra / seçeneğe metinle tıkla. */
async function settingsPick(page, row, item) {
    await sr(page, () => document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').click());
    await page.waitForTimeout(150);
    const clicked = await sr(
        page,
        ({ row, item }) => {
            const r = document.getElementById('player').shadowRoot;
            const find = (txt) => [...r.querySelectorAll('[part="settings-menu"] button, .hp-settings button, button')].find((b) => b.textContent.trim().startsWith(txt));
            const rb = find(row);
            if (!rb) return 'satır yok';
            rb.click();
            const ib = [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === item);
            if (!ib) return 'seçenek yok';
            ib.click();
            return 'ok';
        },
        { row, item }
    );
    await page.waitForTimeout(300);
    return clicked;
}

async function testAdStream(browser) {
    console.log('\n[3] Sesli betimleme — yayının izi (HLS CHARACTERISTICS describes-video)');
    const { page, context } = await open(browser, 'feature=ad-hls');
    try {
        await page.waitForFunction(() => document.getElementById('player').hls?.audioTracks?.length === 2, null, { timeout: 10000, polling: 50 }).catch(() => {});
        const track = () => sr(page, () => document.getElementById('player').hls?.audioTrack);
        ok((await track()) === 0, 'başta normal ses izi');
        let r = await settingsPick(page, 'Sesli betimleme', 'Açık');
        await page.waitForFunction(() => document.getElementById('player').hls?.audioTrack === 1, null, { timeout: 5000, polling: 50 }).catch(() => {});
        let s = await sr(page, () => ({ ev: window.__ev.filter((e) => e.t === 'hp:audiodescription'), store: localStorage.getItem('hp-audio-description') }));
        ok(r === 'ok' && (await track()) === 1 && s.ev.some((e) => e.enabled && e.source === 'stream') && s.store === '1', `ayarlar → Açık: betimleme izine geçti, tercih kaydedildi (${r})`);
        // Ses menüsü: izin adı (alt menü açılınca listelenir).
        await sr(page, () => document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').click());
        await page.waitForTimeout(150);
        await sr(page, () => [...document.getElementById('player').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Ses') && !b.textContent.includes('betimleme'))?.click());
        await page.waitForTimeout(150);
        const labels = await sr(page, () => {
            const r2 = document.getElementById('player').shadowRoot;
            return [...r2.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /Türkçe/.test(t));
        });
        await page.keyboard.press('Escape');
        ok(labels.some((l) => /betimleme/.test(l)), `ses izi adı: ${labels.join(' / ')}`);
        // Kapat → normal ize döner.
        await sr(page, () => document.getElementById('player').setAudioDescription(false));
        await page.waitForFunction(() => document.getElementById('player').hls?.audioTrack === 0, null, { timeout: 5000, polling: 50 }).catch(() => {});
        ok((await track()) === 0, 'setAudioDescription(false) → normal ize döndü');
        // Açıkken izleyici ses menüsünden normal izi seçerse betimleme kapanır (geri çevrilmez).
        await sr(page, () => document.getElementById('player').setAudioDescription(true));
        await page.waitForFunction(() => document.getElementById('player').hls?.audioTrack === 1, null, { timeout: 5000, polling: 50 }).catch(() => {});
        // Betimleme izine geçiş tamamlansın (izleyici bu kadar hızlı değiştiremez).
        await page.waitForTimeout(1000);
        await sr(page, () => (document.getElementById('player').hls.audioTrack = 0));
        await page.waitForTimeout(800);
        s = await sr(page, () => ({ track: document.getElementById('player').hls.audioTrack, last: window.__ev.filter((e) => e.t === 'hp:audiodescription').at(-1) }));
        ok(s.track === 0 && s.last?.enabled === false, `izleyici normal izi seçti → betimleme kapandı (iz ${s.track})`);
    } finally {
        await context.close();
    }

    // Kayıtlı tercih: yeni sayfada açık başlar.
    const { page: p2, context: c2 } = await open(browser, 'feature=ad-hls');
    try {
        await p2.evaluate(() => localStorage.setItem('hp-audio-description', '1'));
        await p2.reload();
        await p2.waitForFunction(() => document.getElementById('player')?.hls?.audioTrack === 1, null, { timeout: 10000, polling: 50 }).catch(() => {});
        ok((await sr(p2, () => document.getElementById('player').hls?.audioTrack)) === 1, 'kayıtlı tercih → betimleme izinde başladı');
        await p2.evaluate(() => localStorage.removeItem('hp-audio-description'));
    } finally {
        await c2.close();
    }
}

async function testAdFile(browser) {
    console.log('\n[4] Sesli betimleme — ayrı anlatım dosyası (videoyla eş zamanlı)');
    const { page, context } = await open(browser, 'feature=ad-file');
    try {
        const audio = () =>
            sr(page, () => {
                const r = document.getElementById('player').shadowRoot;
                const a = r.querySelector('audio[data-hp-audio-description]');
                const v = r.querySelector('video');
                return a ? { paused: a.paused, diff: Math.abs(a.currentTime - v.currentTime), vol: a.volume, muted: a.muted, vPaused: v.paused } : null;
            });
        ok((await audio()) === null, 'kapalıyken anlatım yok');
        const r = await settingsPick(page, 'Sesli betimleme', 'Açık');
        await page.waitForTimeout(300);
        ok(r === 'ok' && (await audio()) !== null && (await sr(page, () => window.__ev.some((e) => e.enabled && e.source === 'file'))), `Açık → anlatım hazır (hp:audiodescription file)`);
        await sr(page, () => {
            const el = document.getElementById('player');
            el.shadowRoot.querySelector('video').muted = false;
            el.shadowRoot.querySelector('video').volume = 0.5;
            return el.play();
        });
        await page.waitForTimeout(2000);
        let s = await audio();
        ok(s && !s.paused && s.diff < 0.4, `oynarken anlatım çalıyor, fark ${s?.diff.toFixed(2)} sn`);
        ok(s && Math.abs(s.vol - 0.5) < 0.01 && !s.muted, `ses düzeyi player'ı izliyor (${s?.vol})`);
        await sr(page, () => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 6));
        await page.waitForTimeout(1200);
        s = await audio();
        ok(s && s.diff < 0.4, `sarınca hizalandı (fark ${s?.diff.toFixed(2)} sn)`);
        await sr(page, () => document.getElementById('player').pause());
        await page.waitForTimeout(300);
        s = await audio();
        ok(s && s.paused, 'duraklatınca anlatım da durdu');
        await sr(page, () => document.getElementById('player').setAudioDescription(false));
        ok((await audio()) === null, 'kapatınca anlatım kaldırıldı');
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    } finally {
        await page.evaluate(() => localStorage.removeItem('hp-audio-description')).catch(() => {});
        await context.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testShare(browser);
        await testHeatmapPeak(browser);
        const probe = await browser.newPage();
        await probe.goto(`${BASE}/`);
        const mse = await probe.evaluate(() => typeof MediaSource !== 'undefined' || 'ManagedMediaSource' in window);
        await probe.close();
        if (mse) await testAdStream(browser);
        else console.log('\n(bu tarayıcıda MSE yok — HLS betimleme izi testi atlandı)');
        await testAdFile(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
