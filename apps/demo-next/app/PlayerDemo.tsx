'use client';

import { useRef, useState } from 'react';
import { HopePlayer, type HopePlayerHandle } from '@hopeplayer/react';
import type { HopeThemePreset } from '@hopeplayer/core';

const THEMES: Array<{ value: HopeThemePreset; label: string }> = [
    { value: 'glass-light', label: 'Glass — açık (varsayılan)' },
    { value: 'glass-dark', label: 'Glass — koyu' },
    { value: 'neo-dark', label: 'Neomorphism — koyu' },
    { value: 'mono', label: 'Mono — düz' },
];

const section: React.CSSProperties = { marginTop: 40 };
const label: React.CSSProperties = { fontSize: 14, color: '#a3a3a3', marginBottom: 8, display: 'block' };
const chipButton: React.CSSProperties = {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 8,
    color: '#fff',
    padding: '6px 14px',
    cursor: 'pointer',
    marginRight: 8,
};

export function PlayerDemo() {
    const [theme, setTheme] = useState<HopeThemePreset>('glass-light');
    const [log, setLog] = useState<string[]>([]);
    const handleRef = useRef<HopePlayerHandle>(null);

    const pushLog = (line: string) => setLog((prev) => [...prev.slice(-7), line]);

    return (
        <>
            <section style={section}>
                <span style={label}>Temel oynatma + ref üzerinden imperatif kontrol</span>
                <HopePlayer
                    ref={handleRef}
                    src="/sample.mp4"
                    subtitles={[{ src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true }]}
                    theme={theme}
                    style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', borderRadius: 8 }}
                    onReady={() => pushLog('hp:ready')}
                    onPlay={() => pushLog('hp:play')}
                    onPause={() => pushLog('hp:pause')}
                    onEnded={() => pushLog('hp:ended')}
                    onError={(message) => pushLog(`hp:error — ${message}`)}
                />
                <div style={{ marginTop: 12 }}>
                    <button style={chipButton} onClick={() => void handleRef.current?.play()}>
                        play()
                    </button>
                    <button style={chipButton} onClick={() => handleRef.current?.pause()}>
                        pause()
                    </button>
                </div>
            </section>

            <section style={section}>
                <span style={label}>Tema preset'i (bkz. docs/THEMING.md) — prop değişince anında uygulanır</span>
                <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as HopeThemePreset)}
                    style={{ ...chipButton, padding: '8px 12px' }}
                >
                    {THEMES.map((t) => (
                        <option key={t.value} value={t.value}>
                            {t.label}
                        </option>
                    ))}
                </select>
            </section>

            <section style={section}>
                <span style={label}>Oynatma listesi (playlist prop'u)</span>
                <HopePlayer
                    src="/sample.mp4"
                    theme={theme}
                    style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', borderRadius: 8 }}
                    playlist={{
                        items: [
                            { title: 'Bölüm 1', spot: 'Giriş', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] },
                            { title: 'Bölüm 2', spot: 'Devam', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] },
                        ],
                        autoplayNext: true,
                        ui: { title: 'Bölümler' },
                    }}
                    onItemChange={(index, source) => pushLog(`hp:itemchange — ${source}[${index}]`)}
                />
            </section>

            <section style={section}>
                <span style={label}>Olay günlüğü (hp:* CustomEvent → callback prop)</span>
                <pre
                    style={{
                        background: '#111',
                        border: '1px solid #262626',
                        borderRadius: 8,
                        padding: 12,
                        minHeight: 48,
                        fontSize: 13,
                        color: '#d4d4d4',
                        whiteSpace: 'pre-wrap',
                    }}
                >
                    {log.length ? log.join('\n') : '(henüz olay yok — oynatmayı başlatın)'}
                </pre>
            </section>
        </>
    );
}
