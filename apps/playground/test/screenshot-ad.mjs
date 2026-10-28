import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
const mockSrc = readFileSync(new URL('./_mock-ima.js', import.meta.url), 'utf8');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
    await page.addInitScript(mockSrc);
    await page.goto(`${BASE}/?ads=vmap`);
    await page.waitForSelector('hope-player');
    await page.waitForFunction(() => {
        const el = document.getElementById('player');
        return !!(el && el.shadowRoot && el.shadowRoot.querySelector('video'));
    });
    await page.evaluate(() => {
        const loader = window.__mockIma.adsLoaderInstances[0];
        const mgr = new window.google.ima.AdsManager();
        window.__mockIma.adsManagerInstances.push(mgr);
        loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
        mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: process.env.HOPE_SCREENSHOT_OUT ?? 'ad-state.png' });
    await browser.close();
})();
