// Testlerin tarayıcısı: HOPE_BROWSER=chromium (varsayılan) | firefox | webkit.
// `autoplay: true`: sesli otomatik oynatma kullanıcı hareketi olmadan serbest (Chromium bayrağı / Firefox tercihleri);
// WebKit'te karşılığı yok — o testler sessiz (muted) oynatmaya dayanır.
import { chromium, firefox, webkit } from 'playwright';

export const BROWSER = process.env.HOPE_BROWSER ?? 'chromium';
/** Testler hoparlöre ses vermez (video `muted` / `volume` durumu değişmez); duymak için HOPE_AUDIO=1. */
const SILENT = process.env.HOPE_AUDIO !== '1';

export function launchBrowser({ autoplay = false } = {}) {
    if (BROWSER === 'firefox') {
        return firefox.launch({
            firefoxUserPrefs: {
                ...(autoplay ? { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0, 'media.autoplay.block-webaudio': false } : {}),
                ...(SILENT ? { 'media.volume_scale': '0.0' } : {}),
            },
        });
    }
    // WebKit'te sessize alma bayrağı yok.
    if (BROWSER === 'webkit') return webkit.launch();
    const args = [...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : []), ...(SILENT ? ['--mute-audio'] : [])];
    return chromium.launch({ args });
}

/** Yalnızca bu motorlarda anlamlı bir test (ör. Chromium'a özgü API) — diğerlerinde atlanır ve nedeni yazılır. */
export function only(engines, name) {
    if (engines.includes(BROWSER)) return true;
    console.log(`  SKIP ${name} — ${BROWSER} için geçerli değil`);
    return false;
}
