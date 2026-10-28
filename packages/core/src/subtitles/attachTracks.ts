import type { HopeSubtitleOption } from '../types';

export interface AttachedTrack {
    label: string;
    track: TextTrack;
}

interface ParsedCue {
    start: number;
    end: number;
    settings: string;
    text: string;
}

/** addTextTrack ile eklenen izler kaldırılamıyor — video başına havuz; aynı label+dil tekrar kullanılır. */
const pools = new WeakMap<HTMLVideoElement, Map<string, TextTrack>>();
/** Her attach'te artar — önceki kaynağın geç gelen fetch'i yeni izlere cue eklemesin. */
const generations = new WeakMap<HTMLVideoElement, number>();

/**
 * Altyazıları <track> elementi yerine VTT'yi kendimiz indirip addTextTrack + VTTCue ile ekliyoruz.
 * iOS WebKit <track>'leri "out-of-band" iz olarak AVFoundation'a veriyor ve bu, geçerli bir VTT'de bile
 * videonun tamamını MEDIA_ERR_SRC_NOT_SUPPORTED (kod 4) ile düşürebiliyor. Mode 'hidden' — cue'lar akar
 * ama tarayıcı çizmez (CaptionRenderer çizer).
 */
export function attachSubtitleTracks(video: HTMLVideoElement, subtitles: HopeSubtitleOption[]): AttachedTrack[] {
    video.querySelectorAll('track').forEach((t) => t.remove());
    clearSubtitleTracks(video);
    const generation = generations.get(video)!;
    let pool = pools.get(video);
    if (!pool) pools.set(video, (pool = new Map()));

    const attached: AttachedTrack[] = [];
    for (const sub of subtitles) {
        const key = `${sub.label}\u0000${sub.srclang}`;
        let track = pool.get(key);
        if (!track) {
            track = video.addTextTrack('subtitles', sub.label, sub.srclang);
            pool.set(key, track);
        }
        track.mode = sub.default ? 'hidden' : 'disabled';
        attached.push({ label: sub.label, track });
        void loadCues(video, track, sub.src, generation);
    }
    return attached;
}

/** Tüm havuz izlerini kapatıp boşaltır (altyazısız kaynağa geçiş). */
export function clearSubtitleTracks(video: HTMLVideoElement): void {
    generations.set(video, (generations.get(video) ?? 0) + 1);
    for (const track of pools.get(video)?.values() ?? []) {
        // Kapalı izde track.cues null döner — boşaltmak için geçici olarak hidden.
        track.mode = 'hidden';
        for (const cue of Array.from(track.cues ?? [])) track.removeCue(cue);
        track.mode = 'disabled';
    }
}

/** Yalnızca seçilen track'i 'hidden' yapar, diğerlerini kapatır (null = hepsini kapat). */
export function selectSubtitleTrack(tracks: AttachedTrack[], label: string | null): TextTrack | null {
    let active: TextTrack | null = null;
    for (const { label: trackLabel, track } of tracks) {
        const isActive = trackLabel === label;
        track.mode = isActive ? 'hidden' : 'disabled';
        if (isActive) active = track;
    }
    return active;
}

async function loadCues(video: HTMLVideoElement, track: TextTrack, src: string, generation: number): Promise<void> {
    let text: string;
    try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
    } catch (err) {
        console.warn('[HopePlayer] altyazı yüklenemedi:', src, err);
        return;
    }
    if (generations.get(video) !== generation || typeof VTTCue !== 'function') return;
    for (const c of parseVttCues(text)) {
        const cue = new VTTCue(c.start, c.end, c.text);
        applyCueSettings(cue, c.settings);
        track.addCue(cue);
    }
}

const TIMESTAMP = '(?:\\d+:)?\\d{1,2}:\\d{2}(?:[.,]\\d{1,3})?';
const TIMING_LINE = new RegExp(`^(${TIMESTAMP})\\s+-->\\s+(${TIMESTAMP})(.*)$`);

function toSeconds(value: string): number {
    return value
        .replace(',', '.')
        .split(':')
        .reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** WebVTT gövdesinden cue'ları çıkarır — NOTE/STYLE/REGION blokları zamanlama satırı içermediği için atlanır. */
export function parseVttCues(text: string): ParsedCue[] {
    const cues: ParsedCue[] = [];
    const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    for (const block of blocks) {
        const lines = block.split('\n');
        const timingIndex = lines.findIndex((l) => l.includes('-->'));
        if (timingIndex < 0) continue;
        const m = TIMING_LINE.exec(lines[timingIndex]!.trim());
        if (!m) continue;
        const body = lines.slice(timingIndex + 1).join('\n');
        if (!body.trim()) continue;
        cues.push({ start: toSeconds(m[1]!), end: toSeconds(m[2]!), settings: m[3]!.trim(), text: body });
    }
    return cues;
}

/** "line:-2 position:50% align:center" gibi cue ayarları — geçersiz değerleri tarayıcı reddeder, yok sayıyoruz. */
function applyCueSettings(cue: VTTCue, settings: string): void {
    for (const token of settings.split(/\s+/)) {
        const [key, raw] = token.split(':');
        if (!key || !raw) continue;
        const [value] = raw.split(',');
        try {
            if (key === 'align') cue.align = value as AlignSetting;
            else if (key === 'vertical') cue.vertical = value as DirectionSetting;
            else if (key === 'size') cue.size = parseFloat(value!);
            else if (key === 'position') cue.position = parseFloat(value!);
            else if (key === 'line') {
                cue.snapToLines = !value!.endsWith('%');
                cue.line = parseFloat(value!);
            }
        } catch {
            // Desteklenmeyen ayar — cue ayarsız gösterilir.
        }
    }
}
