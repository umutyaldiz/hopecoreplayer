// HopeCorePlayer — podcast araçları (uyku zamanlayıcısı, sessiz kısımları hızlı geç, dalga formu) ve işaret dili videosu.
import { launchBrowser } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
const ENGINE = process.env.HOPE_BROWSER ?? 'chromium';
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

async function open(browser, options) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((options) => {
        localStorage.removeItem('hp-skip-silence');
        localStorage.removeItem('hp-sign-language');
        window.__ev = [];
        const el = document.getElementById('player');
        for (const t of ['hp:podcast', 'hp:signlanguage']) el.addEventListener(t, (e) => window.__ev.push({ t, ...e.detail }));
        el.options = options;
    }, options);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').readyState >= 1, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    return page;
}

const menuRow = (page, startsWith) =>
    page.evaluate((t) => [...document.getElementById('player').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.startsWith(t))?.textContent ?? null, startsWith);
const openSettings = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Ayarlar"]').click());

async function testSleepTimer(browser) {
    console.log('\n[1] Uyku zamanlayıcısı: ayarlar menüsünde alt menü, dakika seçimi, "bölüm sonunda" → bitince durur');
    const page = await open(browser, { src: '/sample-audio.mp3', audio: { title: 'Bölüm 1', layout: 'compact' }, podcast: { sleepTimer: { minutes: [10, 20] } } });
    try {
        await openSettings(page);
        await page.waitForTimeout(150);
        ok((await menuRow(page, 'Uyku zamanlayıcısı'))?.endsWith('Kapalı'), `menü satırı: "${await menuRow(page, 'Uyku zamanlayıcısı')}"`);
        await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.startsWith('Uyku zamanlayıcısı')).click());
        await page.waitForTimeout(150);
        const items = await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /dakika|Bölüm sonunda|^Kapalı/.test(t)));
        ok(items.join('|') === 'Kapalı|10 dakika|20 dakika|Bölüm sonunda', `seçenekler ${JSON.stringify(items)}`);
        await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.trim() === '20 dakika').click());
        await page.waitForTimeout(150);
        await openSettings(page);
        await page.waitForTimeout(150);
        const row = await menuRow(page, 'Uyku zamanlayıcısı');
        ok(/19:5\d|20:00/.test(row ?? ''), `kalan süre gösteriliyor: "${row}"`);
        // Bölüm sonunda: sona yakın sar, oynat, bitince durur + sleepend
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.setSleepTimer('end');
            const v = el.shadowRoot.querySelector('video');
            v.currentTime = v.duration - 1.2;
            v.play();
        });
        await page.waitForFunction(() => window.__ev.some((e) => e.state === 'sleepend'), null, { timeout: 6000 }).catch(() => {});
        const ev = await page.evaluate(() => window.__ev.filter((e) => e.t === 'hp:podcast').map((e) => `${e.state}${e.minutes ? ':' + e.minutes : ''}`));
        const toast = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-plugin-toast[data-visible]')?.textContent);
        ok(ev.join(',') === 'sleep:20,sleep:end,sleepend', `olaylar ${JSON.stringify(ev)}`);
        ok(toast === 'Uyku zamanlayıcısı: oynatma durduruldu', `bildirim "${toast}"`);
    } finally {
        await page.close();
    }
}

async function testFade(browser) {
    console.log('\n[2] Dakika dolunca ses yavaşça kısılıp duruyor, ses düzeyi eski haline dönüyor');
    const page = await open(browser, { src: '/sample-audio.mp3', audio: { layout: 'compact' }, podcast: true });
    try {
        await page.evaluate(() => {
            const el = document.getElementById('player');
            const v = el.shadowRoot.querySelector('video');
            v.volume = 0.8;
            v.muted = true;
            v.play();
            el.setSleepTimer(0.1); // 6 sn: 8 sn'lik kısma hemen başlar
        });
        await page.waitForTimeout(3000);
        const mid = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').volume);
        ok(mid < 0.8 && mid > 0, `ses kısılıyor (${mid.toFixed(2)})`);
        await page.waitForFunction(() => window.__ev.some((e) => e.state === 'sleepend'), null, { timeout: 9000 }).catch(() => {});
        const s = await page.evaluate(() => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            return { paused: v.paused, volume: v.volume };
        });
        ok(s.paused && Math.abs(s.volume - 0.8) < 0.01, `durdu, ses düzeyi geri döndü (${s.volume})`);
    } finally {
        await page.close();
    }
}

async function testSilence(browser) {
    console.log('\n[3] Sessiz kısımları hızlı geç: ayarlardan açılıyor, sessizlikte hız 3x, ses gelince geri; tercih hatırlanıyor');
    const page = await open(browser, { src: '/silence-gap.mp3', audio: { layout: 'compact' }, podcast: { skipSilence: { rate: 3, minDuration: 0.3 } } });
    try {
        await openSettings(page);
        await page.waitForTimeout(150);
        ok((await menuRow(page, 'Sessiz kısımları hızlı geç'))?.endsWith('Kapalı'), 'menüde kapalı');
        await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.startsWith('Sessiz kısımları')).click());
        await page.waitForTimeout(150);
        if (ENGINE === 'webkit') {
            // WebKit'te hız değişince ses analizi duruyor — özellik kullanılamaz, hız hiç değişmemeli.
            const r = await page.evaluate(async () => {
                const root = document.getElementById('player').shadowRoot;
                const v = root.querySelector('video');
                const toast = root.querySelector('.hp-plugin-toast[data-visible]')?.textContent ?? null;
                await v.play();
                await new Promise((res) => setTimeout(res, 4000));
                return { toast, rate: v.playbackRate, ev: window.__ev.filter((e) => e.state === 'silence').length };
            });
            ok(!!r.toast?.startsWith('Sessizlik algılanamıyor'), `WebKit: kullanılamıyor bildirimi (${r.toast})`);
            ok(r.rate === 1 && r.ev === 0, `WebKit: hız değişmedi (${r.rate}), olay yok`);
            return;
        }
        const ev = await page.evaluate(() => window.__ev.filter((e) => e.state === 'silence'));
        ok(ev[0]?.enabled === true, `hp:podcast silence enabled ${JSON.stringify(ev)}`);
        ok((await page.evaluate(() => localStorage.getItem('hp-skip-silence'))) === '1', 'tercih saklandı');
        const rates = await page.evaluate(
            () =>
                new Promise((resolve) => {
                    const v = document.getElementById('player').shadowRoot.querySelector('video');
                    const seen = [];
                    const iv = setInterval(() => seen.push([+v.currentTime.toFixed(1), v.playbackRate]), 150);
                    v.play();
                    setTimeout(() => {
                        clearInterval(iv);
                        resolve(seen);
                    }, 6500);
                })
        );
        const fast = rates.filter(([t, r]) => r === 3);
        // 3x'te 100 ms'lik yoklama + analiz gecikmesi ≈ 0,9 sn medya: ses 7. saniyede başlar, dönüş 8,3'e kadar sürebilir.
        const fastIn = fast.every(([t]) => t >= 1.8 && t <= 8.3);
        const back = rates.some(([t, r]) => t > 7.4 && r === 1);
        // Docker'daki WebKit / Firefox'ta ses çıkışı olmayabilir — analiz verisi gelmezse yalnızca uyarı.
        if (!fast.length && ENGINE !== 'chromium') console.log(`  WARN ${ENGINE}: ses analizi veri vermedi, hız ölçülmedi`);
        else {
            ok(fast.length > 0 && fastIn, `sessizlikte 3x (${fast.length} örnek, ${JSON.stringify(fast)})`);
            ok(back, `ses gelince 1x'e döndü (son: ${JSON.stringify(rates.slice(-2))})`);
        }
        ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.close();
    }
}

async function testWaveform(browser) {
    console.log('\n[4] Dalga formu: veri ile ve dosyadan hesaplanarak çiziliyor, oynadıkça dolan kısım ilerliyor');
    const page = await open(browser, { src: '/sample-audio.mp3', audio: { layout: 'compact' }, podcast: { waveform: { data: [1, 5, 2, 8, 3, 9, 4, 7, 2, 6], bars: 10 }, sleepTimer: false } });
    try {
        const r = await page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            return { bars: root.querySelectorAll('.hp-waveform-base rect').length, sleep: [...root.querySelectorAll('button')].some((b) => b.textContent.startsWith('Uyku')) };
        });
        ok(r.bars === 10, `veriden 10 çubuk (${r.bars})`);
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 30));
        await page.waitForTimeout(300);
        const p = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-waveform').style.getPropertyValue('--hp-wave-p'));
        ok(/^3\d\.\d+%$|^31%$/.test(p) || parseFloat(p) > 25, `dolan kısım ${p}`);
    } finally {
        await page.close();
    }
    const p2 = await open(browser, { src: '/sample-audio.mp3', audio: { layout: 'compact' }, podcast: { waveform: true } });
    try {
        await p2.waitForFunction(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-waveform-base rect').length > 0, null, { timeout: 15000 }).catch(() => {});
        const bars = await p2.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-waveform-base rect').length);
        ok(bars === 120, `dosyadan hesaplandı: ${bars} çubuk`);
    } finally {
        await p2.close();
    }
}

async function testSignLanguage(browser) {
    console.log('\n[5] İşaret dili: varsayılan kapalı; açılınca köşede, ana videoyla eş zamanlı; sürükleyince köşe değişiyor');
    const page = await open(browser, { src: '/sample.mp4', muted: true, signLanguage: { src: '/sample-240p.mp4', position: 'bottom-right', size: 0.3 } });
    try {
        const read = () =>
            page.evaluate(() => {
                const root = document.getElementById('player').shadowRoot;
                const wrap = root.querySelector('[part="sign-language"]');
                const main = root.querySelector('video');
                const sign = wrap?.querySelector('video');
                return { visible: !!wrap && !wrap.hidden, corner: wrap?.getAttribute('data-corner'), src: sign?.getAttribute('src') ?? null, main: main.currentTime, sign: sign?.currentTime ?? -1, signPaused: sign?.paused, w: wrap?.getBoundingClientRect().width ?? 0, area: root.querySelector('.video-area')?.getBoundingClientRect().width ?? 0 };
            });
        let s = await read();
        ok(!s.visible && s.src === null, 'varsayılan kapalı, video indirilmedi');
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="İşaret dili"]').click());
        await page.waitForTimeout(300);
        s = await read();
        ok(s.visible && s.corner === 'bottom-right' && Math.abs(s.w / s.area - 0.3) < 0.03, `açıldı: ${s.corner}, genişlik %${Math.round((s.w / s.area) * 100)}`);
        await page.evaluate(() => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.currentTime = 3;
            v.play();
        });
        await page.waitForTimeout(2500);
        s = await read();
        ok(!s.signPaused && Math.abs(s.main - s.sign) < 0.5, `eş zamanlı (ana ${s.main.toFixed(2)}, işaret ${s.sign.toFixed(2)})`);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').pause());
        await page.waitForTimeout(200);
        ok((await read()).signPaused, 'ana durunca işaret dili de durdu');
        // Sürükle: sol üste
        const box = await page.evaluate(() => {
            const r = document.getElementById('player').shadowRoot.querySelector('[part="sign-language"]').getBoundingClientRect();
            const a = document.getElementById('player').shadowRoot.querySelector('.video-area').getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, ax: a.x + 60, ay: a.y + 40 };
        });
        await page.mouse.move(box.x, box.y);
        await page.mouse.down();
        await page.mouse.move(box.ax, box.ay, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        s = await read();
        const ev = await page.evaluate(() => window.__ev.filter((e) => e.t === 'hp:signlanguage').map((e) => `${e.state}:${e.position}`));
        ok(s.corner === 'top-left' && ev.includes('move:top-left'), `sürüklenip sol üste oturdu ${JSON.stringify(ev)}`);
        // Ayarlardan kapat; tercih hatırlanır
        await page.evaluate(() => document.getElementById('player').toggleSignLanguage(false));
        ok(!(await read()).visible && (await page.evaluate(() => localStorage.getItem('hp-sign-language'))) === '0', 'kapatıldı, tercih saklandı');
        ok(!page.__errors.length, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.close();
    }
    const p2 = await open(browser, { src: '/sample-30s.mp4', muted: true, locale: 'en', signLanguage: { src: '/sample-240p.mp4', default: true, button: false } });
    try {
        const r = await p2.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            return { visible: !root.querySelector('[part="sign-language"]').hidden, button: !!root.querySelector('[aria-label="Sign language"]') };
        });
        ok(r.visible && !r.button, 'default: true → açık başladı; button: false → buton yok');
    } finally {
        await p2.close();
    }
}

const browser = await launchBrowser();
try {
    await testSleepTimer(browser);
    await testFade(browser);
    await testSilence(browser);
    await testWaveform(browser);
    await testSignLanguage(browser);
} finally {
    await browser.close();
}
console.log(failures ? `\n${failures} hata` : '\nTümü geçti');
process.exit(failures ? 1 : 0);
