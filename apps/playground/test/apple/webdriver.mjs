// W3C WebDriver istemcisi — bağımlılık yok, yalnızca fetch. Gerçek Safari (safaridriver, macOS) ve iOS Simulator'daki
// Safari (Appium XCUITest) aynı protokolü konuşur; Playwright gerçek Safari'yi süremediği için bu testler bununla çalışır.

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export class WebDriverError extends Error {}

export class Session {
    constructor(base, id) {
        this.base = base;
        this.id = id;
    }

    static async create(base, capabilities, { timeoutMs = 600_000 } = {}) {
        const res = await call(base, 'POST', '/session', { capabilities: { alwaysMatch: capabilities } }, timeoutMs);
        return new Session(base, res.sessionId ?? res.value?.sessionId);
    }

    cmd(method, path, body) {
        return call(this.base, method, `/session/${this.id}${path}`, body).then((r) => r.value);
    }

    goto(url) {
        return this.cmd('POST', '/url', { url });
    }

    /** Sayfada senkron JS çalıştırır (`fn` bir fonksiyon; argümanlar JSON'a çevrilebilir olmalı). */
    run(fn, ...args) {
        return this.cmd('POST', '/execute/sync', { script: `return (${fn}).apply(null, arguments);`, args });
    }

    /** Sayfada async JS çalıştırır — `fn` Promise döndürebilir. */
    runAsync(fn, ...args) {
        return this.cmd('POST', '/execute/async', {
            script: `const done = arguments[arguments.length - 1]; Promise.resolve((${fn}).apply(null, Array.prototype.slice.call(arguments, 0, -1))).then((v) => done({ ok: true, v }), (e) => done({ ok: false, e: String(e && e.message || e) }));`,
            args,
        }).then((r) => {
            if (!r?.ok) throw new WebDriverError(`sayfa içi hata: ${r?.e}`);
            return r.v;
        });
    }

    /** `fn` true dönene kadar bekler (true / false döner — fırlatmaz). */
    async waitFor(fn, { timeoutMs = 8000, intervalMs = 150, args = [] } = {}) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            if (await this.run(fn, ...args).catch(() => false)) return true;
            await sleep(intervalMs);
        }
        return false;
    }

    /** Shadow DOM içindeki bir öğeyi (seçici, player'ın shadowRoot'unda) WebDriver öğesi olarak döndürür. */
    async shadowElement(selector) {
        const el = await this.run((sel) => document.getElementById('player').shadowRoot.querySelector(sel), selector);
        if (!el?.[ELEMENT]) throw new WebDriverError(`öğe yok: ${selector}`);
        return el[ELEMENT];
    }

    /**
     * Gerçek dokunuş / tık (kullanıcı hareketi sayılır — tam ekran gibi API'ler bunu ister). Önce WebDriver öğe tıklaması,
     * olmazsa öğenin ortasına işaretçi eylemi.
     */
    async tap(selector) {
        const id = await this.shadowElement(selector);
        try {
            await this.cmd('POST', `/element/${id}/click`, {});
        } catch {
            await this.cmd('POST', '/actions', {
                actions: [
                    {
                        type: 'pointer',
                        id: 'finger',
                        parameters: { pointerType: 'touch' },
                        actions: [
                            { type: 'pointerMove', duration: 0, origin: { [ELEMENT]: id }, x: 0, y: 0 },
                            { type: 'pointerDown', button: 0 },
                            { type: 'pause', duration: 60 },
                            { type: 'pointerUp', button: 0 },
                        ],
                    },
                ],
            });
            await this.cmd('DELETE', '/actions').catch(() => {});
        }
    }

    screenshot() {
        return this.cmd('GET', '/screenshot');
    }

    close() {
        return call(this.base, 'DELETE', `/session/${this.id}`).catch(() => {});
    }
}

async function call(base, method, path, body, timeoutMs = 120_000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(base.replace(/\/$/, '') + path, {
            method,
            headers: body ? { 'content-type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: ctrl.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.value?.error) throw new WebDriverError(`${method} ${path}: ${json.value?.error ?? res.status} — ${json.value?.message ?? ''}`.slice(0, 600));
        return json;
    } finally {
        clearTimeout(timer);
    }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
