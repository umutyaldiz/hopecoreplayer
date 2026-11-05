// Testlerin tarayıcısı: HOPE_BROWSER=chromium (varsayılan) | firefox | webkit.
// `autoplay: true`: sesli otomatik oynatma kullanıcı hareketi olmadan serbest (Chromium bayrağı / Firefox tercihleri);
// WebKit'te karşılığı yok — o testler sessiz (muted) oynatmaya dayanır.
import { chromium, firefox, webkit } from 'playwright';

export const BROWSER = process.env.HOPE_BROWSER ?? 'chromium';

export function launchBrowser({ autoplay = false } = {}) {
    if (BROWSER === 'firefox') {
        return firefox.launch({
            firefoxUserPrefs: autoplay ? { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0, 'media.autoplay.block-webaudio': false } : {},
        });
    }
    if (BROWSER === 'webkit') return webkit.launch();
    return chromium.launch(autoplay ? { args: ['--autoplay-policy=no-user-gesture-required'] } : {});
}

/** Yalnızca bu motorlarda anlamlı bir test (ör. Chromium'a özgü API) — diğerlerinde atlanır ve nedeni yazılır. */
export function only(engines, name) {
    if (engines.includes(BROWSER)) return true;
    console.log(`  SKIP ${name} — ${BROWSER} için geçerli değil`);
    return false;
}
