// HopeCorePlayer — mobilde kalabalık sağ üst grup daralır ("‹"), açılır ("›"); masaüstü ve az butonda değişmez.
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

async function open(browser, width, extra) {
    const page = await browser.newPage({ viewport: { width, height: 760 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.__errors = errors;
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate((extra) => {
        const el = document.getElementById('player');
        el.options = { ...el.options, ...extra };
    }, extra);
    await page.waitForTimeout(1200);
    return page;
}

const state = (page) =>
    page.evaluate(() => {
        const r = document.getElementById('player').shadowRoot;
        const g = r.querySelector('.hp-top-bar .hp-group');
        const more = r.querySelector('.hp-more');
        const shown = (c) => getComputedStyle(c).display !== 'none';
        return {
            inTop: !!g,
            collapsed: !!g?.hasAttribute('data-collapsed'),
            visible: g ? [...g.children].filter(shown).length : 0,
            settings: !!g && shown(g.querySelector('.hp-settings')),
            more: more ? { shown: shown(more), open: more.hasAttribute('data-open'), text: more.textContent, label: more.getAttribute('aria-label'), expanded: more.getAttribute('aria-expanded') } : null,
            fits: g ? g.getBoundingClientRect().left >= r.querySelector('.video-area').getBoundingClientRect().left : true,
        };
    });
const clickMore = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('.hp-more').click());

async function testCrowdedMobile(browser) {
    console.log('\n[1] Mobilde 5 eklenti butonu: ayarlar + "‹"; açınca hepsi + "›"; kapatınca yine daralır');
    const page = await open(browser, 390, { clips: true, reactions: true, share: true, transcript: true, course: { id: 'overflow-test' } });
    try {
        let s = await state(page);
        ok(s.inTop && s.collapsed && s.visible === 2 && s.settings, `daraltılmış: yalnızca ayarlar ve ok (${s.visible} görünür)`);
        ok(s.more?.shown && s.more.text === '' && s.more.label === 'Diğer kontroller' && s.more.expanded === 'false', `"‹" butonu ${JSON.stringify(s.more)}`);
        await clickMore(page);
        await page.waitForTimeout(200);
        s = await state(page);
        ok(!s.collapsed && s.visible >= 7, `açık: tüm butonlar görünür (${s.visible})`);
        ok(s.more.open && s.more.text === '' && s.more.label === 'Kapat' && s.more.expanded === 'true', `"›" (erişilebilir adı Kapat) ${JSON.stringify(s.more)}`);
        ok(s.fits, 'açıkken grup player dışına taşmıyor');
        await clickMore(page);
        await page.waitForTimeout(200);
        s = await state(page);
        ok(s.collapsed && !s.more.open, '"›" → yeniden daraldı');
        ok(page.__errors.length === 0, `sayfa hatası yok ${JSON.stringify(page.__errors)}`);
    } finally {
        await page.close();
    }
}

async function testFewButtonsAndDesktop(browser) {
    console.log('\n[2] Az buton (yalnızca PiP) → ok yok; buton sonradan eklenince ok çıkar; masaüstünde hiç yok');
    const page = await open(browser, 390, {});
    try {
        let s = await state(page);
        ok(s.inTop && !s.collapsed && !s.more?.shown, `az butonda ok yok (${s.visible} görünür)`);
        await page.evaluate(() => {
            const el = document.getElementById('player');
            el.options = { ...el.options, share: true, clips: true };
        });
        await page.waitForTimeout(800);
        s = await state(page);
        ok(s.collapsed && s.more?.shown, 'eklenti butonları gelince grup kendiliğinden daraldı');
        await page.setViewportSize({ width: 1100, height: 760 });
        await page.waitForTimeout(500);
        s = await state(page);
        ok(!s.inTop && s.more && !s.more.shown, 'masaüstü düzeninde ok yok, butonlar alt çubukta');
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testCrowdedMobile(browser);
        await testFewButtonsAndDesktop(browser);
    } finally {
        await browser.close();
    }
    console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
