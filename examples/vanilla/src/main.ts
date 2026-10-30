import '@hopeplayer/core';
import type { HopePlayerEventMap, HopePlayerOptions } from '@hopeplayer/core';
import './style.css';

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

// Dinleyiciler sayfaya eklemeden önce bağlanır: hp:ready, element DOM'a girdiği anda tetiklenir.
const player = document.createElement('hope-player');
const logEl = document.querySelector<HTMLDivElement>('#log')!;

function log(line: string): void {
    const row = document.createElement('div');
    row.textContent = `${new Date().toLocaleTimeString()}  ${line}`;
    logEl.prepend(row);
    while (logEl.childElementCount > 8) logEl.lastElementChild!.remove();
}

function load(source: keyof typeof SOURCES): void {
    player.options = {
        ...SOURCES[source],
        poster: POSTER,
        muted: true,
        theme: 'glass-dark',
        locale: 'tr',
        skipButtons: { back: 10, forward: 10 },
        tapGestures: true,
        contextMenu: { stats: true },
    };
    document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.source === source);
    });
}

function on<K extends keyof HopePlayerEventMap>(type: K, listener: (event: HopePlayerEventMap[K]) => void): void {
    player.addEventListener(type, listener as EventListener);
}

on('hp:ready', () => log('ready'));
on('hp:play', () => log('play'));
on('hp:pause', () => log('pause'));
on('hp:ended', () => log('ended'));
on('hp:error', (e) => log(`error: ${e.detail.message}`));
on('hp:qualitychange', (e) => log(`quality: ${e.detail.label}`));

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
        if (btn.dataset.action === 'play') void player.play();
        if (btn.dataset.action === 'pause') player.pause();
        if (btn.dataset.action === 'stats') void player.toggleStats();
    });
});
document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((btn) => {
    btn.addEventListener('click', () => load(btn.dataset.source as keyof typeof SOURCES));
});

load('hls');
document.querySelector('#player-slot')!.replaceWith(player);
