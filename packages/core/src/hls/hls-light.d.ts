// hls.js `./light` girişi için tip bildirmiyor (yalnızca ana giriş için hls.d.mts var). Hafif paket aynı API'yi
// dışa verir — yalnızca bazı denetleyiciler (altyazı, alternatif ses, EME, CMCD, interstitials) derlemede yok.
declare module 'hls.js/light' {
    export * from 'hls.js';
    export { default } from 'hls.js';
}
