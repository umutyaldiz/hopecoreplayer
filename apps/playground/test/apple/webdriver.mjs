import { request } from 'node:http';

// W3C WebDriver istemcisi — bağımlılık yok, yalnızca node:http. Gerçek Safari (safaridriver, macOS) ve iOS Simulator'daki
// Safari (Appium XCUITest) aynı protokolü konuşur; Playwright gerçek Safari'yi süremediği için bu testler bununla çalışır.

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export class WebDriverError extends Error {}

export class Session {
    constructor(base, id) {
        this.base = base;
        this.id = id;
    }

    // İlk iOS oturumu WebDriverAgent'ı derleyip simülatöre kuruyor — 10 dakikayı aşabiliyor.
    // Bağlantı koparsa (Appium uzun WDA kurulumunda soketi kapatabiliyor: "socket hang up") yeniden dener — ikinci
    // denemede WebDriverAgent zaten derlenmiş olduğundan oturum çabuk açılır. Appium `--session-override` ile
    // çalıştığından yarım kalan önceki oturum yenisini engellemez.
    static async create(base, capabilities, { timeoutMs = 900_000, attempts = 3 } = {}) {
        for (let i = 1; ; i++) {
            try {
                const res = await call(base, 'POST', '/session', { capabilities: { alwaysMatch: capabilities } }, timeoutMs);
                const session = new Session(base, res.sessionId ?? res.value?.sessionId);
                // Appium (XCUITest) async betik süresini ~0'da başlatıyor ("after 1 ms") — W3C'nin 30 sn'sini açıkça ver.
                await session.cmd('POST', '/timeouts', { script: 30_000 }).catch(() => {});
                return session;
            } catch (e) {
                // Yalnızca bağlantı hataları (ECONNRESET vb.) — sürücünün döndürdüğü hata ya da 15 dk'lık zaman aşımı tekrarlanmaz.
                if (e instanceof WebDriverError || i >= attempts) throw e;
                console.log(`  oturum açılamadı (${e.code ?? ''} ${e.message}) — yeniden deneniyor (${i + 1}/${attempts})`);
                await sleep(10_000);
            }
        }
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

/**
 * node:http ile (fetch değil): Node'un fetch'i (undici) yanıt başlığını en fazla 300 sn bekliyor — Appium ilk iOS
 * oturumunda WebDriverAgent'ı derleyip kurarken bu süreyi aşıyor. Süreyi burada `timeoutMs` belirler.
 */
function call(base, method, path, body, timeoutMs = 120_000) {
    const url = new URL(base.replace(/\/$/, '') + path);
    const payload = body ? JSON.stringify(body) : undefined;
    return new Promise((resolve, reject) => {
        const req = request(
            url,
            // agent: false — her istek yeni soket; Node 24'ün varsayılan keep-alive havuzu sunucunun kapattığı bayat
            // soketi yeniden kullanıp "socket hang up" verebiliyor.
            { method, agent: false, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} },
            (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    let json = {};
                    try {
                        json = data ? JSON.parse(data) : {};
                    } catch {
                        /* gövde JSON değil */
                    }
                    if (res.statusCode >= 400 || json.value?.error)
                        reject(new WebDriverError(`${method} ${path}: ${json.value?.error ?? res.statusCode} — ${json.value?.message ?? data.slice(0, 200)}`.slice(0, 600)));
                    else resolve(json);
                });
            }
        );
        req.setTimeout(timeoutMs, () => req.destroy(new WebDriverError(`${method} ${path}: ${Math.round(timeoutMs / 1000)} sn içinde yanıt yok`)));
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
