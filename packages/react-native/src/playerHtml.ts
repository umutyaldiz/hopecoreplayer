import type { HopePlayerOptions } from '@hopeplayer/core';

/** Paket sürümü — build sırasında package.json'dan gömülür; varsayılan core adresi aynı sürüme sabitlenir. */
export const HOPE_PLAYER_RN_VERSION: string = __HOPE_VERSION__;

/** Varsayılan core adresi: jsDelivr üzerinden bu paketle aynı sürümdeki @hopeplayer/core. */
export const DEFAULT_CORE_URL = `https://cdn.jsdelivr.net/npm/@hopeplayer/core@${HOPE_PLAYER_RN_VERSION}/dist/hope-player.js`;

/** WebView → React Native mesajı. `type`: köprü olayı (ready/timeupdate/error) ya da `hp:` öneki atılmış player olayı. */
export interface HopeBridgeMessage {
    __hope: 1;
    type: string;
    data: unknown;
}

/** React Native → WebView komutu (`window.__hopeCommand`). */
export type HopeBridgeCommand =
    | { type: 'options'; options: HopePlayerOptions }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'seek'; time: number }
    | { type: 'muted'; value: boolean }
    | { type: 'toggleStats'; force?: boolean };

export interface PlayerHtmlConfig {
    /** Başlangıç seçenekleri — JSON'a çevrilebilir olmalı (fonksiyonlar WebView'a taşınamaz). */
    options: HopePlayerOptions;
    /** @hopeplayer/core ESM giriş dosyası. Varsayılan: jsDelivr, aynı sürüm. */
    coreUrl?: string;
    /** Sayfa arka planı (player yüklenene kadar görünen). Varsayılan #000. */
    backgroundColor?: string;
    /** `timeupdate` köprü olayının en sık gönderilme aralığı (ms). Varsayılan 250. */
    timeUpdateIntervalMs?: number;
}

/** Player'ın yaydığı ve React Native'e aktarılan olaylar (`hp:` öneki atılarak). */
const FORWARDED_EVENTS = [
    'hp:play',
    'hp:pause',
    'hp:ended',
    'hp:error',
    'hp:qualitychange',
    'hp:ratechange',
    'hp:adstart',
    'hp:adend',
    'hp:aderror',
    'hp:itemchange',
    'hp:pausead',
];

/** Satır/paragraf ayırıcı — JSON'da geçerli, JS string'inde (eski motorlarda) değil. */
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/** JSON'u <script> içine güvenle gömer (`</script>` ve satır ayırıcıları kaçırılır). */
function inlineJson(value: unknown): string {
    return JSON.stringify(value).split('<').join('\\u003c').split(LINE_SEP).join('\\u2028').split(PARA_SEP).join('\\u2029');
}

/**
 * WebView'da çalışan sayfa: <hope-player> + köprü. React Native `window.__hopeCommand(...)` ile komut verir
 * (injectJavaScript), sayfa olayları `window.ReactNativeWebView.postMessage` ile geri gönderir.
 */
export function buildPlayerHtml(config: PlayerHtmlConfig): string {
    const coreUrl = config.coreUrl ?? DEFAULT_CORE_URL;
    const background = config.backgroundColor ?? '#000';
    const interval = config.timeUpdateIntervalMs ?? 250;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: ${background}; }
hope-player { display: block; width: 100%; }
</style>
</head>
<body>
<hope-player id="hope-player"></hope-player>
<script type="module">
const post = (type, data) => {
    const message = JSON.stringify({ __hope: 1, type, data: data === undefined ? null : data });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message);
    else if (window.parent !== window) window.parent.postMessage(message, '*');
};
// Player hazır olana kadar gelen komutlar sıraya alınır.
const queue = [];
let run = null;
window.__hopeCommand = (cmd) => (run ? run(cmd) : queue.push(cmd));

try {
    await import(${inlineJson(coreUrl)});
} catch (err) {
    post('error', { message: 'HopePlayer core could not be loaded: ' + (err && err.message ? err.message : String(err)), code: 'core-load' });
    throw err;
}
await customElements.whenDefined('hope-player');
const el = document.getElementById('hope-player');
el.options = ${inlineJson(config.options)};
const video = el.shadowRoot.querySelector('video');

for (const name of ${inlineJson(FORWARDED_EVENTS)}) {
    el.addEventListener(name, (e) => post(name.slice(3), e.detail === undefined ? null : e.detail));
}
let lastTimeUpdate = 0;
const sendTime = (force) => {
    const now = Date.now();
    if (!force && now - lastTimeUpdate < ${interval}) return;
    lastTimeUpdate = now;
    post('timeupdate', { currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null, paused: video.paused });
};
video.addEventListener('timeupdate', () => sendTime(false));
video.addEventListener('seeked', () => sendTime(true));
video.addEventListener('loadedmetadata', () => post('loadedmetadata', { duration: Number.isFinite(video.duration) ? video.duration : null, width: video.videoWidth, height: video.videoHeight }));

run = (cmd) => {
    switch (cmd && cmd.type) {
        case 'options': el.options = cmd.options; break;
        case 'play': video.play().catch((err) => post('error', { message: String(err && err.message ? err.message : err), code: 'play' })); break;
        case 'pause': video.pause(); break;
        case 'seek': video.currentTime = cmd.time; break;
        case 'muted': video.muted = !!cmd.value; break;
        case 'toggleStats': el.toggleStats(cmd.force); break;
    }
};
queue.splice(0).forEach(run);
post('ready', { version: el.constructor.version || null });
</script>
</body>
</html>`;
}

/** `window.__hopeCommand(...)` çağrısı — WebView `injectJavaScript`'e verilir (sondaki `true` iOS uyarısını önler). */
export function commandScript(cmd: HopeBridgeCommand): string {
    return `window.__hopeCommand && window.__hopeCommand(${inlineJson(cmd)}); true;`;
}
