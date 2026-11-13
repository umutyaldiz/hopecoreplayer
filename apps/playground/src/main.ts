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
    // Prebid custParams: GAM isteğine (kazanan olsa da olmasa da, Prebid yoksa fallback tag'e) eklenmeli.
    'prebid-gam-cust': {
        adTagPreroll: 'https://example.com/vast/preroll-fallback?iu=/123456/site-preroll&cust_params=site%3Dhope%26kategori%3Deski',
        prebid: {
            enabled: true,
            gamAdUnit: '/123456/site-preroll',
            timeout: 300,
            bidders: PREBID_BIDDERS,
            custParams: { kategori: 'spor', etiket: ['mac', 'ozet'], sezon: 2026, canli: true, hb_pb: '99.00' },
        },
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
    } else if (feature === 'rewarded') {
        // Ödüllü reklamla kalite kilidi: ?kind=mp4|hls — sağlayıcı test için sahte (window.__rewardedResult).
        const kind = new URLSearchParams(location.search).get('kind') ?? 'mp4';
        const w = window as unknown as { __rewardedResult?: string; __rewardedCalls?: number };
        w.__rewardedCalls = 0;
        player.options = {
            muted: true,
            ...(kind === 'hls'
                ? { src: '/hls/master.m3u8' }
                : {
                      sources: [
                          { src: '/sample.mp4', label: '720p', selected: true },
                          { src: '/sample-240p.mp4', label: '240p' },
                      ],
                  }),
            rewardedUnlock: {
                maxFreeHeight: 240,
                unlockFor: new URLSearchParams(location.search).get('unlock') === '30' ? 30 : 'video',
                provider: {
                    type: 'custom',
                    show: async () => {
                        w.__rewardedCalls = (w.__rewardedCalls ?? 0) + 1;
                        await new Promise((r) => setTimeout(r, 150));
                        return (w.__rewardedResult as 'granted' | 'closed' | 'nofill' | undefined) ?? 'granted';
                    },
                },
            },
        };
    } else if (feature === 'fallback') {
        // Kaynak yedeği: HLS + MP4 kaliteleri, ?priority=hls,mp4 — testler HLS'i ağdan düşürür (route ile).
        const priority = new URLSearchParams(location.search).get('priority');
        player.options = {
            muted: true,
            sources: [
                { src: '/sample.mp4', label: '720p', selected: true },
                { src: '/sample-240p.mp4', label: '240p' },
                { src: '/hls/master.m3u8', label: 'Oto' },
            ],
            sourcePriority: priority ? priority.split(',') : undefined,
        };
    } else if (feature === 'dash' || feature === 'dash-clearkey') {
        // DASH (dash.js) + QoE (olaylar konsolda). ClearKey lisansı data: URL — sabit JSON, sunucu gerekmez.
        const license = { keys: [{ kty: 'oct', k: 'OiobaN0r2bLusl6ExHdmaA', kid: 'EAAAABAAEAAQABAAAAAAAQ' }], type: 'temporary' };
        player.addEventListener('hp:analytics', (e) => console.log('[analytics]', (e as CustomEvent).detail.event.type, (e as CustomEvent).detail));
        player.options = {
            muted: true,
            src: feature === 'dash' ? '/dash/clear.mpd' : '/dash/clearkey.mpd',
            drm: feature === 'dash' ? undefined : { clearkey: { licenseUrl: `data:application/json;base64,${btoa(JSON.stringify(license))}` } },
            analytics: true,
            contextMenu: { stats: true },
        };
    } else if (feature === 'cast') {
        // TV'ye yayın: testler gerçek SDK yerine sahte cast_sender.js verir (route). ?ads=vast|vmap|off
        const ads = new URLSearchParams(location.search).get('ads');
        player.options = {
            src: '/sample-30s.mp4',
            poster: '/sample-cover.jpg',
            muted: true,
            subtitles: [{ src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true }],
            cast: {
                chromecast: true,
                metadata: { title: 'İstanbul', subtitle: 'HopeCore demo' },
                ads:
                    ads === 'off'
                        ? false
                        : ads === 'vmap'
                          ? { vmap: 'https://ads.example.com/vmap?ts=[timestamp]' }
                          : { preroll: 'https://ads.example.com/pre?ts=[timestamp]', midroll: 'https://ads.example.com/mid', midrollIntervalSeconds: 10, postroll: 'https://ads.example.com/post' },
            },
        };
    } else if (feature === 'adtriggers') {
        // Reklam tetikleyici: kurallar /ad-triggers.json'dan (testler route ile değiştirir).
        player.options = {
            src: '/sample-30s.mp4',
            muted: true,
            adTriggers: { endpoint: '/ad-triggers.json', params: { channel: 'demo' }, targeting: { content: 'istanbul' } },
        };
    } else if (feature === 'sponsorship') {
        player.options = { src: '/sample.mp4', muted: true, sponsorship: { endpoint: '/sponsorship.json', params: { channel: 'demo' } } };
    } else if (feature === 'audio') {
        // Ses modu: ?vinyl=center|left|right|off
        const vinyl = new URLSearchParams(location.search).get('vinyl');
        player.options = {
            src: '/sample-audio.mp3',
            audio: {
                cover: '/sample-cover.jpg',
                title: 'Vinyl Sessions',
                artist: 'HopeCore',
                album: 'Side A',
                vinyl: vinyl === 'off' ? false : { position: (vinyl as 'center' | 'left' | 'right' | null) ?? 'right' },
                layout: new URLSearchParams(location.search).get('layout') === 'compact' ? 'compact' : 'full',
            },
        };
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
            // Çoklu kamerada kaynak kameralardan gelir.
            sources: feature?.startsWith('multiview')
                ? undefined
                : feature === 'ad-hls'
                  ? [{ src: '/hls-ad/master.m3u8', label: 'Oto' }]
                  : [
                      { src: '/sample.mp4', label: '720p', selected: true },
                      { src: '/sample.mp4', label: '360p' },
                  ],
            subtitles:
                feature === 'transcript'
                    ? [
                          { src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true },
                          { src: '/sample.en.vtt', label: 'English', srclang: 'en' },
                      ]
                    : [{ src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: false }],
            // ?feature=transcript | transcript-open
            transcript: feature === 'transcript' ? true : feature === 'transcript-open' ? { open: true, track: 'tr' } : undefined,
            // ?feature=multiview | multiview-grid — 4 kamera (kamera 1–3 PROGRAM-DATE-TIME, kamera 4 yalnızca offset).
            multiview:
                feature === 'multiview' || feature === 'multiview-grid' || feature === 'multiview-poster'
                    ? {
                          layout: feature === 'multiview-grid' ? 'grid' : 'focus',
                          previews: feature === 'multiview-poster' ? 'poster' : 'video',
                          sources: [1, 2, 3, 4].map((n) => ({
                              id: `cam${n}`,
                              label: ['Sahne', 'Yakın plan', 'Siyah-beyaz', 'Sol üst'][n - 1]!,
                              src: `/multiview/cam${n}/index.m3u8`,
                              poster: `/multiview/cam${n}/poster.jpg`,
                              offset: [0, 2, 1, 3][n - 1],
                          })),
                      }
                    : undefined,
            // ?feature=share — paylaşım paneli (tüm ağlar).
            share: feature === 'share' ? { networks: ['x', 'whatsapp', 'facebook', 'linkedin', 'telegram', 'reddit', 'email'] } : undefined,
            // ?feature=ad-hls (yayının betimleme izi) | ad-file (ayrı anlatım dosyası).
            audioDescription: feature === 'ad-hls' ? true : feature === 'ad-file' ? { src: '/ad-narration.m4a' } : undefined,
            // ?feature=docpip — Document PiP (testte documentPictureInPicture taklit edilir).
            documentPip: feature === 'docpip' ? true : undefined,
            // ?feature=interactive — 1. sn anket, 3. sn quiz, 6. sn ürün kartı.
            interactive:
                feature === 'interactive'
                    ? {
                          items: [
                              { id: 'pg-poll', type: 'poll', time: 1, duration: 3, question: 'En sevdiğiniz semt?', choices: ['Galata', 'Kadıköy', 'Balat'], results: [5, 3, 2] },
                              { id: 'pg-quiz', type: 'quiz', time: 3, duration: 4, pause: true, question: 'Kapadokya hangi bölgede?', choices: ['Ege', 'İç Anadolu', 'Karadeniz'], answer: 1, explanation: 'Nevşehir çevresi.' },
                              { id: 'pg-product', type: 'product', time: 6, duration: 3, title: 'İnce belli çay bardağı (6\'lı)', subtitle: 'Paşabahçe', price: '₺349', oldPrice: '₺429', image: '/sample-cover.jpg', url: 'https://example.com/urun', sponsored: true },
                          ],
                      }
                    : undefined,
            // ?feature=heatmap — 10 sn videoda 4. ve 8. saniyede tepe.
            heatmap: feature === 'heatmap' ? { data: [2, 3, 5, 9, 20, 12, 6, 8, 15, 4], show: 'always' } : undefined,
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
                          { start: 0, end: 3.3, text: 'Bölüm 1' },
                          { start: 3.3, end: 6.6, text: 'Bölüm 2' },
                          { start: 6.6, end: 9.9, text: 'Bölüm 3' },
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
                        : feature === 'sprite-lowres'
                          ? // Asıl sheet gelene kadar 48×27'lik küçük sheet.
                            { url: '/sprite.jpg', width: 160, height: 90, interval: 1, lowRes: { url: '/sprite-low.jpg', width: 48, height: 27 } }
                          : feature === 'sprite-2x'
                            ? // 320×180 kareler, ekranda 160 px (retina).
                              { url: '/sprite-2x.jpg', width: 320, height: 180, interval: 1, displayWidth: 160 }
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
                    : feature === 'redirect-card'
                      ? {
                            mode: 'card',
                            showBefore: 5,
                            time: 3,
                            title: 'Boğaz turu: martılar ve vapurlar',
                            subtitle: 'HopeCore · İstanbul',
                            duration: '0:30',
                            image: '/sample-cover.jpg',
                            url: 'https://example.com/next-video',
                            suggestions: [
                                { url: 'https://example.com/s1', title: 'Öneri 1', image: '/sample-cover.jpg', duration: '1:20' },
                                { url: 'https://example.com/s2', title: 'Öneri 2 <b>kalın değil</b>', image: '/sample-cover.jpg' },
                            ],
                        }
                      : feature === 'endscreen'
                        ? {
                              mode: 'endScreen',
                              suggestionsTitle: 'Bunları da izleyin',
                              suggestions: [
                                  { url: 'https://example.com/s1', title: 'Öneri 1', subtitle: 'Kanal · 2 gün önce', image: '/sample-cover.jpg', duration: '1:20' },
                                  { url: 'https://example.com/s2', title: 'Öneri 2', image: '/sample-cover.jpg' },
                                  { url: 'https://example.com/s3', title: 'Öneri 3', image: '/sample-cover.jpg' },
                              ],
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
