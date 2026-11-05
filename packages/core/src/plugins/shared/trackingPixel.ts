/** Önbellek kırıcı makroları (IAB VAST: [CACHEBUSTING], yaygın: [timestamp], %%CACHEBUSTER%%…). */
const CACHE_MACROS = /\[(?:CACHEBUSTING|CACHEBUSTER|cachebuster|timestamp|TIMESTAMP)\]|%%CACHEBUSTER%%/g;

/**
 * Takip pikseli: yanıtı beklenmeyen GET (img beacon). Her çağrı gerçek bir istek olsun diye adrese önbellek kırıcı
 * eklenir — aynı adres ikinci kez istenince tarayıcılar (Firefox her zaman, Chrome kimi zaman) görseli bellekten
 * verip sunucuya hiç gitmiyordu; tekrar eden gösterimler (sponsor girişi, reklam tetikleyici) eksik sayılıyordu.
 * Adreste makro varsa o doldurulur, yoksa `hp_cb` parametresi eklenir.
 */
export function firePixels(urls: string[] | undefined): void {
    for (const u of urls ?? []) {
        const cb = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        let url = u;
        if (u.match(CACHE_MACROS)) url = u.replace(CACHE_MACROS, cb);
        else {
            try {
                const parsed = new URL(u, document.baseURI);
                parsed.searchParams.set('hp_cb', cb);
                url = parsed.href;
            } catch {
                /* geçersiz adres — olduğu gibi */
            }
        }
        const img = new Image();
        img.referrerPolicy = 'no-referrer-when-downgrade';
        img.src = url;
    }
}
