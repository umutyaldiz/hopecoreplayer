/**
 * IMA SDK'nın ve reklam isteklerinin gittiği sunuculara bağlantıyı önceden açar (DNS + TCP + TLS). Reklam plugin'i
 * dinamik yüklenip ima3.js'i isteyene kadar geçen sürede bağlantılar hazır olur — preroll beklemesi kısalır.
 * Sayfa başına bir kez; çekirdekte (plugin chunk'ı beklenmeden) çağrılır.
 */
const AD_HOSTS = [
    'https://imasdk.googleapis.com',
    'https://pubads.g.doubleclick.net',
    'https://securepubads.g.doubleclick.net',
    'https://pagead2.googlesyndication.com',
];

let done = false;

export function preconnectAdHosts(): void {
    if (done || typeof document === 'undefined') return;
    done = true;
    for (const href of AD_HOSTS) {
        if (document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = href;
        document.head.appendChild(link);
    }
}
