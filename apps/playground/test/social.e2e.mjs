// HopeCorePlayer — birlikte izle (watchParty) ve tepkiler / zamanlı yorumlar (reactions).
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

async function newPage(browser) {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    return page;
}

/** İki player: A (#player) ve B (yeni) — mesajlar 80 ms gecikmeli "kanal"la birbirine gider. */
async function openParty(browser) {
    const page = await newPage(browser);
    await page.evaluate(() => {
        window.__sent = { A: 0, B: 0 };
        const a = document.getElementById('player');
        const b = document.createElement('hope-player');
        b.id = 'player-b';
        a.after(b);
        window.__mute = {};
        const channel = (from, to) => (m) => {
            if (window.__mute[from]) return;
            window.__sent[from]++;
            setTimeout(() => to.receiveWatchParty(m), 80);
        };
        a.options = { src: '/sample-30s.mp4', muted: true, watchParty: { name: 'Ali', send: channel('A', b), heartbeat: 1 } };
        b.options = { src: '/sample-30s.mp4', muted: true, watchParty: { name: 'Ayşe', send: channel('B', a), heartbeat: 0 } };
    });
    await page.waitForFunction(
        () => ['player', 'player-b'].every((id) => document.getElementById(id)?.shadowRoot?.querySelector('video')?.readyState >= 1),
        null,
        { timeout: 10000 }
    );
    await page.waitForTimeout(500);
    return page;
}

const both = (page) =>
    page.evaluate(() => {
        const get = (id) => {
            const v = document.getElementById(id).shadowRoot.querySelector('video');
            return { t: v.currentTime, paused: v.paused, rate: v.playbackRate };
        };
        const toast = document.getElementById('player-b').shadowRoot.querySelector('.hp-plugin-toast[data-visible]')?.textContent ?? null;
        return { a: get('player'), b: get('player-b'), toast, sent: { ...window.__sent } };
    });

async function testWatchParty(browser) {
    console.log('\n[1] Birlikte izle: A oynatınca / durdurunca / sarınca / hız değiştirince B aynısını yapıyor, yankı yok');
    const page = await openParty(browser);
    try {
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
        await page.waitForTimeout(900);
        let s = await both(page);
        ok(!s.a.paused && !s.b.paused, `A oynattı → B oynuyor (B t=${s.b.t.toFixed(2)})`);
        ok(s.toast === 'Ali oynattı', `B'de bildirim: "${s.toast}"`);
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 12));
        await page.waitForTimeout(900);
        s = await both(page);
        ok(Math.abs(s.b.t - s.a.t) < 1, `A 12 sn'ye sardı → B de (A ${s.a.t.toFixed(2)}, B ${s.b.t.toFixed(2)})`);
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').playbackRate = 1.5));
        await page.waitForTimeout(500);
        s = await both(page);
        ok(s.b.rate === 1.5, `hız eşitlendi (${s.b.rate})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
        await page.waitForTimeout(700);
        s = await both(page);
        ok(s.b.paused && Math.abs(s.b.t - s.a.t) < 0.6, `A durdurdu → B durdu, aynı karede (A ${s.a.t.toFixed(2)}, B ${s.b.t.toFixed(2)})`);
        ok(s.toast === 'Ali durdurdu', `bildirim: "${s.toast}"`);
        ok(s.sent.B === 0, `B uzaktan gelen değişiklikleri geri göndermedi (yankı yok, B gönderdi: ${s.sent.B})`);
        // B kendisi oynatırsa A da oynar (iki yönlü)
        await page.evaluate(() => document.getElementById('player-b').shadowRoot.querySelector('video').play());
        await page.waitForTimeout(900);
        s = await both(page);
        ok(!s.a.paused && s.sent.B >= 1, `B oynattı → A oynuyor (B gönderdi: ${s.sent.B})`);
    } finally {
        await page.close();
    }
}

async function testDrift(browser) {
    console.log('\n[2] Kayma: B elle geride kalırsa A\'nın sync mesajı (heartbeat) hizalıyor; hp:watchparty drift');
    const page = await openParty(browser);
    try {
        await page.evaluate(() => {
            window.__drift = [];
            document.getElementById('player-b').addEventListener('hp:watchparty', (e) => e.detail.state === 'drift' && window.__drift.push(e.detail.diff));
            document.getElementById('player').shadowRoot.querySelector('video').play();
        });
        await page.waitForTimeout(800);
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 10));
        await page.waitForTimeout(1200);
        // B'yi sessizce 5 sn geriye at (yerel olay sayılmasın diye kendi kanalını kes)
        await page.evaluate(() => {
            window.__mute.B = true;
            const v = document.getElementById('player-b').shadowRoot.querySelector('video');
            v.currentTime = Math.max(0, v.currentTime - 5);
        });
        await page.waitForTimeout(2600);
        const s = await both(page);
        const drift = await page.evaluate(() => window.__drift);
        ok(Math.abs(s.a.t - s.b.t) < 1, `hizalandı (A ${s.a.t.toFixed(2)}, B ${s.b.t.toFixed(2)})`);
        ok(drift.some((d) => d > 3), `drift olayı ${JSON.stringify(drift.map((d) => d.toFixed(1)))}`);
        ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.close();
    }
}

async function openReactions(browser, reactions) {
    const page = await newPage(browser);
    await page.evaluate((reactions) => {
        window.__ev = [];
        const el = document.getElementById('player');
        el.addEventListener('hp:reaction', (e) => {
            window.__ev.push(e.detail);
            if (window.__blockComment && e.detail.type === 'comment' && e.detail.local) e.preventDefault();
        });
        el.options = { src: '/sample-30s.mp4', muted: true, reactions };
    }, reactions);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    return page;
}

async function testReactions(browser) {
    console.log('\n[3] Tepkiler: tepsi açılıyor, emoji uçuyor + hp:reaction (local), addReaction uzaktan');
    const page = await openReactions(browser, { emojis: ['👍', '🎉'], input: true });
    try {
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Tepki ver"]').click());
        await page.waitForTimeout(150);
        const emojis = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-react-emoji')].map((b) => b.textContent));
        ok(emojis.join('') === '👍🎉', `tepsi: ${emojis.join(' ')}`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-react-emoji')[1].click());
        await page.waitForTimeout(100);
        let floats = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-react-float')].map((f) => f.textContent));
        let ev = await page.evaluate(() => window.__ev);
        ok(floats.includes('🎉') && ev[0]?.emoji === '🎉' && ev[0]?.local === true, `emoji uçtu, olay local ${JSON.stringify(ev[0])}`);
        await page.evaluate(() => document.getElementById('player').addReaction('❤️'));
        await page.waitForTimeout(100);
        floats = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-react-float')].map((f) => f.textContent));
        ev = await page.evaluate(() => window.__ev);
        ok(floats.includes('❤️') && ev[1]?.local === false, `uzaktan tepki gösterildi (local: ${ev[1]?.local})`);
        await page.waitForTimeout(3300);
        const left = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-react-float').length);
        ok(left === 0, `animasyon bitince kaldırıldı (${left})`);
    } finally {
        await page.close();
    }
}

async function testComments(browser) {
    console.log('\n[4] Zamanlı yorumlar o saniyede akıyor (HTML düz metin), sarınca atlanıyor; yorum yazma; ayarlardan kapatma');
    const page = await openReactions(browser, {
        input: true,
        comments: [
            { time: 1, text: '<img src=x onerror="window.__xss=1">ilk', author: 'Ayşe' },
            { time: 1.6, text: 'ikinci' },
            { time: 15, text: 'atlanacak' },
        ],
    });
    try {
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').play());
        await page.waitForTimeout(2300);
        let texts = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-comment')].map((c) => c.textContent));
        ok(texts.length === 2 && texts[0] === 'Ayşe: <img src=x onerror="window.__xss=1">ilk', `iki yorum aktı ${JSON.stringify(texts)}`);
        ok((await page.evaluate(() => window.__xss ?? null)) === null, 'yorumdaki HTML çalışmadı');
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 16));
        await page.waitForTimeout(800);
        texts = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-comment')].map((c) => c.textContent));
        ok(!texts.includes('atlanacak'), 'üzerinden sarılan yorum gösterilmedi');
        // Yorum yaz
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Tepki ver"]').click());
        await page.waitForTimeout(100);
        await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            root.querySelector('.hp-react-form input').value = 'Merhaba';
            root.querySelector('.hp-react-form button').click();
        });
        await page.waitForTimeout(150);
        texts = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-comment')].map((c) => c.textContent));
        const ev = await page.evaluate(() => window.__ev.filter((e) => e.type === 'comment'));
        ok(texts.includes('Merhaba') && ev.some((e) => e.text === 'Merhaba' && e.local), 'yazılan yorum aktı, hp:reaction comment local');
        await page.evaluate(() => (window.__blockComment = true));
        await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            root.querySelector('.hp-react-form input').value = 'Engelli';
            root.querySelector('.hp-react-form button').click();
        });
        await page.waitForTimeout(150);
        texts = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-comment')].map((c) => c.textContent));
        ok(!texts.includes('Engelli'), 'preventDefault → yorum gösterilmedi (moderasyon)');
        // Ayarlardan kapat
        await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            root.querySelector('[aria-label="Ayarlar"]').click();
        });
        await page.waitForTimeout(150);
        await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.startsWith('Yorumlar')).click());
        await page.waitForTimeout(150);
        await page.evaluate(() => document.getElementById('player').addComment({ text: 'gizli' }));
        await page.waitForTimeout(100);
        texts = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-comment')].map((c) => c.textContent));
        const stored = await page.evaluate(() => localStorage.getItem('hp-reactions-comments'));
        ok(texts.length === 0 && stored === '0', `yorumlar kapatıldı, tercih saklandı (${stored})`);
        await page.evaluate(() => localStorage.removeItem('hp-reactions-comments'));
        ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.close();
    }
}

const browser = await launchBrowser();
try {
    await testWatchParty(browser);
    await testDrift(browser);
    await testReactions(browser);
    await testComments(browser);
} finally {
    await browser.close();
}
console.log(failures ? `\n${failures} hata` : '\nTümü geçti');
process.exit(failures ? 1 : 0);
