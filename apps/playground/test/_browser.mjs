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
    // WebKit'te sessize alma bayrağı yok — her sayfaya MUTE betiği eklenir.
    if (BROWSER === 'webkit') return webkit.launch().then((b) => (SILENT ? silence(b) : b));
    const args = [...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : []), ...(SILENT ? ['--mute-audio'] : [])];
    return chromium.launch({ args });
}

/** Gerçek öğe hep sessiz; sayfa `muted` değerini kendi ayarladığı gibi görür. */
function MUTE() {
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
    const seen = new WeakMap();
    const own = (el) => (seen.has(el) ? seen.get(el) : d.get.call(el));
    const hush = (el) => {
        if (!seen.has(el)) seen.set(el, d.get.call(el));
        d.set.call(el, true);
    };
    Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
        configurable: true,
        get() {
            return own(this);
        },
        set(v) {
            const was = own(this);
            seen.set(this, !!v);
            d.set.call(this, true);
            if (was !== !!v) this.dispatchEvent(new Event('volumechange'));
        },
    });
    const P = HTMLMediaElement.prototype;
    for (const m of ['play', 'load']) {
        const f = P[m];
        P[m] = function (...a) {
            hush(this);
            return f.apply(this, a);
        };
    }
    // Kaynak verilince de (autoplay, shadow DOM içindeki video) sessize al.
    for (const k of ['src', 'srcObject']) {
        const s = Object.getOwnPropertyDescriptor(P, k);
        Object.defineProperty(P, k, {
            configurable: true,
            get() {
                return s.get.call(this);
            },
            set(v) {
                hush(this);
                s.set.call(this, v);
            },
        });
    }
}

function silence(browser) {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
        const ctx = await newContext(...args);
        await ctx.addInitScript(MUTE);
        return ctx;
    };
    browser.newPage = async (...args) => {
        const ctx = await browser.newContext(...args);
        const page = await ctx.newPage();
        page.on('close', () => void ctx.close().catch(() => {}));
        return page;
    };
    return browser;
}

/** Yalnızca bu motorlarda anlamlı bir test (ör. Chromium'a özgü API) — diğerlerinde atlanır ve nedeni yazılır. */
export function only(engines, name) {
    if (engines.includes(BROWSER)) return true;
    console.log(`  SKIP ${name} — ${BROWSER} için geçerli değil`);
    return false;
}
