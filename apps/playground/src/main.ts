import '@hopeplayer/core';
import type { HopePlayerElement } from '@hopeplayer/core';

const player = document.getElementById('player') as HopePlayerElement | null;
const log = document.getElementById('log');

const append = (msg: string) => {
    console.log('[playground]', msg);
    if (log) log.textContent = `${log.textContent ?? ''} ${msg}`.trim();
};

player?.addEventListener('hp:ready', () => append('ready'));
player?.addEventListener('hp:play', () => append('play'));
player?.addEventListener('hp:pause', () => append('pause'));
player?.addEventListener('hp:ended', () => append('ended'));
player?.addEventListener('hp:qualitychange', ((e: CustomEvent<{ label: string }>) =>
    append(`qualitychange:${e.detail.label}`)) as EventListener);
player?.addEventListener('hp:adstart', ((e: CustomEvent<{ type: string }>) =>
    append(`adstart:${e.detail.type}`)) as EventListener);
player?.addEventListener('hp:adend', ((e: CustomEvent<{ type: string }>) =>
    append(`adend:${e.detail.type}`)) as EventListener);
player?.addEventListener('hp:aderror', ((e: CustomEvent<{ message: string }>) =>
    append(`aderror:${e.detail.message}`)) as EventListener);
player?.addEventListener('hp:itemchange', ((e: CustomEvent<{ index: number; source: string }>) =>
    append(`itemchange:${e.detail.source}:${e.detail.index}`)) as EventListener);
player?.addEventListener('hp:sticky', ((e: CustomEvent<{ sticky: boolean }>) =>
    append(`sticky:${e.detail.sticky}`)) as EventListener);

// Faz 7 tema seçici: ?theme=glass-light|glass-dark|neo-dark|mono
// (attribute olarak uygulanıyor — HopePlayerElement zaten 'theme'i observedAttributes'te
// izliyor, options objesine ayrıca eklemeye gerek yok).
const themeParam = new URLSearchParams(location.search).get('theme');
if (player && themeParam) player.setAttribute('theme', themeParam);

const themeSelect = document.getElementById('theme-select') as HTMLSelectElement | null;
if (themeSelect) {
    themeSelect.value = themeParam ?? '';
    themeSelect.addEventListener('change', () => {
        if (!player) return;
        if (themeSelect.value) player.setAttribute('theme', themeSelect.value);
        else player.removeAttribute('theme');
    });
}

// Faz 2/3 test senaryoları: ?ads=preroll | vmap | postroll | midroll | retry |
// prebid | prebid-gam | prebid-retry | consentaware
// (Playwright testleri window.google.ima/window.pbjs'i gerçek
// SDK'lar yerine mock'layıp bu senaryoları sürüyor — bkz. apps/playground/test/*.mjs)
const adsScenario = new URLSearchParams(location.search).get('ads');

const PREBID_BIDDERS = [{ bidder: 'ix', params: { siteId: '123456', size: [640, 360] } }];

const adsOptionsByScenario: Record<string, import('@hopeplayer/core').AdsOptions> = {
    preroll: { adTagPreroll: 'https://example.com/vast/preroll' },
    // Preroll kapısı testi: kısa zaman aşımı (varsayılan 8 sn yerine).
    'preroll-timeout': { adTagPreroll: 'https://example.com/vast/preroll', prerollTimeoutMs: 800 },
    // requestWhen testleri.
    'preroll-load': { adTagPreroll: 'https://example.com/vast/preroll', requestWhen: 'load' },
    'preroll-play': { adTagPreroll: 'https://example.com/vast/preroll', requestWhen: 'play' },
    vmap: { adTagPreroll: 'https://example.com/vast/preroll', adTagVmap: 'https://example.com/vmap/full' },
    vmaponly: { adTagVmap: 'https://example.com/vmap/full' },
    postroll: { adTagPostroll: 'https://example.com/vast/postroll' },
    midroll: { adTagMidroll: 'https://example.com/vast/midroll', midrollIntervalSeconds: 5 },
    retry: {
        adTagPreroll: ['https://example.com/vast/tag-a', 'https://example.com/vast/tag-b'],
        retry: { enabled: true, maxRetry: 4, retryDelay: 50, jitter: 0.5, maxAttemptsPerTag: 2, retryScope: 'preroll' },
    },
    prebid: {
        adTagPreroll: 'https://example.com/vast/preroll-fallback',
        prebid: { enabled: true, adUnitCode: 'hope-video-preroll', timeout: 300, bidders: PREBID_BIDDERS },
    },
    'prebid-gam': {
        adTagPreroll: 'https://example.com/vast/preroll-fallback',
        prebid: { enabled: true, gamAdUnit: '/123456/site-preroll', timeout: 300, bidders: PREBID_BIDDERS },
    },
    'prebid-retry': {
        adTagPreroll: 'https://example.com/vast/preroll-fallback',
        prebid: { enabled: true, timeout: 300, bidders: PREBID_BIDDERS },
        retry: { enabled: true, maxRetry: 2, retryDelay: 30, retryScope: 'preroll' },
    },
    consentaware: { adTagPreroll: 'https://example.com/vast/preroll', consentAware: true },
    // `preroll-autoplay`: GERÇEK BUG'ın (bkz. AdsController.install — "gerçek
    // IMA SDK'ya karşı: AdError 400, autoplay + hiçbir tıklama olmadan")
    // repro senaryosu — StickyManager'daki AYNI bug sınıfı: `autoplay: true`
    // ile video, AdsController'ın (dinamik import edilen) 'play'
    // dinleyicisini bağlamasından ÖNCE oynamaya başlıyor.
    'preroll-autoplay': { adTagPreroll: 'https://example.com/vast/preroll' },
    // `requestOnPlay`: istek üzerine ("test et tuşuna basınca direkt player
    // autoplay olmasın") eklendi — `options.ads` set edilir edilmez DEĞİL,
    // kullanıcı kendi play butonuna basana kadar istek ERTELENİYOR.
    'preroll-deferred': { adTagPreroll: 'https://example.com/vast/preroll', requestOnPlay: true },
};

// Faz 4 test senaryoları: ?feature=gesture | loop | inview | sticky | playlist | story
const feature = new URLSearchParams(location.search).get('feature');

const PLAYLIST_ITEMS: import('@hopeplayer/core').PlayableItem[] = [
    { title: 'Video 1', spot: 'Birinci içerik', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] },
    { title: 'Video 2', spot: 'İkinci içerik', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] },
    { title: 'Video 3', spot: 'Üçüncü içerik', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] },
];

// Faz 5 test senaryoları: ?feature=markers | segments | sprite | countdown | geo | redirect | dubbing
if (player) {
    if (feature === 'playlist') {
        player.options = { muted: true, playlist: { items: PLAYLIST_ITEMS, startMode: 'immediate', loop: true } };
    } else if (feature === 'story') {
        player.options = {
            muted: true,
            autoplay: true,
            story: { items: PLAYLIST_ITEMS.map((i) => ({ ...i, image: undefined })), loop: true },
        };
    } else {
        // Faz 1 API testi: birden fazla "kalite" (aynı dosya, farklı etiket —
        // gerçek bitrate farkı yok ama geçiş mekanizmasını test eder) + altyazı.
        player.options = {
            sources: [
                { src: '/sample.mp4', label: '720p', selected: true },
                { src: '/sample.mp4', label: '360p' },
            ],
            subtitles: [{ src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: false }],
            muted: true,
            // İstek üzerine: "mouse out sonrası toolbar'ın kaybolma süresini
            // kısaltır mısın, bu da options'tan ayarlanabilmeli" — varsayılan
            // 1200ms'yi test için 150ms'ye düşürüp gerçek davranışı doğruluyoruz.
            autoHideDelayMs: feature === 'autohide-fast' ? 400 : undefined,
            // `sticky-autoplay`: GERÇEK BUG'ın (bkz. StickyManager.register — "sticky
            // bir türlü aktifleşmiyor") repro senaryosu — `autoplay: true` ile video
            // StickyManager'ın plugin'i dinamik import edip 'play' dinleyicisini
            // bağlamasından ÖNCE oynamaya başlıyor, bu yüzden normal `sticky`
            // senaryosunun aksine (orada video.play() testin KENDİSİ tetikliyor,
            // dinleyici zaten bağlıyken) native 'play' event'i KAÇIRILIYOR.
            autoplay: feature === 'sticky-autoplay' || adsScenario === 'preroll-autoplay' ? true : undefined,
            ads:
                feature === 'scte35'
                    ? { live: { scte35: true, adTagLive: 'https://example.com/vast/live', breakTimeoutMs: 2000 } }
                    : adsScenario
                      ? adsOptionsByScenario[adsScenario]
                      : undefined,
            gesture: feature === 'gesture' ? { holdDelayMs: 50, holdIntervalMs: 50 } : undefined,
            loopSection: feature === 'loop' ? { seconds: 5 } : undefined,
            inViewAutoplay: feature === 'inview' ? { threshold: 0.3, onlyIfMuted: true } : undefined,
            sticky: feature === 'sticky' || feature === 'sticky-autoplay' ? { minPlayMs: 0, dismissMode: 'none' } : undefined,
            markers:
                feature === 'markers'
                    ? {
                          items: [
                              { time: 2, label: 'Marker A', once: true, pauseOnHit: true, popup: { enabled: true, mode: 'text', text: 'Marker A popup' } },
                              { time: 6, label: 'Marker B', once: false, cooldownMs: 300, pauseOnHit: false, action: { type: 'log', name: 'marker_b_hit' } },
                          ],
                      }
                    : undefined,
            segments:
                feature === 'segments'
                    ? [
                          { start: 0, end: 5, text: 'Bölüm 1' },
                          { start: 5, end: 10, text: 'Bölüm 2' },
                          { start: 10, end: 15, text: 'Bölüm 3' },
                      ]
                    : undefined,
            spriteThumbnails:
                feature === 'sprite'
                    ? { url: '/sprite.jpg', width: 160, height: 90, interval: 1 }
                    : feature === 'sprite-multi'
                      ? // sheetDuration bilerek YOK — ilk sheet'in 2×2 ızgarasından (4 kare × 1 sn) hesaplanmalı.
                        { url: '/sprite-%d.jpg', width: 160, height: 90, interval: 1 }
                      : feature === 'sprite-vtt'
                        ? { vtt: '/thumbs.vtt' }
                        : undefined,
            countdownScreen: feature === 'countdown' ? { time: new Date(Date.now() + 6000).toISOString(), title: 'Yayın başlıyor', spot: 'Birazdan canlı yayın' } : undefined,
            geoChecker: feature === 'geo-allow' ? { allowedCountries: ['TR'] } : feature === 'geo-deny' ? { allowedCountries: ['US'] } : undefined,
            redirectScreen:
                feature === 'redirect'
                    ? {
                          enabled: true,
                          time: 3,
                          title: 'Sıradaki video',
                          url: 'https://example.com/next-video',
                          suggestions: [{ url: 'https://example.com/s1', title: 'Öneri 1', image: '/sample.vtt' }],
                      }
                    : undefined,
            dubbing:
                feature === 'dubbing'
                    ? {
                          tracks: [
                              { src: '/sample.mp4', label: 'Türkçe', srclang: 'tr', default: true },
                              { src: '/sample.mp4', label: 'English', srclang: 'en' },
                          ],
                      }
                    : undefined,
            liveWallClock: feature === 'live-clock' ? { tooltipMode: 'both' } : undefined,
            dai: feature === 'dai' ? { assetKey: 'test-asset-key' } : undefined,
            // `minElapsed`/`minRemaining` gerçek kullanımda 60sn'dir (bkz.
            // types.ts) — testin 60sn beklememesi için 1sn'ye düşürülüyor.
            qrResume:
                feature === 'qr-resume'
                    ? { minElapsed: 1, minRemaining: 1, paramName: 'vtime', size: 180 }
                    : feature === 'qr-resume-logo'
                      ? { minElapsed: 1, minRemaining: 1, paramName: 'vtime', size: 180, logo: '/sample-logo.svg' }
                      : undefined,
        };
    }
}
