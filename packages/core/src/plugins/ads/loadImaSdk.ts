const IMA_SDK_URL = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';

declare global {
    interface Window {
        google?: { ima?: typeof google.ima };
    }
}

let loadPromise: Promise<typeof google.ima> | null = null;

/** Google IMA SDK'yı bir kez <script> ile yükler. */
export function loadImaSdk(): Promise<typeof google.ima> {
    if (window.google?.ima) return Promise.resolve(window.google.ima);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = IMA_SDK_URL;
        script.async = true;
        script.onload = () => {
            if (window.google?.ima) resolve(window.google.ima);
            else reject(new Error('IMA SDK yüklendi ama window.google.ima yok'));
        };
        script.onerror = () => reject(new Error('IMA SDK yüklenemedi (reklam engelleyici olabilir)'));
        document.head.appendChild(script);
    });

    return loadPromise;
}
