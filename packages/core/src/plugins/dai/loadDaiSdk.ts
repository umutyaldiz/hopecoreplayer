const DAI_SDK_URL = 'https://imasdk.googleapis.com/js/sdkloader/ima3_dai.js';

// Window.google loadImaSdk.ts'de zaten augment edildi — burada tekrar tanımlanmıyor.
function getLoadedDai(): typeof google.ima.dai | undefined {
    return (window as unknown as { google?: { ima?: { dai?: typeof google.ima.dai } } }).google?.ima?.dai;
}

let loadPromise: Promise<typeof google.ima.dai> | null = null;

/** DAI SDK, normal IMA SDK'dan (loadImaSdk.ts) AYRI bir script — ima3_dai.js. */
export function loadDaiSdk(): Promise<typeof google.ima.dai> {
    const existing = getLoadedDai();
    if (existing) return Promise.resolve(existing);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = DAI_SDK_URL;
        script.async = true;
        script.onload = () => {
            const dai = getLoadedDai();
            if (dai) resolve(dai);
            else reject(new Error('DAI SDK yüklendi ama window.google.ima.dai yok'));
        };
        script.onerror = () => reject(new Error('DAI SDK yüklenemedi (reklam engelleyici olabilir)'));
        document.head.appendChild(script);
    });
    return loadPromise;
}
