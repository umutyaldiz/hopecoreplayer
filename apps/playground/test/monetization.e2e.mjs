// HopeCorePlayer — gelir modelleri: ödüllü reklamla kalite kilidi (rewardedUnlock) ve sponsorluk katmanı (sponsorship).
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

const root = (page, fn, arg) => page.evaluate(fn, arg);

async function openRewarded(browser, kind = 'mp4') {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.addInitScript(() => {
        window.__rwEvents = [];
        document.addEventListener('DOMContentLoaded', () => {
            const el = document.getElementById('player');
            for (const t of ['hp:rewardedprompt', 'hp:rewardedgranted', 'hp:rewardedclosed', 'hp:rewardednofill'])
                el?.addEventListener(t, (e) => window.__rwEvents.push(`${t.slice(3)}${e.detail?.declined ? ':declined' : ''}`));
        });
    });
    await page.goto(`${BASE}/?feature=rewarded&kind=${kind}`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video')?.currentSrc, null, { timeout: 8000 });
    await page.waitForTimeout(400);
    return page;
}

const state = (page) =>
    root(page, () => {
        const r = document.getElementById('player').shadowRoot;
        const btn = r.querySelector('[part="rewarded-button"]');
        const dlg = r.querySelector('[part="rewarded-dialog"]');
        return {
            src: r.querySelector('video').currentSrc.split('/').pop(),
            button: btn && !btn.hidden ? btn.textContent : null,
            dialog: dlg ? { phase: dlg.getAttribute('data-phase'), text: dlg.textContent } : null,
            toast: r.querySelector('[part="rewarded-toast"]')?.textContent ?? null,
            calls: window.__rewardedCalls,
            events: window.__rwEvents.slice(),
        };
    });

const qualityRows = (page) =>
    root(page, async () => {
        const r = document.getElementById('player').shadowRoot;
        r.querySelector('button[aria-label="Ayarlar"]').click();
        await new Promise((res) => setTimeout(res, 120));
        [...r.querySelector('.hp-chip-panel').querySelectorAll('button')].find((b) => /^Kalite/.test(b.textContent))?.click();
        await new Promise((res) => setTimeout(res, 120));
        return [...r.querySelector('.hp-chip-panel').querySelectorAll('button')].map((b) => `${b.textContent.trim()}${b.hasAttribute('data-locked') ? '🔒' : ''}`);
    });

const clickDialog = (page, label) =>
    root(page, (label) => {
        const r = document.getElementById('player').shadowRoot;
        [...r.querySelectorAll('[part="rewarded-dialog"] button')].find((b) => b.textContent === label)?.click();
    }, label);

async function testRewardedMp4(browser) {
    console.log('\n[1] Ödüllü reklam (MP4): düşük kalitede başlar, kilitli kalite menüde, buton görünür');
    const page = await openRewarded(browser);
    let s = await state(page);
    ok(s.src === 'sample-240p.mp4', `selected 720p kilitli → serbest olan 240p ile başladı (${s.src})`);
    ok(s.button === '720p kilidini aç', `buton: "${s.button}"`);
    const rows = await qualityRows(page);
    ok(rows.includes('720p🔒') && rows.includes('240p'), `kalite menüsü: ${rows.join(' | ')}`);

    console.log('\n[2] Onay penceresi: ödül açıkça yazılı; "Vazgeç" reklam istemez, video kaliteyi korur');
    // Menüdeki kilitli 720p satırına tıklamak da onay penceresini açar.
    await root(page, () => [...document.getElementById('player').shadowRoot.querySelectorAll('.hp-chip-panel button')].find((b) => b.hasAttribute('data-locked')).click());
    await page.waitForTimeout(150);
    s = await state(page);
    ok(s.dialog?.phase === 'prompt' && /reklam izleyin, 720p kalitesi bu video boyunca/.test(s.dialog.text), `kilitli kaliteye dokununca onay (${s.dialog?.text})`);
    await clickDialog(page, 'Vazgeç');
    await page.waitForTimeout(150);
    s = await state(page);
    ok(!s.dialog && s.calls === 0 && s.src === 'sample-240p.mp4', `vazgeç: reklam istenmedi (çağrı ${s.calls}), 240p'de kaldı`);
    ok(s.events.includes('rewardedclosed:declined'), `olaylar: ${s.events.join(', ')}`);

    console.log('\n[3] Reklam kapandı (ödülsüz) → kilit kalır, oynatma devam eder; reklam yok → bilgi');
    await root(page, () => (window.__rewardedResult = 'closed'));
    await root(page, () => document.getElementById('player').play());
    await page.waitForTimeout(300);
    await root(page, () => document.getElementById('player').shadowRoot.querySelector('[part="rewarded-button"]').click());
    await page.waitForTimeout(100);
    await clickDialog(page, 'Reklamı izle');
    await page.waitForTimeout(500);
    s = await state(page);
    const playing = await root(page, () => !document.getElementById('player').shadowRoot.querySelector('video').paused);
    ok(!s.dialog && s.src === 'sample-240p.mp4' && s.button && playing, `kapandı: kilit duruyor, oynatma devam (${playing})`);

    await root(page, () => {
        window.__rewardedResult = 'nofill';
        const el = document.getElementById('player');
        el.options = { ...el.options, rewardedUnlock: { ...el.options.rewardedUnlock, grantOnNoFill: false } };
    });
    await page.waitForTimeout(200);
    await root(page, () => document.getElementById('player').shadowRoot.querySelector('[part="rewarded-button"]').click());
    await page.waitForTimeout(100);
    await clickDialog(page, 'Reklamı izle');
    await page.waitForTimeout(500);
    s = await state(page);
    ok(s.dialog?.phase === 'nofill' && /gösterilecek reklam yok/.test(s.dialog.text) && s.src === 'sample-240p.mp4', `grantOnNoFill: false → "reklam yok" bilgisi, kilit kapalı`);
    await clickDialog(page, 'Tamam');
    await root(page, () => {
        const el = document.getElementById('player');
        const { grantOnNoFill, ...rest } = el.options.rewardedUnlock;
        el.options = { ...el.options, rewardedUnlock: rest };
    });
    await page.waitForTimeout(200);

    console.log('\n[4] Ödül → yüksek kalite açılır, aynı yerden devam; seçenek yeniden uygulanınca geri düşmez');
    await root(page, () => (window.__rewardedResult = 'granted'));
    await root(page, () => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        v.currentTime = 4;
    });
    await page.waitForTimeout(300);
    await root(page, () => document.getElementById('player').shadowRoot.querySelector('[part="rewarded-button"]').click());
    await page.waitForTimeout(100);
    await clickDialog(page, 'Reklamı izle');
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentSrc.endsWith('/sample.mp4'), null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
    s = await state(page);
    const t = await root(page, () => document.getElementById('player').shadowRoot.querySelector('video').currentTime);
    ok(s.src === 'sample.mp4' && t >= 3.9, `720p'ye geçti (${s.src}), konum korundu (${t.toFixed(1)} sn)`);
    ok(!s.button && s.toast === '720p açıldı', `buton gizlendi, bildirim: "${s.toast}"`);
    ok(s.events.includes('rewardedgranted'), 'hp:rewardedgranted');
    const rows2 = await qualityRows(page);
    ok(!rows2.some((r) => r.includes('🔒')), `menüde kilit kalmadı (${rows2.join(' | ')})`);
    await root(page, () => {
        const el = document.getElementById('player');
        el.options = { ...el.options, muted: true };
    });
    await page.waitForTimeout(500);
    s = await state(page);
    ok(s.src === 'sample.mp4', `seçenek yeniden uygulandı, 720p korundu (${s.src})`);

    console.log("\n[5] unlockFor: 'video' — kaynak değişince kilit geri gelir");
    await root(page, () => {
        const el = document.getElementById('player');
        el.options = { ...el.options, sources: [{ src: '/sample.mp4?b', label: '720p', selected: true }, { src: '/sample-240p.mp4?b', label: '240p' }] };
    });
    await page.waitForTimeout(800);
    s = await state(page);
    ok(s.src === 'sample-240p.mp4?b' && s.button === '720p kilidini aç', `yeni video 240p'de, kilitli (${s.src})`);
    await page.close();
}

async function testRewardedNoFillGrants(browser) {
    console.log('\n[3b] Varsayılan: reklam yok / hata → kilit yine de açılır ("şu an reklam yoktu" bildirimi)');
    for (const [name, result] of [['reklam yok', 'nofill'], ['sağlayıcı hata attı', 'throw']]) {
        const page = await openRewarded(browser);
        await root(page, (result) => {
            const el = document.getElementById('player');
            const show = result === 'throw' ? async () => { throw new Error('ad server 500'); } : async () => 'nofill';
            el.options = { ...el.options, rewardedUnlock: { ...el.options.rewardedUnlock, provider: { type: 'custom', show } } };
        }, result);
        await page.waitForTimeout(200);
        await root(page, () => document.getElementById('player').shadowRoot.querySelector('[part="rewarded-button"]').click());
        await page.waitForTimeout(100);
        await clickDialog(page, 'Reklamı izle');
        await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').currentSrc.endsWith('/sample.mp4'), null, { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(300);
        const s = await state(page);
        ok(s.src === 'sample.mp4' && !s.dialog && s.toast === 'Şu an reklam yoktu — 720p yine de açıldı', `${name}: kilit açıldı (${s.src}), bildirim: "${s.toast}"`);
        await page.close();
    }
}

async function testRewardedPersist(browser) {
    console.log('\n[5b] unlockFor: 30 (dakika) — kilit tarayıcıda saklanır, sayfa yenilenince yüksek kaliteyle açılır; süre dolunca kilitlenir');
    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/?feature=rewarded&kind=mp4&unlock=30`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video')?.currentSrc, null, { timeout: 8000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="rewarded-button"]').click());
    await page.waitForTimeout(100);
    await page.evaluate(() => [...document.getElementById('player').shadowRoot.querySelectorAll('[part="rewarded-dialog"] button')].find((b) => b.textContent === 'Reklamı izle').click());
    await page.waitForTimeout(800);
    const stored = await page.evaluate(() => Number(localStorage.getItem('hope-rewarded-unlock')) - Date.now());
    ok(stored > 29 * 60_000 && stored <= 30 * 60_000, `30 dk saklandı (${Math.round(stored / 60_000)} dk)`);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video')?.currentSrc, null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const src = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentSrc.split('/').pop());
    ok(src === 'sample.mp4', `yenilenince doğrudan 720p (${src})`);
    await page.evaluate(() => localStorage.setItem('hope-rewarded-unlock', String(Date.now() - 1000)));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video')?.currentSrc, null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const src2 = await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentSrc.split('/').pop());
    ok(src2 === 'sample-240p.mp4', `süre dolunca yine kilitli (${src2})`);
    await context.close();
}

async function testRewardedGptFailures(browser) {
    console.log('\n[5c] GPT yüklenemez / yanıt vermez → zaman aşımında "reklam yok" (takılma yok); hazırlanırken "Vazgeç"');
    const run = async (handler, timeoutMs, cancelAfter, grantOnNoFill = false) => {
        const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
        await context.route(/securepubads\.g\.doubleclick\.net|googlesyndication\.com/, handler);
        const page = await context.newPage();
        await page.goto(`${BASE}/?feature=rewarded&kind=mp4`);
        await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('[part="rewarded-button"]:not([hidden])'), null, { timeout: 8000 });
        await page.evaluate(([timeoutMs, grantOnNoFill]) => {
            window.__ev = [];
            const el = document.getElementById('player');
            for (const t of ['hp:rewardedclosed', 'hp:rewardednofill', 'hp:rewardedgranted'])
                el.addEventListener(t, (e) => window.__ev.push(t.slice(3) + (e.detail?.cancelled ? ':cancelled' : '') + (e.detail?.noAd ? ':noAd' : '')));
            el.options = { ...el.options, rewardedUnlock: { ...el.options.rewardedUnlock, grantOnNoFill, provider: { type: 'gpt', adUnitPath: '/22639388115/rewarded_web_example', timeoutMs } } };
        }, [timeoutMs, grantOnNoFill]);
        await page.waitForTimeout(200);
        await page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('[part="rewarded-button"]').click());
        await page.waitForTimeout(100);
        await clickDialog(page, 'Reklamı izle');
        if (cancelAfter) {
            await page.waitForTimeout(cancelAfter);
            await clickDialog(page, 'Vazgeç');
            await page.waitForTimeout(200);
        } else {
            await page.waitForTimeout(timeoutMs + 600);
        }
        const st = await page.evaluate(() => ({
            ev: window.__ev.slice(),
            phase: document.getElementById('player').shadowRoot.querySelector('[part="rewarded-dialog"]')?.getAttribute('data-phase') ?? null,
            src: document.getElementById('player').shadowRoot.querySelector('video').currentSrc.split('/').pop(),
        }));
        await context.close();
        return st;
    };
    const blocked = await run((r) => r.abort('failed'), 2500);
    ok(blocked.phase === 'nofill' && blocked.ev.includes('rewardednofill'), `gpt.js yüklenemedi → "reklam yok" (${blocked.phase})`);
    const hanging = await run(() => {}, 2500);
    ok(hanging.phase === 'nofill' && hanging.ev.includes('rewardednofill'), `gpt.js yanıt vermiyor → zaman aşımında "reklam yok" (${hanging.phase})`);
    const blockedGrant = await run((r) => r.abort('failed'), 2500, 0, true);
    ok(blockedGrant.ev.includes('rewardedgranted:noAd') && blockedGrant.phase === null, `varsayılan: gpt.js engelli → kilit yine de açıldı (${blockedGrant.ev.join(', ')})`);
    const cancelled = await run(() => {}, 30000, 400, true);
    ok(cancelled.phase === null && cancelled.ev.includes('rewardedclosed:cancelled') && !cancelled.ev.some((e) => e.startsWith('rewardedgranted')) && cancelled.src === 'sample-240p.mp4',
        `hazırlanırken "Vazgeç" → kapandı, kilit açılmadı (${cancelled.ev.join(', ')})`);
}

async function testRewardedHls(browser) {
    console.log('\n[6] Ödüllü reklam (HLS): ABR üst sınırı serbest seviyede; ödülle sınır kalkar');
    const page = await openRewarded(browser, 'hls');
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('[part="rewarded-button"]:not([hidden])'), null, { timeout: 8000 }).catch(() => {});
    let s = await state(page);
    ok(s.button === '360p kilidini aç', `buton: "${s.button}"`);
    const rows = await qualityRows(page);
    ok(rows.includes('360p🔒') && rows.includes('240p'), `HLS menüsü: ${rows.join(' | ')}`);
    await root(page, () => document.getElementById('player').shadowRoot.querySelector('.hp-chip-panel')?.closest('.hp-settings')?.querySelector('button')?.click());
    await root(page, () => document.getElementById('player').play());
    await page.waitForTimeout(2500);
    const h1 = await root(page, () => document.getElementById('player').shadowRoot.querySelector('video').videoHeight);
    ok(h1 === 240, `kilitliyken 240p oynuyor (videoHeight ${h1})`);
    await root(page, () => document.getElementById('player').shadowRoot.querySelector('[part="rewarded-button"]').click());
    await page.waitForTimeout(100);
    await clickDialog(page, 'Reklamı izle');
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('video').videoHeight === 360, null, { timeout: 9000 }).catch(() => {});
    const h2 = await root(page, () => document.getElementById('player').shadowRoot.querySelector('video').videoHeight);
    ok(h2 === 360, `ödülden sonra 360p'ye çıktı (videoHeight ${h2})`);
    await page.close();
}

// ── Sponsorluk ────────────────────────────────────────────────────────────

async function openSponsorship(browser, { body, status = 200, fakeClock = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    // Sponsor bağlantısı yeni sekmede açılıyor — internete çıkmasın (test ağdan bağımsız kalsın).
    await context.route('https://example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>sponsor</title>' }));
    const page = await context.newPage();
    const requests = [];
    page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.pathname === '/sponsorship.json' || u.pathname === '/pixel.gif') requests.push(u.pathname + u.search);
    });
    await page.route('**/pixel.gif*', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
    if (body !== undefined) await page.route('**/sponsorship.json*', (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
    await page.addInitScript(() => {
        window.__spEvents = [];
        document.addEventListener('DOMContentLoaded', () => {
            const el = document.getElementById('player');
            for (const t of ['hp:sponsorship', 'hp:sponsorimpression', 'hp:sponsorclick']) el?.addEventListener(t, () => window.__spEvents.push(t.slice(3)));
        });
    });
    if (fakeClock) await page.clock.install();
    await page.goto(`${BASE}/?feature=sponsorship`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'), null, { timeout: 8000 });
    await page.waitForTimeout(700);
    return { context, page, requests };
}

const sponsorState = (page) =>
    root(page, () => {
        const el = document.getElementById('player');
        const r = el.shadowRoot;
        const logo = r.querySelector('[part="sponsor-logo"]');
        return {
            sponsored: el.hasAttribute('data-sponsored'),
            accent: el.style.getPropertyValue('--hp-color-accent'),
            logoTag: logo?.tagName ?? null,
            href: logo?.getAttribute('href') ?? null,
            position: logo?.getAttribute('data-position') ?? null,
            img: logo?.querySelector('img')?.getAttribute('src') ?? null,
            label: logo?.querySelector('.hp-sponsor-label')?.textContent ?? null,
            intro: r.querySelector('[part="sponsor-intro"]')?.textContent ?? null,
            logoVisible: !!logo && getComputedStyle(logo).display !== 'none',
            events: window.__spEvents.slice(),
        };
    });

async function testSponsorship(browser) {
    console.log('\n[7] Sponsorluk: API isteği (parametreli), renk, logo, etiket');
    const { context, page, requests } = await openSponsorship(browser);
    let s = await sponsorState(page);
    ok(requests.some((r) => r === '/sponsorship.json?channel=demo'), `API isteği: ${requests.join(', ')}`);
    ok(s.sponsored && s.accent === '#c8873a', `tema rengi uygulandı (${s.accent})`);
    ok(s.logoTag === 'A' && s.href?.startsWith('https://example.com/') && s.position === 'top-right' && s.img?.endsWith('/kavrul-logo.svg') && s.label === 'Sunar', `logo: ${JSON.stringify({ tag: s.logoTag, pos: s.position, img: s.img, label: s.label })}`);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('[part="sponsor-logo"] img')?.complete, null, { timeout: 3000 }).catch(() => {});
    const layout = await root(page, () => {
        const r = document.getElementById('player').shadowRoot;
        const img = r.querySelector('[part="sponsor-logo"] img').getBoundingClientRect();
        const label = r.querySelector('.hp-sponsor-label').getBoundingClientRect();
        return { below: label.top >= img.bottom - 0.5, centerDiff: Math.abs(label.left + label.width / 2 - (img.left + img.width / 2)) };
    });
    ok(layout.below && layout.centerDiff < 1, `etiket logonun altında ve ortalı (merkez farkı ${layout.centerDiff.toFixed(1)}px)`);

    console.log('\n[8] Oynatınca: gösterim pikseli bir kez + "Kavrul Coffee sunar" girişi, süre dolunca kalkar');
    await root(page, () => document.getElementById('player').play());
    await page.waitForTimeout(400);
    s = await sponsorState(page);
    ok(s.intro === 'Kavrul Coffee sunar', `giriş kartı: "${s.intro}"`);
    const logoOpacityDuringIntro = await root(page, () => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="sponsor-logo"]')).opacity);
    ok(logoOpacityDuringIntro === '0', `giriş kartı varken köşe logosu gizli (opaklık ${logoOpacityDuringIntro})`);
    await root(page, () => document.getElementById('player').pause());
    await root(page, () => document.getElementById('player').play());
    await page.waitForTimeout(3400);
    s = await sponsorState(page);
    ok(!s.intro, 'giriş kartı süre dolunca kalktı');
    const logoOpacityAfter = await root(page, () => getComputedStyle(document.getElementById('player').shadowRoot.querySelector('[part="sponsor-logo"]')).opacity);
    ok(Number(logoOpacityAfter) > 0.8, `giriş bitince logo göründü (opaklık ${logoOpacityAfter})`);
    ok(requests.filter((r) => r.includes('e=impression')).length === 1, `gösterim pikseli bir kez (${requests.filter((r) => r.includes('e=impression')).length})`);

    console.log('\n[9] Logoya tıklama: yeni sekme + tıklama pikseli + olay; reklam sırasında logo gizli');
    const popup = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
    await root(page, () => document.getElementById('player').shadowRoot.querySelector('[part="sponsor-logo"]').click());
    const tab = await popup;
    ok(!!tab, `yeni sekmede açıldı (${tab?.url() ?? '-'})`);
    await tab?.close();
    await page.waitForTimeout(200);
    ok(requests.some((r) => r.includes('e=click')), 'tıklama pikseli gönderildi');
    s = await sponsorState(page);
    ok(s.events.includes('sponsorship') && s.events.includes('sponsorimpression') && s.events.includes('sponsorclick'), `olaylar: ${s.events.join(', ')}`);
    await root(page, () => document.getElementById('player').dispatchEvent(new CustomEvent('hp:adstart', { detail: { type: 'midroll' } })));
    const hidden = !(await sponsorState(page)).logoVisible;
    await root(page, () => document.getElementById('player').dispatchEvent(new CustomEvent('hp:adend', { detail: { type: 'midroll' } })));
    const back = (await sponsorState(page)).logoVisible;
    ok(hidden && back, 'lineer reklam sırasında gizlendi, sonra geri geldi');

    console.log('\n[10] Katman kaldırılınca renkler eski haline döner');
    await root(page, () => {
        const el = document.getElementById('player');
        const { sponsorship, ...rest } = el.options;
        el.options = rest;
    });
    await page.waitForTimeout(300);
    s = await sponsorState(page);
    ok(!s.sponsored && !s.accent && !s.logoTag, `kaldırıldı (accent "${s.accent}")`);
    await context.close();
}

async function testSponsorshipIntroRepeat(browser) {
    console.log('\n[8b] intro.repeatMinutes: yalnızca izlerken sayar; süre dolunca giriş tekrar; maxShows sınırı; her gösterimde pikseli');
    const { context, page, requests } = await openSponsorship(browser, {
        fakeClock: true,
        body: {
            active: true,
            id: 'repeat-test',
            sponsor: { name: 'Kavrul Coffee', logo: '/kavrul-logo.svg' },
            intro: { durationMs: 2000, repeatMinutes: 1, maxShows: 2 },
            tracking: { intro: ['/pixel.gif?e=intro'] },
        },
    });
    const shows = () => page.evaluate(() => window.__spEvents.filter((e) => e === 'sponsorintro').length);
    await page.evaluate(() => {
        const el = document.getElementById('player');
        el.addEventListener('hp:sponsorintro', () => window.__spEvents.push('sponsorintro'));
        el.shadowRoot.querySelector('video').loop = true;
        return el.play();
    });
    await page.clock.runFor(500);
    ok((await shows()) === 1, `ilk oynatmada giriş (${await shows()})`);

    await page.evaluate(() => document.getElementById('player').pause());
    await page.clock.runFor(70_000);
    ok((await shows()) === 1, `duraklatılmışken 70 sn: tekrar yok (${await shows()})`);

    await page.evaluate(() => document.getElementById('player').play());
    await page.clock.runFor(55_000);
    ok((await shows()) === 1, `izlerken 55 sn: henüz yok (${await shows()})`);
    await page.clock.runFor(5_500);
    ok((await shows()) === 2, `izlerken 1 dk dolunca giriş tekrar (${await shows()})`);
    const visible = await page.evaluate(() => !!document.getElementById('player').shadowRoot.querySelector('[part="sponsor-intro"]'));
    ok(visible, 'tekrar eden giriş ekranda');

    await page.clock.runFor(130_000);
    ok((await shows()) === 2, `maxShows: 2 → üçüncü gösterim yok (${await shows()})`);
    ok(requests.filter((r) => r.includes('e=intro')).length === 2, `giriş pikseli her gösterimde (${requests.filter((r) => r.includes('e=intro')).length})`);
    await context.close();
}

async function testSponsorshipMobile(browser) {
    console.log('\n[10b] Mobil (dar player): sağ üst logo ayarlar çubuğuna ve seek bar\'a binmiyor, küçülüyor');
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.route('**/pixel.gif*', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
    await page.goto(`${BASE}/?feature=sponsorship`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('[part="sponsor-logo"] img')?.complete, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const g = await root(page, () => {
        const r = document.getElementById('player').shadowRoot;
        const box = (n) => n?.getBoundingClientRect();
        const logo = box(r.querySelector('[part="sponsor-logo"]'));
        const top = box(r.querySelector('.hp-top-bar'));
        const seek = box(r.querySelector('[part="seek-bar"]'));
        const hit = (a, b) => !!a && !!b && b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return { compact: r.querySelector('.video-area').hasAttribute('data-compact'), width: Math.round(logo.width), overTop: hit(logo, top), overSeek: hit(logo, seek) };
    });
    ok(g.compact && !g.overTop && !g.overSeek && g.width <= 48, `dar düzen: üst çubukla çakışma ${g.overTop}, seek bar ile ${g.overSeek}, genişlik ${g.width}px`);

    // Kontroller gizlenince logo en sağa kayar, kontroller gelince üst çubuğun soluna döner.
    const rightGap = () =>
        root(page, () => {
            const el = document.getElementById('player');
            const area = el.shadowRoot.querySelector('.video-area').getBoundingClientRect();
            const logo = el.shadowRoot.querySelector('[part="sponsor-logo"]').getBoundingClientRect();
            return { gap: Math.round(area.right - logo.right), hidden: el.shadowRoot.querySelector('.video-area').hasAttribute('data-chrome-hidden') };
        });
    const visibleGap = (await rightGap()).gap;
    await root(page, () => document.getElementById('player').play());
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.video-area').hasAttribute('data-chrome-hidden'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const hiddenState = await rightGap();
    ok(hiddenState.hidden && hiddenState.gap === 12 && visibleGap > 60, `kontroller gizlenince en sağa kaydı (sağ boşluk ${visibleGap}px → ${hiddenState.gap}px)`);
    const box = await page.locator('#player').boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.waitForTimeout(500);
    const shown = await rightGap();
    ok(!shown.hidden && shown.gap === visibleGap, `kontroller gelince üst çubuğun soluna döndü (sağ boşluk ${shown.gap}px)`);
    await context.close();
}

async function testSponsorshipBottomRight(browser) {
    console.log('\n[10c] Alt-sağ logo: kontroller görünürken seek bar\'ın üstünde, gizliyken en altta');
    const { context, page } = await openSponsorship(browser, {
        body: { active: true, sponsor: { name: 'Kavrul Coffee', logo: '/kavrul-logo.svg' }, logo: { position: 'bottom-right', width: 64, label: 'Sunar' } },
    });
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('[part="sponsor-logo"] img')?.complete, null, { timeout: 5000 }).catch(() => {});
    const state = () =>
        root(page, () => {
            const r = document.getElementById('player').shadowRoot;
            const area = r.querySelector('.video-area');
            const a = area.getBoundingClientRect();
            const logo = r.querySelector('[part="sponsor-logo"]').getBoundingClientRect();
            const seek = r.querySelector('[part="seek-bar"]').getBoundingClientRect();
            return { bottomGap: Math.round(a.bottom - logo.bottom), aboveSeek: logo.bottom <= seek.top, hidden: area.hasAttribute('data-chrome-hidden') };
        });
    const box = await page.locator('#player').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    const visible = await state();
    ok(!visible.hidden && visible.aboveSeek, `kontroller görünürken seek bar'ın üstünde (alttan ${visible.bottomGap}px)`);
    await root(page, () => document.getElementById('player').play());
    await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40);
    await page.waitForFunction(() => document.getElementById('player').shadowRoot.querySelector('.video-area').hasAttribute('data-chrome-hidden'), null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(500);
    const hidden = await state();
    ok(hidden.hidden && hidden.bottomGap === 12, `kontroller gizlenince en alta indi (alttan ${hidden.bottomGap}px)`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    const back = await state();
    ok(!back.hidden && back.aboveSeek, `kontroller gelince tekrar seek bar'ın üstünde (alttan ${back.bottomGap}px)`);
    await context.close();
}

async function testSponsorshipValidation(browser) {
    console.log('\n[11] Güvenlik: javascript: adresleri ve geçersiz renkler reddedilir');
    const { context, page } = await openSponsorship(browser, {
        body: {
            active: true,
            sponsor: { name: 'Kötü', logo: 'javascript:alert(1)', url: 'javascript:alert(2)' },
            theme: { accent: 'red; background: url(https://evil.example)' },
            logo: { label: 'Sunar', position: 'middle' },
        },
    });
    const s = await sponsorState(page);
    ok(s.sponsored && s.logoTag === 'DIV' && !s.href && !s.img, `link ve görsel yok (etiket ${s.logoTag})`);
    ok(!s.accent && s.position === 'top-left', `geçersiz renk uygulanmadı, konum varsayılana döndü (${s.position})`);
    await context.close();

    console.log('\n[12] API hatası / pasif kampanya: katman kapalı, player normal');
    for (const [name, opts] of [['HTTP 500', { body: { error: true }, status: 500 }], ['active:false', { body: { active: false, sponsor: { name: 'X' } } }], ['süresi dolmuş', { body: { active: true, sponsor: { name: 'X' }, validUntil: '2020-01-01T00:00:00Z' } }]]) {
        const { context: c2, page: p2 } = await openSponsorship(browser, opts);
        const st = await sponsorState(p2);
        const logged = await root(p2, () => document.getElementById('player').errorLog.entries.some((e) => /Sponsorship API failed/.test(e.message)));
        ok(!st.sponsored && !st.logoTag, `${name}: katman yok${name === 'HTTP 500' ? `, hata kaydı: ${logged}` : ''}`);
        await c2.close();
    }
}

(async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
        await testRewardedMp4(browser);
        await testRewardedNoFillGrants(browser);
        await testRewardedPersist(browser);
        await testRewardedGptFailures(browser);
        await testRewardedHls(browser);
        await testSponsorship(browser);
        await testSponsorshipIntroRepeat(browser);
        await testSponsorshipMobile(browser);
        await testSponsorshipBottomRight(browser);
        await testSponsorshipValidation(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
