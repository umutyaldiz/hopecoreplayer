// Herkese açık eklenti API'si: kayıt, arayüz, otomatik temizlik, güncelleme, hata yalıtımı, kısayollar, dil, depolama,
// tembel yükleme, reklam API'si.
import { launchBrowser } from './_browser.mjs';
import { readFileSync } from 'fs';

const MOCK_IMA = readFileSync(new URL('./_mock-ima.js', import.meta.url), 'utf8');

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

/** Sayfada bir test eklentisi tanımlar (`window.__demo`) — kullanıcı kodu gibi düz nesne. */
const DEMO_PLUGIN = () => {
    window.__log = [];
    window.__demo = {
        name: 'demo',
        setup(player, options) {
            window.__log.push(`setup:${JSON.stringify(options)}`);
            player.i18n.add({ tr: { logo: 'Logo göster' }, en: { logo: 'Show logo' } });
            const layer = player.ui.addLayer({ position: 'top-left', css: '.demo-mark{background:#e11d48;color:#fff;padding:4px 8px}' });
            layer.el.innerHTML = `<span class="demo-mark">${options?.text ?? 'DEMO'}</span>`;
            const btn = player.ui.addButton({
                label: () => player.i18n.t('logo'),
                icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>',
                active: true,
                onClick: (_e, b) => {
                    b.setActive(!b.active);
                    layer.toggle(b.active);
                    player.emit('toggle', { visible: b.active });
                },
            });
            player.settings.addToggle({ label: 'Demo logo', get: () => layer.visible, set: (v) => { layer.toggle(v); btn.setActive(v); } });
            player.keys.add('w', () => window.__log.push('key:w'), 'Demo kısayolu');
            player.on('timeupdate', () => (window.__ticks = (window.__ticks ?? 0) + 1));
            player.setInterval(() => (window.__interval = (window.__interval ?? 0) + 1), 50);
            player.storage.set('seen', (player.storage.get('seen', 0) ?? 0) + 1);
            return () => window.__log.push('cleanup');
        },
    };
};

async function open(browser) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    const chunks = [];
    page.on('request', (r) => {
        const m = /\/chunks\/(pluginHost)-/.exec(r.url());
        if (m) chunks.push(m[1]);
    });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(DEMO_PLUGIN);
    return { page, chunks };
}

const ui = (page) =>
    page.evaluate(() => {
        const root = document.getElementById('player').shadowRoot;
        const btn = root.querySelector('[data-plugin="demo"].hp-plugin-btn');
        const layer = root.querySelector('.hp-plugin-layer[data-plugin="demo"]');
        return {
            button: btn ? { label: btn.getAttribute('aria-label'), pressed: btn.getAttribute('aria-pressed'), inRight: !!btn.closest('.hp-group:not(.hp-group-left)') } : null,
            layer: layer
                ? { text: layer.textContent.trim(), hidden: layer.hidden, position: layer.dataset.position, styled: getComputedStyle(layer.querySelector('.demo-mark') ?? layer).backgroundColor === 'rgb(225, 29, 72)' }
                : null,
            log: window.__log.slice(),
        };
    });

const settingsRows = (page) =>
    page.evaluate(async () => {
        const root = document.getElementById('player').shadowRoot;
        const wait = () => new Promise((r) => setTimeout(r, 120));
        const gear = root.querySelector('[aria-label="Ayarlar"]');
        gear.click();
        await wait();
        const rows = Array.from(root.querySelectorAll('.hp-chip-panel button')).map((b) => b.textContent.trim());
        gear.click();
        return rows;
    });

async function testInstallAndUi(browser) {
    console.log('\n[1] options.plugins: buton (sağ grup, ad, aç/kapa), katman, ayar satırı, kısayol, olay, toast, i18n');
    const { page, chunks } = await open(browser);
    try {
        ok(chunks.length === 0, `eklenti yokken pluginHost parçası indirilmedi (${chunks.join(',') || 'yok'})`);
        await page.evaluate(() => {
            document.getElementById('player').options = { src: '/sample.mp4', muted: true, plugins: [[window.__demo, { text: 'HOPE' }]] };
        });
        await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('.hp-plugin-btn'), null, { timeout: 5000 });
        let s = await ui(page);
        ok(chunks.includes('pluginHost'), 'eklenti verilince pluginHost parçası indi');
        ok(s.log[0] === 'setup:{"text":"HOPE"}', `setup seçeneklerle çağrıldı ${JSON.stringify(s.log)}`);
        ok(s.button?.label === 'Logo göster' && s.button.pressed === 'true' && s.button.inRight, `buton ${JSON.stringify(s.button)}`);
        ok(s.layer?.text === 'HOPE' && !s.layer.hidden && s.layer.position === 'top-left' && s.layer.styled, `katman (css, innerHTML sonrası da) ${JSON.stringify(s.layer)}`);

        // Buton tıklaması: aç/kapa + emit; video oynamaya başlamadı (tıklama videoya geçmedi).
        await page.evaluate(() => document.getElementById('player').addEventListener('demo:toggle', (e) => window.__log.push(`emit:${e.detail.visible}`)));
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-plugin-btn').click());
        await page.waitForTimeout(100);
        s = await ui(page);
        ok(s.button.pressed === 'false' && s.layer.hidden && s.log.includes('emit:false'), `tıklama: kapandı, demo:toggle olayı ${JSON.stringify(s.log)}`);

        const rows = await settingsRows(page);
        ok(rows.some((r) => r.startsWith('Demo logo')), `ayarlar menüsünde satır ${JSON.stringify(rows)}`);

        await page.evaluate(() => document.getElementById('player').focus());
        await page.keyboard.press('w');
        await page.waitForTimeout(80);
        ok((await ui(page)).log.includes('key:w'), 'w kısayolu');

        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(600);
        const ticks = await page.evaluate(() => window.__ticks ?? 0);
        ok(ticks > 0, `player.on('timeupdate') çalışıyor (${ticks})`);

        // Dil değişince fonksiyon etiketi yenilenir.
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, locale: 'en' };
        });
        await page.waitForTimeout(300);
        s = await ui(page);
        ok(s.button?.label === 'Show logo' && s.log.filter((l) => l.startsWith('setup')).length === 1, `dil değişti → "${s.button?.label}", eklenti yeniden kurulmadı`);
    } finally {
        await page.close();
    }
}

async function testCleanupAndUpdate(browser) {
    console.log('\n[2] Kaldırınca her şey temizleniyor (buton, katman, ayar, kısayol, dinleyici, zamanlayıcı); seçenek değişince yeniden kurulum / update()');
    const { page } = await open(browser);
    try {
        await page.evaluate(() => {
            document.getElementById('player').options = { src: '/sample.mp4', muted: true, plugins: [[window.__demo, { text: 'A' }]] };
        });
        await page.waitForFunction(() => !!document.getElementById('player').shadowRoot.querySelector('.hp-plugin-btn'));
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, plugins: [[window.__demo, { text: 'B' }]] };
        });
        await page.waitForTimeout(300);
        let s = await ui(page);
        ok(s.layer?.text === 'B' && s.log.filter((l) => l === 'cleanup').length === 1 && s.log.filter((l) => l.startsWith('setup')).length === 2, `update yok → eski temizlendi, yeni seçenekle kuruldu ${JSON.stringify(s.log)}`);
        const count = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelectorAll('.hp-plugin-btn').length);
        ok(count === 1, `tek buton kaldı (${count})`);

        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, plugins: [] };
        });
        await page.waitForTimeout(300);
        s = await ui(page);
        const interval1 = await page.evaluate(() => window.__interval ?? 0);
        await page.waitForTimeout(200);
        const interval2 = await page.evaluate(() => window.__interval ?? 0);
        ok(!s.button && !s.layer && s.log.at(-1) === 'cleanup', 'kaldırınca buton ve katman yok, cleanup çağrıldı');
        ok(interval1 === interval2, `setInterval iptal edildi (${interval1} → ${interval2})`);
        const rows = await settingsRows(page);
        ok(!rows.some((r) => r.startsWith('Demo logo')), 'ayar satırı kalktı');
        await page.evaluate(() => document.getElementById('player').focus());
        await page.keyboard.press('w');
        ok(!(await ui(page)).log.includes('key:w'), 'kısayol kalktı');

        // update() varsa yeniden kurulmaz.
        await page.evaluate(() => {
            window.__upd = { name: 'upd', setup() { window.__log.push('upd:setup'); }, update(o) { window.__log.push(`upd:update:${o.n}`); } };
            const el = document.getElementById('player');
            el.options = { ...el.options, plugins: [[window.__upd, { n: 1 }]] };
        });
        await page.waitForTimeout(200);
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, plugins: [[window.__upd, { n: 2 }]] };
        });
        await page.waitForTimeout(200);
        s = await ui(page);
        ok(s.log.filter((l) => l === 'upd:setup').length === 1 && s.log.includes('upd:update:2'), `update(): yeniden kurulmadı ${JSON.stringify(s.log.filter((l) => l.startsWith('upd')))}`);
    } finally {
        await page.close();
    }
}

async function testErrorsAndRegistration(browser) {
    console.log('\n[3] Hata yalıtımı; player.use(); sayfa geneli kayıt (static use); tembel yükleyici; storage');
    const { page } = await open(browser);
    try {
        await page.evaluate(() => {
            window.__bad = { name: 'bad', setup() { throw new Error('boom'); } };
            window.__badClick = {
                name: 'bad-click',
                setup(player) {
                    player.ui.addButton({ label: 'Bad', icon: 'loop', onClick() { throw new Error('click boom'); } });
                },
            };
            document.getElementById('player').options = { src: '/sample.mp4', muted: true, debug: true, plugins: [window.__bad, window.__badClick] };
        });
        await page.waitForTimeout(400);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[aria-label="Bad"]').click());
        await page.waitForTimeout(100);
        const errs = await page.evaluate(() => document.getElementById('player').errorLog.entries.map((e) => `${e.message}|${e.details?.plugin}`));
        ok(errs.some((e) => e.includes('"bad" failed in setup: boom') && e.endsWith('|bad')), 'setup hatası kaydedildi');
        ok(errs.some((e) => e.includes('"bad-click" failed in button.onClick: click boom')), 'buton hatası kaydedildi');
        const playable = await page.evaluate(async () => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            await v.play();
            await new Promise((r) => setTimeout(r, 400));
            return v.currentTime > 0;
        });
        ok(playable, 'player çalışmaya devam ediyor');

        // player.use() ve remove()
        const used = await page.evaluate(async () => {
            const el = document.getElementById('player');
            const h = el.use(window.__demo, { text: 'USE' });
            await new Promise((r) => setTimeout(r, 300));
            const before = !!el.shadowRoot.querySelector('.hp-plugin-layer[data-plugin="demo"]');
            h.remove();
            await new Promise((r) => setTimeout(r, 300));
            return { before, after: !!el.shadowRoot.querySelector('.hp-plugin-layer[data-plugin="demo"]') };
        });
        ok(used.before && !used.after, `player.use() kurdu, remove() kaldırdı ${JSON.stringify(used)}`);

        // Sayfa geneli: mevcut player'a da uygulanır; aynı adlı player eklentisi kazanır.
        const global = await page.evaluate(async () => {
            const el = document.getElementById('player');
            const off = customElements.get('hope-player').use({ name: 'glob', setup(p) { p.ui.addLayer({ position: 'top' }).el.textContent = 'GLOBAL'; } });
            await new Promise((r) => setTimeout(r, 300));
            const applied = el.shadowRoot.querySelector('.hp-plugin-layer[data-plugin="glob"]')?.textContent;
            el.options = { ...el.options, plugins: [{ name: 'glob', setup(p) { p.ui.addLayer({ position: 'top' }).el.textContent = 'OWN'; } }] };
            await new Promise((r) => setTimeout(r, 300));
            const own = Array.from(el.shadowRoot.querySelectorAll('.hp-plugin-layer[data-plugin="glob"]')).map((l) => l.textContent);
            el.options = { ...el.options, plugins: [] };
            off();
            await new Promise((r) => setTimeout(r, 300));
            return { applied, own, after: el.shadowRoot.querySelectorAll('.hp-plugin-layer[data-plugin="glob"]').length };
        });
        ok(global.applied === 'GLOBAL' && JSON.stringify(global.own) === '["OWN"]' && global.after === 0, `sayfa geneli kayıt ${JSON.stringify(global)}`);

        // Tembel yükleyici + storage
        const lazy = await page.evaluate(async () => {
            const el = document.getElementById('player');
            localStorage.removeItem('hp-plugin:demo:seen');
            el.options = { ...el.options, plugins: [[() => Promise.resolve({ default: window.__demo }), { text: 'LAZY' }]] };
            await new Promise((r) => setTimeout(r, 400));
            return { text: el.shadowRoot.querySelector('.hp-plugin-layer[data-plugin="demo"]')?.textContent.trim(), seen: localStorage.getItem('hp-plugin:demo:seen') };
        });
        ok(lazy.text === 'LAZY' && lazy.seen === '1', `yükleyiciyle kuruldu, storage ad alanında ${JSON.stringify(lazy)}`);
    } finally {
        await page.close();
    }
}

async function testLayerClicksAndShortcutList(browser) {
    console.log('\n[4] Katman tıklaması: etkileşimsiz → videoya geçer, interactive → geçmez; kısayol ? listesinde');
    const { page } = await open(browser);
    try {
        await page.evaluate(() => {
            document.getElementById('player').options = {
                src: '/sample.mp4',
                muted: true,
                accessibility: true,
                plugins: [
                    { name: 'pass', setup(p) { p.ui.addLayer({ position: 'fill' }); p.keys.add('Shift+Q', () => {}, 'Demo: Q'); } },
                ],
            };
        });
        await page.waitForTimeout(500);
        const box = await (await page.evaluateHandle(() => document.getElementById('player').shadowRoot.querySelector('video'))).boundingBox();
        // Ortadaki oynat butonunun dışına tıkla.
        await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.3);
        await page.waitForTimeout(300);
        const played = await page.evaluate(() => !document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(played, 'etkileşimsiz katmanın üstüne tıklamak videoyu oynattı');

        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.shadowRoot.querySelector('video').pause();
            el.options = { ...el.options, plugins: [{ name: 'block', setup(p) { p.ui.addLayer({ position: 'fill', interactive: true }); } }] };
        });
        await page.waitForTimeout(400);
        await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.3);
        await page.waitForTimeout(300);
        const stillPaused = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').paused);
        ok(stillPaused, 'interactive katman tıklamayı yakaladı (video duraklatılmış kaldı)');

        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, plugins: [{ name: 'pass', setup(p) { p.keys.add('Shift+Q', () => {}, 'Demo: Q'); p.ui.toast('Merhaba'); } }] };
        });
        await page.waitForTimeout(300);
        const toast = await page.evaluate(() => {
            const t = document.getElementById('player').shadowRoot.querySelector('[part="plugin-toast"]');
            return { text: t?.textContent, visible: !!t?.hasAttribute('data-visible'), role: t?.getAttribute('role') };
        });
        ok(toast.text === 'Merhaba' && toast.visible && toast.role === 'status', `toast ${JSON.stringify(toast)}`);
        await page.evaluate(() => document.getElementById('player').focus());
        await page.keyboard.press('Shift+Slash');
        await page.waitForTimeout(200);
        const text = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="shortcuts"]')?.textContent ?? '');
        ok(text.includes('Demo: Q') && text.includes('Shift+Q'), 'eklenti kısayolu ? listesinde');
    } finally {
        await page.close();
    }
}

/** Reklam olaylarını ve durumu kaydeder. */
const AD_PROBE = () => {
    window.__ads = [];
    const el = document.getElementById('player');
    for (const n of ['hp:adstart', 'hp:adend']) el.addEventListener(n, (e) => window.__ads.push(`${n.slice(3)}:${e.detail.type}:${e.detail.plugin ?? '-'}`));
    window.__adState = () => {
        const root = el.shadowRoot;
        const v = root.querySelector('video');
        const layer = root.querySelector('.hp-plugin-ad');
        return { ad: el.isAdPlaying(), paused: v.paused, t: v.currentTime, layer: layer?.textContent ?? null, chrome: root.querySelector('.hp-chrome').style.opacity };
    };
};

async function testMidrollBreak(browser) {
    console.log('\n[5] ads.atTime + requestBreak: içerik durur, kilit, katman, olaylar, Space engelli, ikinci ara reddedilir, sonra kaldığı yerden sürer');
    const { page } = await open(browser);
    try {
        await page.evaluate(() => {
            window.__second = null;
            document.getElementById('player').options = {
                src: '/sample.mp4',
                muted: true,
                plugins: [
                    {
                        name: 'mid',
                        setup(p) {
                            p.ads.atTime(1, () =>
                                p.ads.requestBreak((ad) => {
                                    ad.layer.textContent = 'AD';
                                    p.ads.requestBreak(() => {}).then((r) => (window.__second = r));
                                    return new Promise((r) => setTimeout(r, 1200));
                                })
                            );
                        },
                    },
                ],
            };
        });
        await page.waitForTimeout(400);
        await page.evaluate(AD_PROBE);
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForFunction(() => window.__ads.length > 0, null, { timeout: 5000 });
        await page.waitForTimeout(150);
        const during = await page.evaluate(() => window.__adState());
        ok(during.ad && during.paused && during.layer === 'AD' && during.chrome === '0', `arada: isAdPlaying, durdu, katman, kontroller gizli ${JSON.stringify(during)}`);
        ok((await page.evaluate(() => window.__second)) === false, 'süren ara varken ikinci istek false');
        await page.evaluate(() => document.getElementById('player').focus());
        await page.keyboard.press('Space');
        await page.waitForTimeout(150);
        ok((await page.evaluate(() => window.__adState())).paused, 'Space içeriği oynatmadı');
        await page.waitForFunction(() => window.__ads.length >= 2, null, { timeout: 4000 });
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => window.__adState());
        const log = await page.evaluate(() => window.__ads);
        ok(JSON.stringify(log) === '["adstart:midroll:mid","adend:midroll:mid"]', `olaylar ${JSON.stringify(log)}`);
        ok(!after.ad && !after.paused && after.layer === null && after.t > during.t, `sonra: oynuyor, katman yok ${JSON.stringify(after)}`);
    } finally {
        await page.close();
    }
}

async function testPrerollGateAndPause(browser) {
    console.log('\n[6] ads.beforeContent: ilk oynatma arayı bekler (preroll); ads.onPause: gecikmeli, oynatınca temizlik; kaldırınca kancalar gider');
    const { page } = await open(browser);
    try {
        await page.evaluate(() => {
            window.__pause = [];
            document.getElementById('player').options = {
                src: '/sample.mp4',
                muted: true,
                plugins: [
                    {
                        name: 'pre',
                        setup(p) {
                            p.ads.beforeContent(() =>
                                p.ads.requestBreak((ad) => {
                                    ad.layer.textContent = 'PRE';
                                    return new Promise((r) => setTimeout(r, 900));
                                })
                            );
                            p.ads.onPause(
                                () => {
                                    window.__pause.push('show');
                                    return () => window.__pause.push('hide');
                                },
                                { delayMs: 200 }
                            );
                        },
                    },
                ],
            };
        });
        await page.waitForTimeout(400);
        await page.evaluate(AD_PROBE);
        await page.evaluate(() => document.getElementById('player').play().catch(() => {}));
        await page.waitForTimeout(400);
        const during = await page.evaluate(() => window.__adState());
        ok(during.ad && during.paused && during.t < 0.1 && during.layer === 'PRE', `preroll sürerken içerik başlamadı ${JSON.stringify(during)}`);
        await page.waitForFunction(() => window.__ads.length >= 2, null, { timeout: 4000 });
        await page.waitForTimeout(600);
        const after = await page.evaluate(() => window.__adState());
        ok(!after.paused && after.t > 0, `preroll sonrası içerik oynuyor ${JSON.stringify(after)}`);
        ok((await page.evaluate(() => window.__ads[0])) === 'adstart:preroll:pre', 'tür preroll');

        await page.evaluate(() => document.getElementById('player').pause());
        await page.waitForTimeout(80);
        ok((await page.evaluate(() => window.__pause.length)) === 0, 'onPause gecikmeden önce çalışmadı');
        await page.waitForTimeout(300);
        await page.evaluate(() => document.getElementById('player').play());
        await page.waitForTimeout(200);
        const seq = await page.evaluate(() => window.__pause.join(','));
        ok(seq === 'show,hide', `onPause gösterildi, oynatınca temizlendi (${seq})`);

        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, plugins: [] };
        });
        await page.waitForTimeout(300);
        await page.evaluate(() => document.getElementById('player').pause());
        await page.waitForTimeout(400);
        ok((await page.evaluate(() => window.__pause.length)) === 2, 'eklenti kalkınca onPause gitti');
    } finally {
        await page.close();
    }
}

async function testPostrollWithPlaylist(browser) {
    console.log('\n[7] ads.onEnded: postroll arası; playlist sonraki öğeye ara bitince geçer');
    const { page } = await open(browser);
    try {
        await page.evaluate(() => {
            document.getElementById('player').options = {
                muted: true,
                playlist: {
                    items: [
                        { title: 'A', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] },
                        { title: 'B', mp4: [{ src: '/sample-240p.mp4', label: 'Oto', selected: true }] },
                    ],
                },
                plugins: [{ name: 'post', setup(p) { p.ads.onEnded(() => p.ads.requestBreak(() => new Promise((r) => setTimeout(r, 1000)))); } }],
            };
        });
        await page.waitForTimeout(600);
        await page.evaluate(AD_PROBE);
        await page.evaluate(async () => {
            const v = document.getElementById('player').shadowRoot.querySelector('video');
            v.addEventListener('loadstart', () => window.__ads.push('loadstart'));
            await v.play();
            await new Promise((r) => setTimeout(r, 200));
            v.currentTime = Math.max(0, v.duration - 0.4);
        });
        await page.waitForFunction(() => window.__ads.length > 0, null, { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(300);
        const during = await page.evaluate(() => ({ ...window.__adState(), log: window.__ads.slice() }));
        ok(during.ad && !during.log.includes('loadstart'), `postroll sürerken playlist geçmedi ${JSON.stringify(during)}`);
        ok(during.log[0] === 'adstart:postroll:post', `tür postroll (${during.log[0]})`);
        await page.waitForFunction(() => window.__ads.includes('loadstart'), null, { timeout: 5000 }).catch(() => {});
        const log = await page.evaluate(() => window.__ads);
        ok(JSON.stringify(log) === '["adstart:postroll:post","adend:postroll:post","loadstart"]', `ara bitince sonraki öğe yüklendi ${JSON.stringify(log)}`);
    } finally {
        await page.close();
    }
}

async function testTransformTag(browser) {
    console.log('\n[8] ads.transformTag: IMA isteğinden önce tag adresi değişiyor (tür bilgisiyle)');
    const page = await browser.newPage();
    try {
        await page.addInitScript(MOCK_IMA);
        await page.goto(`${BASE}/`);
        await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
        await page.evaluate(() => {
            document.getElementById('player').options = {
                src: '/sample.mp4',
                muted: true,
                ads: { adTagPreroll: 'https://example.com/vast/preroll', requestWhen: 'load' },
                plugins: [{ name: 'tag', setup(p) { p.ads.transformTag((url, type) => `${url}&plug=${type}`); } }],
            };
        });
        await page.waitForFunction(() => window.__adsLog?.some((e) => e.ev === 'requestAds'), null, { timeout: 6000 }).catch(() => {});
        const url = await page.evaluate(() => window.__adsLog?.filter((e) => e.ev === 'requestAds').at(-1)?.adTagUrl ?? '');
        ok(url.startsWith('https://example.com/vast/preroll') && url.endsWith('&plug=preroll'), `tag dönüştürüldü (…${url.slice(-30)})`);
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testInstallAndUi(browser);
        await testCleanupAndUpdate(browser);
        await testErrorsAndRegistration(browser);
        await testLayerClicksAndShortcutList(browser);
        await testMidrollBreak(browser);
        await testPrerollGateAndPause(browser);
        await testPostrollWithPlaylist(browser);
        await testTransformTag(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
