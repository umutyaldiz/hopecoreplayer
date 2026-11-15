// HopeCorePlayer — klip oluştur ve paylaş (clips): seçici, tutamaçlar, bağlantı, ?clip= ile açılış ve döngü.
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

async function open(browser, clips, query = '') {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.goto(`${BASE}/${query}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((clips) => {
        window.__ev = [];
        const el = document.getElementById('player');
        el.addEventListener('hp:clip', (e) => {
            window.__ev.push(e.detail);
            if (window.__cancelCopy && e.detail.state === 'copy') e.preventDefault();
        });
        el.options = { src: '/sample-30s.mp4', muted: true, clips };
    }, clips);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    return page;
}

const editor = (page) =>
    page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const panel = root.querySelector('[part="clip"]');
        const range = root.querySelector('[part="clip-range"]:not([data-static])');
        return {
            open: !!panel,
            url: panel?.querySelector('.hp-clip-link input')?.value ?? null,
            values: panel ? [...panel.querySelectorAll('.hp-clip-value')].map((x) => x.textContent) : [],
            length: panel?.querySelector('.hp-clip-meta span')?.textContent ?? null,
            nets: panel ? [...panel.querySelectorAll('.hp-clip-networks .hp-clip-net')].map((b) => b.textContent) : [],
            range: range ? { left: parseFloat(range.style.left), width: parseFloat(range.style.width) } : null,
            events: window.__ev.map((e) => `${e.state}:${e.start}-${e.end}`),
        };
    });

const clickIn = (page, sel, i = 0) => page.evaluate(({ sel, i }) => document.getElementById('player').shadowRoot.querySelectorAll(sel)[i].click(), { sel, i });

async function testEditor(browser) {
    console.log('\n[1] Klip butonu seçiciyi açıyor: aralık o anki saniyeden, bağlantı ?clip=, ±1 sn, min / maks');
    const page = await open(browser, { defaultDuration: 10, minDuration: 3, maxDuration: 12, networks: ['x', 'whatsapp'] });
    try {
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 5));
        await page.waitForTimeout(300);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Klip oluştur"]').click());
        await page.waitForTimeout(200);
        let e = await editor(page);
        ok(e.open && e.values.join(' ') === '0:05 0:15' && e.length === 'Uzunluk 0:10', `seçici: ${e.values.join(' – ')}, ${e.length}`);
        ok(e.url && new URL(e.url).searchParams.get('clip') === '5-15', `bağlantı ${e.url}`);
        ok(e.range && Math.abs(e.range.left - 16.67) < 0.5 && Math.abs(e.range.width - 33.3) < 0.6, `seek bar aralığı ${JSON.stringify(e.range)}`);
        ok(e.nets.join(',') === 'X,WhatsApp' && e.events.includes('open:5-15'), `ağlar ${e.nets.join(', ')}, hp:clip open`);
        // Bitiş +1 → 16; maks 12 sn → başlangıç da kayar
        await clickIn(page, '.hp-clip-time:nth-child(2) .hp-clip-net', 1);
        await clickIn(page, '.hp-clip-time:nth-child(2) .hp-clip-net', 1);
        await clickIn(page, '.hp-clip-time:nth-child(2) .hp-clip-net', 1);
        e = await editor(page);
        ok(e.values.join(' ') === '0:06 0:18', `maks 12 sn: bitiş artınca başlangıç kaydı (${e.values.join(' – ')})`);
        for (let i = 0; i < 12; i++) await clickIn(page, '.hp-clip-time:nth-child(1) .hp-clip-net', 1);
        e = await editor(page);
        ok(e.values.join(' ') === '0:18 0:21', `başlangıç ilerleyince bitiş de kayıyor, min 3 sn korunuyor (${e.values.join(' – ')})`);
        // Kopyala (iptal edilebilir)
        await page.evaluate(() => (window.__cancelCopy = true));
        await clickIn(page, '.hp-clip-copy');
        await page.waitForTimeout(150);
        const copyText = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-clip-copy').textContent);
        ok(copyText === 'Kopyala' && (await editor(page)).events.some((x) => x.startsWith('copy:18-21')), `copy iptal edildi (buton: ${copyText})`);
        // Escape kapatır
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-clip-copy').focus());
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        e = await editor(page);
        ok(!e.open && !e.range, 'Escape → seçici ve aralık kapandı');
    } finally {
        await page.close();
    }
}

async function testDrag(browser) {
    console.log('\n[2] Tutamaç sürüklenince uç değişiyor, seek bar sarmıyor');
    const page = await open(browser, true);
    try {
        await page.evaluate(() => document.getElementById('player').openClip());
        await page.waitForTimeout(200);
        const before = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
        const pos = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const h = root.querySelector('.hp-clip-handle[data-edge="end"]').getBoundingClientRect();
            const bar = root.querySelector('[part="seek-bar"]').getBoundingClientRect();
            return { x: h.x + h.width / 2, y: h.y + h.height / 2, target: bar.x + bar.width * 0.6 };
        });
        await page.mouse.move(pos.x, pos.y);
        await page.mouse.down();
        await page.mouse.move(pos.target, pos.y, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const e = await editor(page);
        const after = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
        ok(e.values[1] === '0:18', `bitiş sürüklenen yere geldi (${e.values.join(' – ')})`);
        ok(Math.abs(after - before) < 0.1, `video sarılmadı (${before.toFixed(2)} → ${after.toFixed(2)})`);
    } finally {
        await page.close();
    }
}

async function testOpenLink(browser) {
    console.log('\n[3] ?clip=4-7 ile açılış: başa sarılır, rozet + aralık, sonunda başa döner, "Tüm videoyu izle" çıkar');
    const page = await open(browser, true, '?clip=4-7');
    try {
        await page.waitForTimeout(500);
        let s = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            return {
                t: root.querySelector('video').currentTime,
                badge: root.querySelector('[part="clip-badge"] span')?.textContent ?? null,
                mark: !!root.querySelector('[part="clip-range"][data-static]'),
                ev: window.__ev.map((e) => `${e.state}:${e.start}-${e.end}`),
            };
        });
        ok(Math.abs(s.t - 4) < 0.6 && s.badge === 'Klip · 0:03' && s.mark, `başlangıç t=${s.t.toFixed(2)}, rozet "${s.badge}", işaret ${s.mark}`);
        ok(s.ev.includes('play:4-7'), `hp:clip play ${JSON.stringify(s.ev)}`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime >= 6.5, null, { timeout: 8000 });
        await page.waitForTimeout(1200);
        const t = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
        ok(t >= 3.9 && t < 6.5, `sonuna gelince başa döndü (t=${t.toFixed(2)})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="clip-badge"] button').click());
        await page.waitForTimeout(200);
        s = await page.evaluate(() => ({ badge: !!document.getElementById('player').shadowRoot.querySelector('[part="clip-badge"]'), ev: window.__ev.map((e) => e.state) }));
        ok(!s.badge && s.ev.includes('exit'), `klip modundan çıkıldı ${JSON.stringify(s.ev)}`);
        await page.waitForTimeout(3500);
        const t2 = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
        ok(t2 > 7.2, `artık sınır yok, video sürüyor (t=${t2.toFixed(2)})`);
        ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.close();
    }
}

async function testInvalidParam(browser) {
    console.log('\n[4] Geçersiz ?clip= (ters aralık) yok sayılıyor; readParam: false');
    for (const [q, clips] of [
        ['?clip=9-3', true],
        ['?clip=2-5', { readParam: false }],
    ]) {
        const page = await open(browser, clips, q);
        try {
            const has = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="clip-badge"]'));
            ok(!has, `${q} ${JSON.stringify(clips)} → klip modu yok`);
        } finally {
            await page.close();
        }
    }
}

const browser = await launchBrowser();
try {
    await testEditor(browser);
    await testDrag(browser);
    await testOpenLink(browser);
    await testInvalidParam(browser);
} finally {
    await browser.close();
}
console.log(failures ? `\n${failures} hata` : '\nTümü geçti');
process.exit(failures ? 1 : 0);
