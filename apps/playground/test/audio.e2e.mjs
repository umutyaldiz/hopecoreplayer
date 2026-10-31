// HopeCorePlayer — ses modu (options.audio) doğrulama scripti.
// Kapak + plak sahnesi, plağın açısının çalma zamanından gelmesi, plağa dokununca oynat/duraklat, plağı çevirerek
// ileri/geri sarma (scratch), ses modunda tam ekran / PiP / otomatik gizlemenin kapalı olması, sistem medya
// kontrolleri (Media Session) ve seçeneklerin canlı değişmesi.
// Playground çalışıyor olmalı (npm run dev --workspace=apps/playground, port HOPE_TEST_PORT ya da 5183).
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

async function openAudio(browser, vinyl = 'right') {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(`${BASE}/?feature=audio&vinyl=${vinyl}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('.hp-audio'), null, { timeout: 5000 });
    await page.waitForFunction(() => Number.isFinite(document.getElementById('player').shadowRoot.querySelector('video').duration), null, { timeout: 5000 });
    return page;
}

const q = (page, fn) => page.evaluate(fn);

/** Plağın görünen bir noktası (sağ yerleşimde sol yarısı kapağın altında kalır). */
const vinylGeometry = (page) =>
    page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot.querySelector('.hp-vinyl').getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 };
    });

/** Merkez etrafında `fromDeg` → `toDeg` arası (saat yönü pozitif) sürükle. */
async function dragArc(page, g, fromDeg, toDeg, { release = true } = {}) {
    const at = (deg) => {
        const rad = (deg * Math.PI) / 180;
        return [g.cx + Math.cos(rad) * g.radius * 0.8, g.cy + Math.sin(rad) * g.radius * 0.8];
    };
    await page.mouse.move(...at(fromDeg));
    await page.mouse.down();
    const steps = Math.max(6, Math.ceil(Math.abs(toDeg - fromDeg) / 10));
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(...at(fromDeg + ((toDeg - fromDeg) * i) / steps));
        await page.waitForTimeout(16);
    }
    await page.waitForTimeout(80);
    if (release) await page.mouse.up();
}

async function testStageAndChrome(browser) {
    console.log('\n[1] Ses modu: kapak, plak, başlık; tam ekran / PiP / orta oynat butonu gizli');
    const page = await openAudio(browser);
    const s = await q(page, () => {
        const el = document.getElementById('player');
        const root = el.shadowRoot;
        const vis = (sel) => {
            const n = root.querySelector(sel);
            return !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0;
        };
        return {
            hostAttr: el.hasAttribute('data-audio'),
            position: root.querySelector('.hp-audio').getAttribute('data-position'),
            sleeve: vis('.hp-audio-sleeve'),
            vinyl: vis('.hp-vinyl'),
            title: root.querySelector('.hp-audio-title').textContent,
            artist: root.querySelector('.hp-audio-artist').textContent,
            cover: root.querySelector('.hp-audio-sleeve img').getAttribute('src'),
            fullscreenExists: !!root.querySelector('button[aria-label="Tam ekran"]'),
            fullscreen: vis('button[aria-label="Tam ekran"]'),
            pip: vis('button[aria-label="Resim içinde resim"]'),
            centerPlay: vis('.hp-center-play'),
            label: root.querySelector('.hp-vinyl').getAttribute('aria-label'),
        };
    });
    ok(s.hostAttr && s.position === 'right' && s.sleeve && s.vinyl, `sahne kuruldu (konum ${s.position}, kapak ${s.sleeve}, plak ${s.vinyl})`);
    ok(s.title === 'Vinyl Sessions' && s.artist === 'HopeCore · Side A', `başlık / sanatçı: "${s.title}" / "${s.artist}"`);
    ok(s.cover === '/sample-cover.jpg', 'kapak görseli');
    ok(s.fullscreenExists && !s.fullscreen && !s.pip && !s.centerPlay, `tam ekran (${s.fullscreen}), PiP (${s.pip}), orta oynat (${s.centerPlay}) gizli`);
    ok(!!s.label, `plağın erişilebilir adı: "${s.label}"`);

    await page.keyboard.press('Tab');
    await page.evaluate(() => document.getElementById('player').focus());
    await page.keyboard.press('f');
    await page.waitForTimeout(200);
    ok(!(await q(page, () => document.fullscreenElement)), '"f" kısayolu ses modunda tam ekrana geçmiyor');
    await page.close();
}

async function testRotationFollowsTime(browser) {
    console.log('\n[2] Plağın açısı çalma zamanından: 33⅓ devirde 0,9 sn = yarım tur');
    const page = await openAudio(browser);
    await q(page, () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        return new Promise((r) => {
            v.addEventListener('seeked', r, { once: true });
            v.currentTime = 0.9;
        });
    });
    await page.waitForTimeout(50);
    const angle = await q(page, () => {
        const t = document.getElementById('player').shadowRoot.querySelector('.hp-vinyl-disc').style.transform;
        return parseFloat(t.replace('rotate(', ''));
    });
    ok(Math.abs(angle - 180) < 2, `0,9 sn → ${angle.toFixed(1)}°`);
    await page.close();
}

async function testTapTogglesPlay(browser) {
    console.log('\n[3] Plağa dokununca oynat / duraklat (tek seferlik geçiş — video alanının tıklaması ikinci kez çalışmıyor)');
    const page = await openAudio(browser);
    const g = await vinylGeometry(page);
    const x = g.cx + g.radius * 0.7;
    await page.mouse.click(x, g.cy);
    await page.waitForTimeout(300);
    const playing = await q(page, () => !document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(playing, 'ilk dokunuş: çalıyor');
    const arm = await q(page, () => document.getElementById('player').shadowRoot.querySelector('.hp-audio').hasAttribute('data-playing'));
    ok(arm, 'çalarken pikap kolu plakta (data-playing)');
    await page.mouse.click(x, g.cy);
    await page.waitForTimeout(200);
    const paused = await q(page, () => document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(paused, 'ikinci dokunuş: duraklatıldı');
    await page.close();
}

async function testScratch(browser) {
    console.log('\n[4] Scratch: plağı çevirince ileri / geri sarıyor; elde tutarken çalmıyor, bırakınca devam ediyor');
    const page = await openAudio(browser);
    const g = await vinylGeometry(page);
    await q(page, () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        return new Promise((r) => {
            v.addEventListener('seeked', r, { once: true });
            v.currentTime = 10;
        });
    });
    // Saat yönünde 3/4 tur (sağ yarıda başlayıp) → +1,35 sn
    await dragArc(page, g, -60, 210);
    await page.waitForTimeout(150);
    let t = await q(page, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
    ok(Math.abs(t - 11.35) < 0.15, `saat yönünde 3/4 tur: 10 → ${t.toFixed(2)} sn (beklenen 11,35)`);

    // Ters yönde 1,5 tur → -2,7 sn
    await dragArc(page, g, 0, -540);
    await page.waitForTimeout(150);
    t = await q(page, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
    ok(Math.abs(t - 8.65) < 0.2, `ters yönde 1,5 tur: → ${t.toFixed(2)} sn (beklenen 8,65)`);

    // Başta: geriye çevirmek 0'ın altına inmiyor
    await q(page, () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        return new Promise((r) => {
            v.addEventListener('seeked', r, { once: true });
            v.currentTime = 0.5;
        });
    });
    await dragArc(page, g, 0, -360);
    await page.waitForTimeout(150);
    t = await q(page, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
    ok(t >= 0 && t < 0.05, `baştayken geri çevirmek 0'da duruyor (${t.toFixed(2)})`);

    // Çalarken: tutup çevirince duruyor, bırakınca devam ediyor
    await q(page, () => document.getElementById('player').play());
    await page.waitForTimeout(400);
    await dragArc(page, g, -40, 120, { release: false });
    const held = await q(page, () => ({
        paused: document.getElementById('player').shadowRoot.querySelector('video').paused,
        arm: document.getElementById('player').shadowRoot.querySelector('.hp-audio').hasAttribute('data-playing'),
    }));
    ok(held.paused, 'elde tutulan plak çalmıyor');
    ok(held.arm, 'scratch sırasında pikap kolu kalkmıyor');
    await page.mouse.up();
    await page.waitForTimeout(300);
    const resumed = await q(page, () => !document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(resumed, 'bırakınca çalmaya devam etti');
    await page.close();
}

async function testChromeStaysVisible(browser) {
    console.log('\n[5] Ses modunda kontroller otomatik gizlenmiyor');
    const page = await openAudio(browser);
    await q(page, () => document.getElementById('player').play());
    const box = await page.locator('#player').boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.move(box.x + box.width + 50, box.y + box.height + 50);
    await page.waitForTimeout(3500);
    const opacity = await q(page, () => {
        const root = document.getElementById('player').shadowRoot;
        const bar = root.querySelector('[part="control-bar"]') ?? root.querySelector('.hp-chrome');
        return bar ? getComputedStyle(bar).opacity : 'yok';
    });
    ok(opacity === '1', `oynarken ve fare dışarıdayken 3,5 sn sonra kontrol çubuğu opaklığı ${opacity}`);
    await page.close();
}

async function testMediaSession(browser) {
    console.log('\n[6] Sistem medya kontrolleri (Media Session): başlık, sanatçı, kapak; ileri sar eylemi');
    const page = await openAudio(browser);
    await q(page, () => document.getElementById('player').play());
    await page.waitForTimeout(300);
    const m = await q(page, () => {
        const md = navigator.mediaSession.metadata;
        return md ? { title: md.title, artist: md.artist, album: md.album, art: md.artwork[0]?.src ?? '' } : null;
    });
    ok(m?.title === 'Vinyl Sessions' && m.artist === 'HopeCore' && m.album === 'Side A', `metadata ${JSON.stringify(m)}`);
    ok(m?.art.startsWith('http') && m.art.endsWith('/sample-cover.jpg'), 'kapak mutlak URL olarak verildi');
    await page.close();
}

async function testLiveOptions(browser) {
    console.log('\n[7] Seçenekler canlı değişiyor: orta yerleşim / boyut / plak kapalı / ses modundan çıkış');
    const page = await openAudio(browser);
    await q(page, () => {
        const el = document.getElementById('player');
        el.options = { ...el.options, audio: { ...el.options.audio, vinyl: { position: 'center', size: 0.5, rpm: 45 } } };
    });
    await page.waitForTimeout(200);
    let s = await q(page, () => {
        const root = document.getElementById('player').shadowRoot;
        const stage = root.querySelector('.hp-audio');
        return {
            position: stage.getAttribute('data-position'),
            sleeveHidden: root.querySelector('.hp-audio-sleeve').hidden,
            size: stage.style.getPropertyValue('--hp-vinyl-size'),
            deckH: root.querySelector('.hp-audio-deck').getBoundingClientRect().height,
            areaH: root.querySelector('.hp-audio-area').getBoundingClientRect().height,
        };
    });
    ok(s.position === 'center' && s.sleeveHidden, `orta yerleşim: kılıf gizli (${s.position})`);
    ok(s.size === '0.5' && Math.abs(s.deckH / s.areaH - 0.5) < 0.03, `boyut 0.5 → plak alanın %${Math.round((s.deckH / s.areaH) * 100)}'i`);

    await q(page, () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        return new Promise((r) => {
            v.addEventListener('seeked', r, { once: true });
            v.currentTime = 1 / 3; // 45 devirde 1,333 sn/tur → 90°
        });
    });
    await page.waitForTimeout(50);
    const angle = await q(page, () => parseFloat(document.getElementById('player').shadowRoot.querySelector('.hp-vinyl-disc').style.transform.replace('rotate(', '')));
    ok(Math.abs(angle - 90) < 2, `45 devir: 1/3 sn → ${angle.toFixed(1)}°`);

    await q(page, () => {
        const el = document.getElementById('player');
        el.options = { ...el.options, audio: { ...el.options.audio, vinyl: false } };
    });
    await page.waitForTimeout(200);
    s = await q(page, () => {
        const root = document.getElementById('player').shadowRoot;
        return { vinylHidden: root.querySelector('.hp-vinyl').hidden, sleeveHidden: root.querySelector('.hp-audio-sleeve').hidden };
    });
    ok(s.vinylHidden && !s.sleeveHidden, 'vinyl: false → yalnızca kapak');

    await q(page, () => {
        const el = document.getElementById('player');
        const { audio, ...rest } = el.options;
        el.options = rest;
    });
    await page.waitForTimeout(200);
    s = await q(page, () => {
        const el = document.getElementById('player');
        const root = el.shadowRoot;
        const fs = root.querySelector('button[aria-label="Tam ekran"]');
        return { stage: !!root.querySelector('.hp-audio'), attr: el.hasAttribute('data-audio'), fs: fs && getComputedStyle(fs).display !== 'none' };
    });
    ok(!s.stage && !s.attr && s.fs, 'ses modundan çıkınca sahne kalktı, tam ekran butonu geri geldi');
    await page.close();
}

async function testOptionChangeKeepsPlaying(browser) {
    console.log('\n[8] Çalarken başka bir seçenek değişince (aynı kaynak) parça başa sarılmıyor, durmuyor');
    const page = await openAudio(browser);
    await q(page, () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        return new Promise((r) => {
            v.addEventListener('seeked', r, { once: true });
            v.currentTime = 20;
        });
    });
    await q(page, () => document.getElementById('player').play());
    await page.waitForTimeout(500);
    await q(page, () => {
        const el = document.getElementById('player');
        el.options = { ...el.options, audio: { ...el.options.audio, vinyl: { position: 'right', size: 0.6 } } };
    });
    await page.waitForTimeout(700);
    const s = await q(page, () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        return { t: v.currentTime, paused: v.paused };
    });
    ok(s.t > 20 && !s.paused, `seçenek değişti, çalma sürüyor (${s.t.toFixed(2)} sn, paused=${s.paused})`);

    // Kaynak gerçekten değişince yeniden yüklenir.
    await q(page, () => {
        const el = document.getElementById('player');
        el.options = { ...el.options, src: '/sample-audio.mp3?v=2' };
    });
    await page.waitForTimeout(700);
    const t2 = await q(page, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
    ok(t2 < 2, `kaynak değişince baştan yüklendi (${t2.toFixed(2)} sn)`);
    await page.close();
}

async function testAspectRatio(browser) {
    console.log('\n[9] aspectRatio (genel seçenek): ses modunda kare, video modunda 21:9 ve "4:3" yazımı; kaldırınca 16:9');
    const page = await openAudio(browser);
    const ratio = () =>
        q(page, () => {
            const r = document.getElementById('player').shadowRoot.querySelector('.video-area').getBoundingClientRect();
            return r.width / r.height;
        });
    const set = (patch) =>
        page.evaluate((patch) => {
            const el = document.getElementById('player');
            const next = { ...el.options, ...patch };
            for (const k of Object.keys(patch)) if (patch[k] === null) delete next[k];
            el.options = next;
        }, patch);

    await set({ aspectRatio: '1 / 1' });
    await page.waitForTimeout(200);
    const square = await ratio();
    ok(Math.abs(square - 1) < 0.02, `ses modunda kare: oran ${square.toFixed(2)}`);

    await set({ audio: null, src: '/sample.mp4', aspectRatio: '21 / 9' });
    await page.waitForTimeout(300);
    const wide = await ratio();
    ok(Math.abs(wide - 21 / 9) < 0.03, `video modunda 21 / 9: oran ${wide.toFixed(2)}`);

    await set({ aspectRatio: '4:3' });
    await page.waitForTimeout(200);
    const four = await ratio();
    ok(Math.abs(four - 4 / 3) < 0.02, `"4:3" yazımı: oran ${four.toFixed(2)}`);

    await set({ aspectRatio: 'bozuk' });
    await page.waitForTimeout(200);
    const bad = await ratio();
    ok(Math.abs(bad - 16 / 9) < 0.02, `geçersiz değer → 16:9 (${bad.toFixed(2)})`);

    await set({ aspectRatio: null });
    await page.waitForTimeout(200);
    const back = await ratio();
    ok(Math.abs(back - 16 / 9) < 0.02, `seçenek kaldırılınca 16:9 (${back.toFixed(2)})`);
    await page.close();
}

async function testNoEmptyControlGroupsOnMobile(browser) {
    console.log('\n[10] Mobil (dar düzen): görünen hiçbir kontrol kutusu boş değil (tam ekran kutusu gizli)');
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.goto(`${BASE}/?feature=audio&vinyl=right`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('.hp-audio'), null, { timeout: 5000 });
    await page.waitForTimeout(400);
    const check = () =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            const shown = (n) => getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0;
            const groups = [...root.querySelectorAll('.hp-group')].filter(shown);
            return {
                compact: root.querySelector('.video-area').hasAttribute('data-compact'),
                empty: groups.filter((g) => ![...g.children].some(shown)).length,
            };
        });
    const s = await check();
    ok(s.compact && s.empty === 0, `dar düzen: ${s.compact}, boş kutu: ${s.empty}`);
    // Ses modundan çıkınca tam ekran kutusu geri gelir.
    await page.evaluate(() => {
        const el = document.getElementById('player');
        const { audio, ...rest } = el.options;
        el.options = { ...rest, src: '/sample.mp4' };
    });
    await page.waitForTimeout(300);
    const fs = await page.evaluate(() => {
        const b = document.getElementById('player').shadowRoot.querySelector('button[aria-label="Tam ekran"]');
        return !!b && getComputedStyle(b).display !== 'none' && getComputedStyle(b.parentElement).display !== 'none';
    });
    ok(fs, 'video moduna dönünce tam ekran butonu ve kutusu görünüyor');
    await page.close();
}

/** Test için: AudioWorkletNode'a giden mesajları ve işlemcinin bildirdiği okuma konumunu kaydeder. */
const SPY_WORKLET = () => {
    const Orig = window.AudioWorkletNode;
    if (!Orig) return;
    window.__scratchMsgs = [];
    window.AudioWorkletNode = class extends Orig {
        constructor(...args) {
            super(...args);
            const post = this.port.postMessage.bind(this.port);
            this.port.postMessage = (m, t) => {
                window.__scratchMsgs.push(m.type === 'buffer' ? { type: 'buffer', length: m.channels[0].length, sampleRate: m.sampleRate } : m);
                return post(m, t);
            };
            this.port.addEventListener('message', (e) => {
                if (e.data?.type === 'position') window.__scratchPos = e.data.position;
            });
        }
    };
};

async function openScratchSound(browser, { noWorklet = false, enabled = true } = {}) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const chunks = [];
    page.on('request', (r) => {
        if (/ScratchSound/.test(r.url())) chunks.push(r.url());
    });
    if (noWorklet) await page.addInitScript(() => delete window.AudioWorkletNode);
    else await page.addInitScript(SPY_WORKLET);
    await page.goto(`${BASE}/?feature=audio&vinyl=right`);
    await page.waitForFunction(() => Number.isFinite(document.getElementById('player')?.shadowRoot?.querySelector('video')?.duration), null, { timeout: 5000 });
    if (enabled) {
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, audio: { ...el.options.audio, vinyl: { position: 'right', scratchSound: true } } };
        });
        await page.waitForTimeout(150);
    }
    return { page, chunks };
}

const stageAttr = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-audio').getAttribute('data-scratch-sound'));

async function testScratchSoundOffByDefault(browser) {
    console.log('\n[11] Scratch sesi varsayılan kapalı: çalınca da ses motoru yüklenmiyor');
    const { page, chunks } = await openScratchSound(browser, { enabled: false });
    await page.evaluate(() => document.getElementById('player').play());
    await page.waitForTimeout(1500);
    ok((await stageAttr(page)) === null && chunks.length === 0, `motor yüklenmedi (parça istekleri: ${chunks.length})`);
    await page.close();
}

async function testScratchSound(browser) {
    console.log('\n[12] Scratch sesi açık: çalınca boşta hazırlanıyor; plak çevrilince işlemci hedef konuma gidiyor, bırakınca susuyor');
    const { page, chunks } = await openScratchSound(browser);
    await page.evaluate(() => document.getElementById('player').play());
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.hp-audio').getAttribute('data-scratch-sound') === 'ready', null, { timeout: 8000 }).catch(() => {});
    ok((await stageAttr(page)) === 'ready' && chunks.length === 1, `hazır (${await stageAttr(page)}), motor parçası bir kez yüklendi (${chunks.length})`);
    const buf = await page.evaluate(() => window.__scratchMsgs.find((m) => m.type === 'buffer'));
    const duration = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').duration);
    ok(buf && Math.abs(buf.length / buf.sampleRate - duration) < 0.2, `çözülen ses ${buf ? (buf.length / buf.sampleRate).toFixed(1) : '?'} sn (dosya ${duration.toFixed(1)} sn)`);

    await page.evaluate(() => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        v.currentTime = 30;
    });
    await page.waitForTimeout(400);
    const g = await vinylGeometry(page);
    await page.evaluate(() => (window.__scratchMsgs.length = 0));
    // Saat yönünde bir tur, bırakmadan.
    await dragArc(page, g, -60, 300, { release: false });
    await page.waitForTimeout(250);
    const mid = await page.evaluate(() => {
        const msgs = window.__scratchMsgs;
        const start = msgs.find((m) => m.type === 'start');
        const targets = msgs.filter((m) => m.type === 'target').map((m) => m.position);
        return { start: start?.position, lastTarget: targets.at(-1), count: targets.length, pos: window.__scratchPos, video: document.getElementById('player').shadowRoot.querySelector('video').paused };
    });
    ok(mid.start !== undefined && Math.abs(mid.start - 30) < 0.4, `tutunca işlemci ${mid.start?.toFixed(2)} sn'den başladı`);
    ok(mid.count > 5 && mid.lastTarget > mid.start + 1.5, `çevirdikçe hedef ilerledi: ${mid.count} güncelleme, son hedef ${mid.lastTarget?.toFixed(2)} sn`);
    ok(mid.pos !== undefined && Math.abs(mid.pos - mid.lastTarget) < 0.1, `işlemcinin okuma kafası hedefte (${mid.pos?.toFixed(2)} ≈ ${mid.lastTarget?.toFixed(2)}) — ses parmağı takip ediyor`);
    ok(mid.video, 'scratch sırasında player sustu (yalnızca scratch sesi)');

    // Geri çevir.
    const before = mid.lastTarget;
    await page.mouse.up();
    await page.evaluate(() => (window.__scratchMsgs.length = 0));
    await dragArc(page, g, 0, -200, { release: false });
    await page.waitForTimeout(250);
    const back = await page.evaluate(() => ({
        lastTarget: window.__scratchMsgs.filter((m) => m.type === 'target').at(-1)?.position,
        pos: window.__scratchPos,
    }));
    ok(back.lastTarget < before && Math.abs(back.pos - back.lastTarget) < 0.1, `geri çevirince okuma kafası geri gitti (${back.pos?.toFixed(2)} sn)`);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
        stopped: window.__scratchMsgs.at(-1)?.type === 'stop',
        playing: !document.getElementById('player').shadowRoot.querySelector('video').paused,
        t: document.getElementById('player').shadowRoot.querySelector('video').currentTime,
    }));
    ok(after.stopped, 'bırakınca scratch sesi sustu');
    ok(after.playing && Math.abs(after.t - back.lastTarget) < 0.6, `player bırakılan yerden devam etti (${after.t.toFixed(2)} sn)`);
    await page.close();
}

async function testScratchSoundFallback(browser) {
    console.log('\n[13] AudioWorklet yoksa: scratch sessiz çalışmaya devam ediyor');
    const { page } = await openScratchSound(browser, { noWorklet: true });
    await page.evaluate(() => document.getElementById('player').play());
    await page.waitForTimeout(1500);
    ok((await stageAttr(page)) === 'unsupported', `durum: ${await stageAttr(page)}`);
    await page.evaluate(() => document.getElementById('player').pause());
    await page.evaluate(() => new Promise((r) => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        v.addEventListener('seeked', r, { once: true });
        v.currentTime = 10;
    }));
    const g = await vinylGeometry(page);
    await dragArc(page, g, -60, 210);
    await page.waitForTimeout(150);
    const t = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
    ok(Math.abs(t - 11.35) < 0.15, `sessiz scratch sarıyor: 10 → ${t.toFixed(2)} sn`);
    await page.close();
}

async function testHoldStopsImmediately(browser) {
    console.log('\n[14] Plağı tutunca ses anında duruyor; basılı tutup bırakınca devam; kısa dokunuş duraklatır (kol kalkar)');
    const page = await openAudio(browser);
    const g = await vinylGeometry(page);
    const x = g.cx + g.radius * 0.7;
    const state = () =>
        page.evaluate(() => {
            const root = document.getElementById('player').shadowRoot;
            return { paused: root.querySelector('video').paused, arm: root.querySelector('.hp-audio').hasAttribute('data-playing') };
        });
    await page.evaluate(() => document.getElementById('player').play());
    await page.waitForTimeout(400);

    // Bas, hiç çevirme: hemen susmalı, kol plakta kalmalı.
    await page.mouse.move(x, g.cy);
    await page.mouse.down();
    await page.waitForTimeout(30);
    let s = await state();
    ok(s.paused && s.arm, `basar basmaz sustu (paused=${s.paused}), kol plakta (${s.arm})`);
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(250);
    s = await state();
    ok(!s.paused && s.arm, `basılı tutup bırakınca çalmaya devam etti (paused=${s.paused})`);

    // Kısa dokunuş: duraklatır ve öyle kalır, kol kalkar.
    await page.mouse.click(x, g.cy);
    await page.waitForTimeout(250);
    s = await state();
    ok(s.paused && !s.arm, `kısa dokunuş duraklattı (paused=${s.paused}), kol kalktı (${!s.arm})`);

    // Duraklatılmışken kısa dokunuş: çalar.
    await page.mouse.click(x, g.cy);
    await page.waitForTimeout(300);
    s = await state();
    ok(!s.paused && s.arm, `duraklatılmışken dokunuş çaldı (paused=${s.paused})`);
    await page.close();
}

(async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
        await testStageAndChrome(browser);
        await testRotationFollowsTime(browser);
        await testTapTogglesPlay(browser);
        await testScratch(browser);
        await testChromeStaysVisible(browser);
        await testMediaSession(browser);
        await testLiveOptions(browser);
        await testOptionChangeKeepsPlaying(browser);
        await testAspectRatio(browser);
        await testNoEmptyControlGroupsOnMobile(browser);
        await testScratchSoundOffByDefault(browser);
        await testScratchSound(browser);
        await testScratchSoundFallback(browser);
        await testHoldStopsImmediately(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
