import type { HopeSourceFormat, HopeSourceOption } from '../types';
import { detectSourceType } from './SourceManager';

/** Aynı biçimdeki kaynaklar (ör. tüm MP4 kaliteleri) — biri çalınır, menüde yalnızca bunlar görünür. */
export interface SourceGroup {
    format: HopeSourceFormat;
    sources: HopeSourceOption[];
}

const FILE_MIME: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    flac: 'audio/flac',
};

/** `hls`, `mp4` ya da dosya uzantısı (`webm`, `mov`, `mp3`…); belirlenemezse `other`. MIME `type` uzantıdan önce gelir. */
export function sourceFormat(s: HopeSourceOption): HopeSourceFormat {
    const detected = detectSourceType(s.src, s.type);
    if (detected !== 'unknown') return detected;
    const mime = s.type?.split(';')[0]?.trim().toLowerCase();
    if (mime) {
        const ext = Object.keys(FILE_MIME).find((k) => FILE_MIME[k] === mime);
        if (ext) return ext;
    }
    const m = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(s.src);
    return m ? m[1]!.toLowerCase() : 'other';
}

/**
 * Kaynakları biçime göre gruplar: önce `priority` sırası, sonra listede ilk görünme sırası.
 * `priority`'de olmayan biçimler sona eklenir (hiçbiri atılmaz — son çare olarak yine denenir).
 */
export function groupSources(sources: HopeSourceOption[], priority?: readonly HopeSourceFormat[]): SourceGroup[] {
    const groups: SourceGroup[] = [];
    for (const s of sources) {
        const format = sourceFormat(s);
        const g = groups.find((x) => x.format === format);
        if (g) g.sources.push(s);
        else groups.push({ format, sources: [s] });
    }
    if (!priority?.length) return groups;
    const rank = (f: HopeSourceFormat): number => {
        const i = priority.findIndex((p) => p.toLowerCase() === f);
        return i === -1 ? priority.length : i;
    };
    // Array.prototype.sort kararlı — aynı sıradakiler listedeki düzenini korur.
    return groups.sort((a, b) => rank(a.format) - rank(b.format));
}

/**
 * Bu tarayıcı grubu hiç oynatamaz mı (denemeden atlanabilir). Emin olunamayan durumlarda false —
 * atlamak yerine denenir, hata alınırsa zaten sıradaki gruba geçilir.
 */
export function cannotPlay(group: SourceGroup, video: HTMLVideoElement): boolean {
    if (group.format === 'dash') {
        const w = window as unknown as { MediaSource?: unknown; ManagedMediaSource?: unknown };
        return typeof w.MediaSource === 'undefined' && typeof w.ManagedMediaSource === 'undefined';
    }
    if (group.format === 'hls') {
        const w = window as unknown as { MediaSource?: unknown; ManagedMediaSource?: unknown };
        const mse = typeof w.MediaSource !== 'undefined' || typeof w.ManagedMediaSource !== 'undefined';
        return !mse && video.canPlayType('application/vnd.apple.mpegurl') === '';
    }
    const mime = group.sources.find((s) => s.type)?.type ?? FILE_MIME[group.format];
    return !!mime && video.canPlayType(mime) === '';
}
