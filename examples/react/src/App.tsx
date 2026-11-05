import { useEffect, useRef, useState } from 'react';
import { HopePlayer, type HopePlayerHandle } from '@hopeplayer/react';
import type { HopePlayerOptions } from '@hopeplayer/core';

const POSTER = 'https://www.umutyaldiz.com/hopecoreplayer/countdown-cover.jpg';

// Herkese açık örnek yayınlar. Altyazılar public/ altında: VTT dosyası fetch ile okunduğu için aynı origin'den gelmeli.
const SOURCES: Record<'hls' | 'mp4', HopePlayerOptions> = {
    hls: {
        src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    },
    mp4: {
        src: 'https://www.umutyaldiz.com/hopecoreplayer/sample.mp4',
        subtitles: [
            { src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true },
            { src: '/sample.en.vtt', label: 'English', srclang: 'en' },
        ],
    },
};

/** Bitime 5 sn kala "Sıradaki" kartı (1.0.17) — MP4 örneği 10 sn, kart 5. saniyede çıkar. */
const REDIRECT: HopePlayerOptions['redirectScreen'] = {
    mode: 'card',
    showBefore: 5,
    time: 5,
    url: 'https://www.umutyaldiz.com/hopecoreplayer/plugins/redirect-screen',
    title: 'Yönlendirme kartı nasıl çalışır?',
    subtitle: 'HopeCorePlayer · Docs',
    image: POSTER,
};

export function App() {
    const player = useRef<HopePlayerHandle>(null);
    const [source, setSource] = useState<keyof typeof SOURCES>('hls');
    const [log, setLog] = useState<string[]>([]);
    const add = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 8));

    // hp:cast ve hp:redirect için wrapper'da callback yok — element üzerinden dinlenir.
    useEffect(() => {
        const el = player.current?.getElement();
        if (!el) return;
        const onCast = (e: Event) => {
            const d = (e as CustomEvent<{ via: string; state: string; device?: string }>).detail;
            add(`cast: ${d.via} ${d.state}${d.device ? ` (${d.device})` : ''}`);
        };
        const onRedirect = (e: Event) => {
            const d = (e as CustomEvent<{ state: string; reason?: string }>).detail;
            // Örnek sayfadan çıkmasın: yönlendirme iptal edilip kayda yazılır. Gerçek sitede bu satıra gerek yok.
            if (d.state === 'redirect') e.preventDefault();
            add(`redirect: ${d.state}${d.reason ? ` (${d.reason})` : ''}`);
        };
        el.addEventListener('hp:cast', onCast);
        el.addEventListener('hp:redirect', onRedirect);
        return () => {
            el.removeEventListener('hp:cast', onCast);
            el.removeEventListener('hp:redirect', onRedirect);
        };
    }, []);

    return (
        <main>
            <h1>HopeCorePlayer — React</h1>
            <p>@hopeplayer/react ile prop ve callback kullanımı.</p>
            <p className="hint">MP4 örneğinde bitime 5 sn kala köşede "Sıradaki" kartı çıkar (örnek sayfadan çıkmasın diye yönlendirme olay kaydına yazılır). Chromecast / AirPlay butonu yakında cihaz varken görünür.</p>

            <HopePlayer
                ref={player}
                {...SOURCES[source]}
                poster={POSTER}
                muted
                theme="glass-dark"
                locale="tr"
                skipButtons={{ back: 10, forward: 10 }}
                tapGestures
                contextMenu={{ stats: true }}
                redirectScreen={REDIRECT}
                cast={{ chromecast: true, airplay: true }}
                onReady={() => add('ready')}
                onPlay={() => add('play')}
                onPause={() => add('pause')}
                onEnded={() => add('ended')}
                onError={(message) => add(`error: ${message}`)}
                onQualityChange={(label) => add(`quality: ${label}`)}
            />

            <div className="row">
                <button type="button" onClick={() => player.current?.play()}>
                    Oynat
                </button>
                <button type="button" onClick={() => player.current?.pause()}>
                    Duraklat
                </button>
                <button type="button" onClick={() => player.current?.getElement()?.toggleStats()}>
                    İstatistik
                </button>
            </div>
            <div className="row">
                <button type="button" className={source === 'hls' ? 'active' : ''} onClick={() => setSource('hls')}>
                    HLS
                </button>
                <button type="button" className={source === 'mp4' ? 'active' : ''} onClick={() => setSource('mp4')}>
                    MP4 + altyazı
                </button>
            </div>

            <div className="log">
                {log.map((line, i) => (
                    <div key={i}>{line}</div>
                ))}
            </div>
        </main>
    );
}
