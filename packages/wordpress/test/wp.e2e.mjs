// WordPress plugin e2e: shortcode, block, settings, core Video replacement, editor preview.
// Needs the compose stack + setup.mjs (see docker-compose.yml). HOPE_BROWSER=firefox|webkit works too.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER, launchBrowser } from '../../../apps/playground/test/_browser.mjs';

// Playwright WebKit build has no HLS — the block test uses MP4 there.
const HLS = BROWSER !== 'webkit';

const BASE = process.env.WP_BASE ?? 'http://localhost:8890';
const compose = join(dirname(fileURLToPath(import.meta.url)), 'docker-compose.yml');
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

const wp = (...args) => {
    const r = spawnSync('docker', ['compose', '-f', compose, 'run', '--rm', '-T', 'cli', ...args], {
        encoding: 'utf8',
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
    if (r.status !== 0) throw new Error(`wp ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
};
const debugLog = () =>
    spawnSync('docker', ['compose', '-f', compose, 'exec', '-T', 'wordpress', 'sh', '-c', 'cat /var/www/html/wp-content/debug.log 2>/dev/null || true'], { encoding: 'utf8' }).stdout;
const settings = (values) => wp('option', 'update', 'hopecoreplayer_settings', JSON.stringify(values), '--format=json');
const post = (title, content) => {
    const id = wp('post', 'create', `--post_title=${title}`, `--post_content=${content}`, '--post_status=publish', '--porcelain');
    return wp('post', 'list', `--post__in=${id}`, '--field=url');
};

/** Front-end player state after the options are applied. */
async function playerState(page) {
    await page.waitForFunction(() => document.querySelector('hope-player')?.shadowRoot?.querySelector('video')?.readyState >= 1, null, { timeout: 15000 });
    return page.evaluate(() => {
        const el = document.querySelector('hope-player');
        const s = el.shadowRoot;
        return {
            count: document.querySelectorAll('hope-player').length,
            options: JSON.parse(el.getAttribute('data-hp-options')),
            src: s.querySelector('video').currentSrc,
            duration: s.querySelector('video').duration,
            chapters: s.querySelectorAll('.hp-chapter').length,
            theme: el.getAttribute('theme') ?? el.dataset.theme ?? null,
            nativeVideo: document.querySelectorAll('video:not([part])').length,
        };
    });
}

async function testShortcode(browser) {
    console.log('\n[1] [hopeplayer] kısa kodu: dosya, kapak, altyazı');
    const url = post('Shortcode', '[hopeplayer src="/media/sample-30s.mp4" poster="/media/sample-cover.jpg" subtitles="/media/sample.vtt|Türkçe|tr, /media/sample.en.vtt|English|en" title="Örnek"]');
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    const st = await playerState(page);
    ok(st.count === 1 && /sample-30s\.mp4/.test(st.src), `player kuruldu, video yüklendi (${st.src})`);
    ok(st.options.poster?.endsWith('sample-cover.jpg') && st.options.subtitles?.length === 2, `kapak ve 2 altyazı (${JSON.stringify(st.options.subtitles)})`);
    ok(st.options.subtitles?.[0]?.default === true && st.options.subtitles?.[1]?.srclang === 'en', 'ilk altyazı varsayılan, dil kodları doğru');
    ok(Math.round(st.duration) === 30, `süre 30 sn (${st.duration})`);
    // Sessiz oynatma (test hoparlöre ses vermez).
    const played = await page.evaluate(async () => {
        const v = document.querySelector('hope-player').shadowRoot.querySelector('video');
        v.muted = true;
        await v.play();
        await new Promise((r) => setTimeout(r, 800));
        const t = v.currentTime;
        v.pause();
        return t;
    });
    ok(played > 0.3, `oynuyor (${played.toFixed(2)} sn)`);
    ok(errors.length === 0, `sayfa hatası yok (${errors.join(' | ')})`);
    await page.close();
}

async function testBlock(browser) {
    console.log('\n[2] Blok: HLS + bölümler + tema + gelişmiş JSON');
    const attrs = {
        src: HLS ? '/media/hls/master.m3u8' : '/media/sample-240p.mp4',
        theme: 'mono',
        chapters: [
            { start: 0, text: 'Giriş' },
            { start: 3, text: 'Orta' },
            { start: 6, text: 'Son' },
        ],
        advanced: '{"playbackRates":[1,1.5,2]}',
        sticky: 'on',
    };
    const url = post('Block', `<!-- wp:hopecoreplayer/player ${JSON.stringify(attrs)} /-->`);
    const page = await browser.newPage();
    await page.goto(url);
    const st = await playerState(page);
    ok(HLS ? st.options.sources?.[0]?.type === 'application/x-mpegURL' : /sample-240p/.test(st.options.src), `kaynak doğru türle verildi (${JSON.stringify(st.options.sources ?? st.options.src)})`);
    ok(st.options.theme === 'mono' && JSON.stringify(st.options.playbackRates) === '[1,1.5,2]', 'tema ve gelişmiş JSON uygulandı');
    ok(st.options.segments?.length === 3 && st.options.segments[0].end === 3 && st.options.segments[2].end === undefined, `bölümler: bitişler sonraki başlangıç (${JSON.stringify(st.options.segments)})`);
    ok(!!st.options.sticky, 'sticky açık');
    await page.waitForFunction(() => document.querySelector('hope-player').shadowRoot.querySelectorAll('.hp-chapter').length === 3, null, { timeout: 10000 }).catch(() => {});
    const ch = await playerState(page);
    ok(ch.chapters === 3, `ilerleme çubuğunda 3 bölüm (${ch.chapters}, süre ${ch.duration})`);
    const wrap = await page.evaluate(() => document.querySelector('hope-player').parentElement.className);
    ok(/wp-block-hopecoreplayer-player/.test(wrap), `blok sarmalayıcısı (${wrap})`);
    await page.close();
}

async function testSettingsAndAds(browser) {
    console.log('\n[3] Ayarlar: site geneli tema / reklam; blok reklamı kapatabiliyor');
    settings({ theme: 'neo-dark', ads_enabled: true, ad_preroll: 'https://ads.example.com/vast.xml', ad_midroll: '', ad_postroll: '', ad_vmap: '', sticky: false, pip: true });
    const on = post('Ads', '<!-- wp:hopecoreplayer/player {"src":"/media/sample-30s.mp4"} /-->');
    const off = post('No ads', '<!-- wp:hopecoreplayer/player {"src":"/media/sample-30s.mp4","ads":"off"} /-->');
    const page = await browser.newPage();
    // IMA'yı yükleme — yalnızca seçenekler doğrulanıyor.
    await page.route(/imasdk\.googleapis\.com|ads\.example\.com/, (r) => r.abort());
    const opts = async (url) => {
        await page.goto(url);
        return page.evaluate(() => JSON.parse(document.querySelector('hope-player').getAttribute('data-hp-options')));
    };
    const a = await opts(on);
    ok(a.theme === 'neo-dark' && a.ads?.adTagPreroll === 'https://ads.example.com/vast.xml', `site geneli tema ve reklam (${JSON.stringify(a.ads)})`);
    const b = await opts(off);
    ok(b.ads === undefined, 'blokta "Reklam yok" → reklam seçeneği yok');
    settings({});
    const c = await opts(on);
    ok(c.ads === undefined && c.theme === 'glass-dark', 'varsayılanda reklam kapalı');

    // Vurgu rengi: site geneli, blok kendi rengini verirse o.
    settings({ accent: '#ff3366' });
    const own = post('Accent', '<!-- wp:hopecoreplayer/player {"src":"/media/sample-30s.mp4","accent":"#22cc88"} /-->');
    const accent = async (url) => {
        await page.goto(url);
        await page.waitForFunction(() => document.querySelector('hope-player')?.shadowRoot?.querySelector('[part="seek-bar"]'));
        return page.evaluate(() => {
            const el = document.querySelector('hope-player');
            return { css: getComputedStyle(el).getPropertyValue('--hp-color-accent').trim(), played: getComputedStyle(el.shadowRoot.querySelector('[part="seek-bar"] .hp\\:bg-accent')).backgroundColor };
        });
    };
    const site = await accent(on);
    ok(site.css === '#ff3366' && site.played === 'rgb(255, 51, 102)', `site geneli vurgu rengi player'a uygulandı (${JSON.stringify(site)})`);
    const block = await accent(own);
    ok(block.css === '#22cc88', `blok rengi site rengini eziyor (${block.css})`);
    settings({});
    await page.close();
}

async function testCoreVideo(browser) {
    console.log('\n[4] Çekirdek Video bloğu: ayar kapalıyken dokunulmaz, açıkken HopeCorePlayer');
    const content =
        '<!-- wp:video {"tracks":[{"src":"/media/sample.vtt","label":"Türkçe","srcLang":"tr","kind":"subtitles"}]} --><figure class="wp-block-video"><video controls src="/media/sample-30s.mp4" poster="/media/sample-cover.jpg"></video><figcaption class="wp-element-caption">Altyazı metni</figcaption></figure><!-- /wp:video -->';
    const url = post('Core video', content);
    const page = await browser.newPage();
    await page.goto(url);
    const before = await page.evaluate(() => ({ native: document.querySelectorAll('video').length, hp: document.querySelectorAll('hope-player').length }));
    ok(before.native === 1 && before.hp === 0, `ayar kapalı: WordPress'in kendi videosu (${JSON.stringify(before)})`);
    settings({ replace_core_video: true });
    await page.goto(url);
    const st = await playerState(page);
    const caption = await page.evaluate(() => document.querySelector('figure.hopecoreplayer-core-video figcaption')?.textContent);
    ok(st.count === 1 && st.nativeVideo === 0, 'ayar açık: HopeCorePlayer, sayfada başka video yok');
    ok(st.options.poster?.endsWith('sample-cover.jpg') && st.options.subtitles?.[0]?.srclang === 'tr', `kapak ve altyazı bloktan alındı (${JSON.stringify(st.options.subtitles)})`);
    ok(caption === 'Altyazı metni', 'blok açıklaması korundu');
    const sc = post('Video shortcode', '[video src="/media/sample-30s.mp4" loop="on"]');
    await page.goto(sc);
    const st2 = await playerState(page);
    ok(st2.count === 1 && st2.options.loop === true, '[video] kısa kodu da HopeCorePlayer (loop korundu)');
    settings({});
    await page.close();
}

async function testEditor(browser) {
    console.log('\n[5] Editör: blok eklenir, editörde gerçek player önizlemesi, kaydedince sitede');
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/wp-login.php`);
    await page.fill('#user_login', 'admin');
    await page.fill('#user_pass', 'admin');
    await page.click('#wp-submit');
    await page.waitForURL(/wp-admin/);
    await page.goto(`${BASE}/wp-admin/post-new.php`);
    await page.waitForFunction(() => window.wp?.data?.select('core/block-editor') && window.wp.blocks.getBlockType('hopecoreplayer/player') && window.wp.data.select('core/editor').getCurrentPostId() && window.wp.data.select('core/editor').__unstableIsEditorReady?.() !== false, null, { timeout: 30000 });
    // Hoş geldin penceresi.
    await page.evaluate(() => window.wp.data.dispatch('core/preferences')?.set('core/edit-post', 'welcomeGuide', false));
    // Yavaş açılan editör ilk içeriği sonradan yazabiliyor (WebKit): blok görünene kadar yeniden ekle.
    await page.waitForFunction(() => {
        const be = window.wp.data.select('core/block-editor');
        if (be.getBlocks().some((b) => b.name === 'hopecoreplayer/player')) return true;
        window.wp.data.dispatch('core/block-editor').insertBlocks(window.wp.blocks.createBlock('hopecoreplayer/player', { src: '/media/sample-30s.mp4', title: 'Editör' }));
        window.wp.data.dispatch('core/editor').editPost({ title: 'Editor test' });
        return false;
    }, null, { timeout: 20000, polling: 1000 });
    // Editör iframe'i (blok API 3) ya da doğrudan sayfa.
    const frame = page.frameLocator('iframe[name="editor-canvas"]');
    const preview = await frame
        .locator('hope-player')
        .first()
        .evaluate(
            (el) =>
                new Promise((res) => {
                    const t0 = Date.now();
                    const tick = () => {
                        const v = el.shadowRoot?.querySelector('video');
                        if (v && v.readyState >= 1) return res({ ok: true, src: v.currentSrc, sticky: !!el.options?.sticky });
                        if (Date.now() - t0 > 15000) return res({ ok: false });
                        setTimeout(tick, 200);
                    };
                    tick();
                })
        )
        .catch((e) => ({ ok: false, err: e.message }));
    ok(preview.ok && /sample-30s/.test(preview.src), `editörde gerçek player önizlemesi (${JSON.stringify(preview)})`);
    await page.evaluate(() => window.wp.data.dispatch('core/editor').editPost({ status: 'publish' }));
    await page.evaluate(() => window.wp.data.dispatch('core/editor').savePost());
    await page.waitForFunction(() => !window.wp.data.select('core/editor').isSavingPost() && window.wp.data.select('core/editor').getCurrentPost().status === 'publish', null, { timeout: 20000 });
    const link = await page.evaluate(() => window.wp.data.select('core/editor').getCurrentPost().link);
    const front = await context.newPage();
    await front.goto(link);
    const st = await playerState(front);
    ok(/sample-30s/.test(st.src) && st.options.title === undefined, `kaydedilen yazıda player (${st.src})`);
    ok(errors.length === 0, `editörde sayfa hatası yok (${errors.join(' | ')})`);
    await context.close();
}

async function testSettingsPage(browser) {
    console.log('\n[6] Ayarlar sayfası: kaydedilir, geçersiz JSON reddedilir');
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/wp-login.php`);
    await page.fill('#user_login', 'admin');
    await page.fill('#user_pass', 'admin');
    await page.click('#wp-submit');
    await page.waitForURL(/wp-admin/);
    await page.goto(`${BASE}/wp-admin/options-general.php?page=hopecoreplayer`);
    await page.selectOption('#hp-theme', 'glass-light');
    await page.check('input[name="hopecoreplayer_settings[sticky]"]');
    await page.fill('#hp-advanced', '{ "skipButtons": true ');
    await Promise.all([page.waitForURL(/settings-updated/), page.click('#submit')]);
    const notice = await page.locator('.notice, .error, .updated').allTextContents();
    const saved = JSON.parse(wp('option', 'get', 'hopecoreplayer_settings', '--format=json'));
    ok(saved.theme === 'glass-light' && saved.sticky === true, `kaydedildi (${saved.theme}, sticky=${saved.sticky})`);
    ok(saved.advanced === '' && notice.some((t) => /JSON/.test(t)), `geçersiz JSON reddedildi, uyarı gösterildi (${notice.join(' / ').slice(0, 120)})`);
    settings({});
    await context.close();
}

async function testAudioAndPlaylist(browser) {
    console.log('\n[7] Ses player\'ı (kapak, başlık, sanatçı) ve oynatma listesi');
    const audio = post('Audio', '[hopeplayer src="/media/sample-audio.mp3" audio="yes" poster="/media/sample-cover.jpg" title="Parça" artist="Sanatçı"]');
    const page = await browser.newPage();
    await page.goto(audio);
    const a = await playerState(page);
    ok(a.options.audio?.cover?.endsWith('sample-cover.jpg') && a.options.audio.title === 'Parça' && a.options.audio.artist === 'Sanatçı', `ses modu (${JSON.stringify(a.options.audio)})`);
    const mode = await page.evaluate(() => document.querySelector('hope-player').hasAttribute('data-audio') || !!document.querySelector('hope-player').shadowRoot.querySelector('.hp-audio-stage, [part="audio-stage"]'));
    ok(mode, 'player ses görünümünde');
    const attrs = {
        playlist: [
            { src: '/media/sample-30s.mp4', title: 'Bir', image: '/media/sample-cover.jpg' },
            { src: '/media/hls/master.m3u8', title: 'İki' },
        ],
    };
    const list = post('Playlist', `<!-- wp:hopecoreplayer/player ${JSON.stringify(attrs)} /-->`);
    await page.goto(list);
    const p = await playerState(page);
    ok(p.options.playlist?.items?.length === 2 && p.options.playlist.items[0].mp4 && p.options.playlist.items[1].hls, `liste: MP4 + HLS öğeleri (${JSON.stringify(p.options.playlist.items.map((i) => Object.keys(i)))})`);
    ok(/sample-30s/.test(p.src), `ilk öğe oynamaya hazır (${p.src})`);
    await page.close();
}

const browser = await launchBrowser();
try {
    await testAudioAndPlaylist(browser);
    settings({});
    await testShortcode(browser);
    await testBlock(browser);
    await testSettingsAndAds(browser);
    await testCoreVideo(browser);
    await testEditor(browser);
    await testSettingsPage(browser);
    const log = debugLog().trim();
    ok(!log, `PHP uyarısı / hatası yok${log ? `:\n${log.slice(-1500)}` : ''}`);
} finally {
    await browser.close();
}
console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
process.exit(failures === 0 ? 0 : 1);
