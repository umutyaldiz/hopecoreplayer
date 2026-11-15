// HopeCorePlayer — eğitim modu (course): izlenen aralıklar, sarma engeli, yüzde olayları, notlar, kalıcılık, hız sınırı.
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

async function open(browser, course, page) {
    page ??= await browser.newPage({ viewport: { width: 900, height: 560 } });
    const errors = page.__errors ?? [];
    if (!page.__errors) page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((course) => {
        window.__ev = [];
        const el = document.getElementById('player');
        el.addEventListener('hp:course', (e) => window.__ev.push({ state: e.detail.state, milestone: e.detail.milestone, time: e.detail.time, percent: e.detail.progress.percent }));
        el.options = { src: '/sample-30s.mp4', muted: true, course };
    }, course);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    return page;
}

const progress = (page) => page.evaluate(() => document.getElementById('player').getCourseProgress());
const video = (page, fn) => page.evaluate(fn);

async function testTracking(browser) {
    console.log('\n[1] Oynarken izlenen aralık kaydediliyor; izlenmemiş yere sarma engelleniyor (hp:course blocked); geri sarma serbest');
    const id = `t1-${Date.now()}`;
    const page = await open(browser, { id, milestones: [5, 10] });
    try {
        await video(page, () => document.getElementById('player').shadowRoot.querySelector('video').play());
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime >= 3.4, null, { timeout: 8000 });
        let p = await progress(page);
        ok(p.ranges.length === 1 && p.ranges[0][0] < 0.5 && p.ranges[0][1] > 3, `izlenen aralık ${JSON.stringify(p.ranges.map((r) => r.map((x) => +x.toFixed(1))))}`);
        ok(p.percent > 10 && p.watched > 3, `oran %${p.percent}, ${p.watched} sn`);
        let ev = await page.evaluate(() => window.__ev);
        ok(ev.filter((e) => e.state === 'progress').map((e) => e.milestone).join(',') === '5,10', `milestone olayları ${JSON.stringify(ev)}`);
        // İleri sarma engeli
        await video(page, () => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 20));
        await page.waitForTimeout(400);
        const t = await video(page, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
        ev = await page.evaluate(() => window.__ev);
        const toast = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-plugin-toast[data-visible]')?.textContent);
        ok(t < 5, `20 sn'ye sarma engellendi (t=${t.toFixed(2)})`);
        ok(ev.some((e) => e.state === 'blocked' && e.time >= 19.9), `blocked olayı (hedef ${ev.find((e) => e.state === 'blocked')?.time})`);
        ok(toast === 'Henüz izlemediğiniz kısma geçemezsiniz', `bildirim: "${toast}"`);
        // Geri sarma serbest, izlenen bölge içinde ileri sarma da serbest
        await video(page, () => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 1));
        await page.waitForTimeout(300);
        const back = await video(page, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
        ok(back >= 0.9 && back < 2, `geri sarma serbest (t=${back.toFixed(2)})`);
        // Seek bar'da izlenen bölge çizildi
        const seg = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('[part="course-watched"] i').length);
        ok(seg >= 1, `seek bar'da izlenen bölge (${seg})`);
        ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.close();
    }
}

async function testComplete(browser) {
    console.log('\n[2] initial ilerleme birleşiyor; completeAt geçilince complete; preventSkip: false serbest; maxRate');
    const id = `t2-${Date.now()}`;
    const page = await open(browser, { id, completeAt: 0.5, initial: { ranges: [[0, 14.5]] }, maxRate: 1.5 });
    try {
        let p = await progress(page);
        ok(p.percent > 45 && !p.completed, `initial: %${p.percent}`);
        await video(page, () => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.currentTime = 14;
            v.play();
        });
        await page.waitForFunction(() => document.getElementById('player').getCourseProgress().completed, null, { timeout: 8000 }).catch(() => {});
        p = await progress(page);
        const ev = await page.evaluate(() => window.__ev.map((e) => e.state));
        ok(p.completed && ev.includes('complete'), `tamamlandı (%${p.percent}) ${JSON.stringify(ev)}`);
        const toast = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-plugin-toast[data-visible]')?.textContent);
        ok(toast === 'Ders tamamlandı', `bildirim "${toast}"`);
        await video(page, () => (document.getElementById('player').shadowRoot.querySelector('video').playbackRate = 2));
        await page.waitForTimeout(100);
        const rate = await video(page, () => document.getElementById('player').shadowRoot.querySelector('video').playbackRate);
        ok(rate === 1.5, `maxRate 1.5 (${rate})`);
    } finally {
        await page.close();
    }
    const p2 = await open(browser, { id: `t2b-${Date.now()}`, preventSkip: false });
    try {
        await video(p2, () => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 20));
        await p2.waitForTimeout(400);
        const t = await video(p2, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
        ok(t > 19.5, `preventSkip: false → serbest (t=${t.toFixed(2)})`);
    } finally {
        await p2.close();
    }
}

async function testNotes(browser) {
    console.log('\n[3] Notlar: panelden not ekleniyor, seek bar işareti, tıklayınca o ana gidiliyor, siliniyor, sayfa yenilenince duruyor');
    const id = `t3-${Date.now()}`;
    const page = await open(browser, { id });
    try {
        await video(page, () => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 0));
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Notlar"]').click());
        await page.waitForTimeout(150);
        const empty = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-course-empty')?.textContent ?? null);
        ok(!!empty, `boş liste mesajı: "${empty}"`);
        for (const [time, text] of [
            [0, 'Giriş <b>önemli</b>'],
            [0, 'İkinci not'],
        ]) {
            await page.evaluate(
                ({ text }) => {
                    const root = document.getElementById('player').shadowRoot;
                    root.querySelector('.hp-course-form input').value = text;
                    root.querySelector('.hp-course-form button').click();
                },
                { time, text }
            );
        }
        await page.waitForTimeout(150);
        let notes = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-course-list li span')].map((s) => s.textContent));
        const markers = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-course-note-marker').length);
        ok(notes.join('|') === 'Giriş <b>önemli</b>|İkinci not' && markers === 2, `notlar ${JSON.stringify(notes)}, işaret ${markers}`);
        // Notun zamanına tıklayınca o ana gidilir (önce başka yere sar)
        await video(page, () => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 0.4));
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-course-time')[0].click());
        await page.waitForTimeout(250);
        const jumped = await video(page, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
        ok(jumped < 0.2, `not zamanına tıklayınca o ana gidildi (t=${jumped.toFixed(2)})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-course-list li .hp-course-icon')[1].click());
        await page.waitForTimeout(100);
        notes = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-course-list li span')].map((s) => s.textContent));
        ok(notes.length === 1, `silindi (${notes.length})`);
        const ev = await page.evaluate(() => window.__ev.filter((e) => e.state === 'note').length);
        ok(ev === 3, `hp:course note olayları (${ev})`);
        await open(browser, { id }, page);
        const p = await progress(page);
        ok(p.notes.length === 1 && p.notes[0].text === 'Giriş <b>önemli</b>', `yenileme sonrası not duruyor (${p.notes.length})`);
        ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
        await page.evaluate((id) => localStorage.removeItem(`hp-course:${id}`), id);
    } finally {
        await page.close();
    }
}

const browser = await launchBrowser();
try {
    await testTracking(browser);
    await testComplete(browser);
    await testNotes(browser);
} finally {
    await browser.close();
}
console.log(failures ? `\n${failures} hata` : '\nTümü geçti');
process.exit(failures ? 1 : 0);
