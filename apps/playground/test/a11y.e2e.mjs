// HopeCorePlayer — erişilebilirlik (WCAG 2.1 A/AA): axe-core taraması (player'ın açık / etkileşimli durumları dahil),
// klavyeyle Tab sırası ve odak göstergesi.
// Playground çalışıyor olmalı (npm run dev --workspace=apps/playground, port HOPE_TEST_PORT ya da 5183).
import { chromium } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};

/** Player'daki WCAG 2.1 A/AA ihlalleri (sayfa düzeyi kurallar — landmark, başlık — playground'a ait, sayılmaz). */
async function violations(page) {
    await page.addScriptTag({ path: AXE });
    return page.evaluate(async () => {
        const res = await window.axe.run(document.getElementById('player'), {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        });
        return res.violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' > ')).join(' | ')}`);
    });
}

async function open(browser, query = '') {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(`${BASE}/${query}`);
    await page.waitForFunction(() => !!document.getElementById('player')?.shadowRoot?.querySelector('video'), null, { timeout: 8000 });
    await page.waitForTimeout(800);
    await page.mouse.move(450, 300); // kontroller görünür
    return page;
}

const shadow = (page, fn) => page.evaluate(fn);

async function testStates(browser) {
    console.log('\n[1] axe-core: player\'ın durumlarında WCAG 2.1 A/AA ihlali yok');
    const states = [
        ['varsayılan player', '', null],
        ['ayarlar menüsü açık', '', () => document.getElementById('player').shadowRoot.querySelector('button[aria-label="Ayarlar"]').click()],
        ['ses modu (plak)', '?feature=audio', null],
        ['ses modu (kompakt)', '?feature=audio&layout=compact', null],
        ['ödüllü reklam penceresi', '?feature=rewarded', () => document.getElementById('player').shadowRoot.querySelector('[part="rewarded-button"]').click()],
        ['TV\'ye yayın butonu', '?feature=cast', null],
        [
            'yönlendirme kartı',
            '?feature=redirect-card',
            () => {
                const el = document.getElementById('player');
                el.addEventListener('hp:redirect', (e) => e.preventDefault());
                const v = el.shadowRoot.querySelector('video');
                v.currentTime = v.duration - 4;
                void v.play();
            },
        ],
        ['yönlendirme ekranı', '?feature=redirect', () => document.getElementById('player').shadowRoot.querySelector('video').dispatchEvent(new Event('ended'))],
        ['sponsorluk', '?feature=sponsorship', () => void document.getElementById('player').play()],
    ];
    for (const [name, query, action] of states) {
        const page = await open(browser, query);
        if (action) {
            await shadow(page, action);
            await page.waitForTimeout(1200);
        }
        const v = await violations(page);
        ok(v.length === 0, `${name}${v.length ? ': ' + v.join('; ') : ''}`);
        await page.close();
    }
}

async function testKeyboard(browser) {
    console.log('\n[2] Klavye: Tab ile tüm kontrollere ulaşılıyor, odak görünür');
    const page = await open(browser);
    const stops = [];
    for (let i = 0; i < 16; i++) {
        await page.keyboard.press('Tab');
        const f = await shadow(page, () => {
            const a = document.getElementById('player').shadowRoot.activeElement;
            if (!a) return null;
            const cs = getComputedStyle(a);
            const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
            return { name: a.getAttribute('aria-label') || a.textContent.trim(), ring };
        });
        if (f) stops.push(f);
    }
    const names = stops.map((s) => s.name);
    for (const want of ['Oynat', 'Video konumu', 'Sesi aç', 'Ayarlar', 'Tam ekran']) ok(names.includes(want), `Tab ile "${want}" kontrolüne ulaşıldı`);
    const invisible = stops.filter((s) => !s.ring).map((s) => s.name);
    ok(invisible.length === 0, `her odakta görünür odak göstergesi var${invisible.length ? ' — eksik: ' + invisible.join(', ') : ''}`);
    await page.close();
}

async function testHostTabindex(browser) {
    console.log('\n[3] Host tabindex: varsayılan 0 (negatif olursa tüm kontroller Tab sırasından çıkar); sayfanın verdiği değer korunur');
    const page = await open(browser);
    const r = await page.evaluate(() => {
        const a = document.createElement('hope-player');
        document.body.appendChild(a);
        const b = document.createElement('hope-player');
        b.setAttribute('tabindex', '-1');
        document.body.appendChild(b);
        return { auto: a.getAttribute('tabindex'), own: b.getAttribute('tabindex'), page: document.getElementById('player').getAttribute('tabindex') };
    });
    ok(r.auto === '0' && r.page === '0', `tabindex verilmeyen player → "0" (${r.auto}, ${r.page})`);
    ok(r.own === '-1', 'sayfanın verdiği tabindex="-1" korunuyor');
    await page.close();
}

(async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
        await testStates(browser);
        await testKeyboard(browser);
        await testHostTabindex(browser);
    } finally {
        await browser.close();
    }
    console.log(failures ? `\n${failures} test başarısız` : '\nTümü geçti');
    process.exit(failures ? 1 : 0);
})();
