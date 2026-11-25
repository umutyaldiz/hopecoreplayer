// SCTE-35: yayından sinyal toplama (hls.js, Safari native HLS, dash.js) + reklam arası durumu. Ayrı parça, yalnızca
// `scte35` açıkken iner.
import type { Scte35Signal } from '../types';
import { decodeBytes, signalFromBytes, signalFromDateRange, signalFromHlsTag, signalFromXml, signalFromXmlText } from './parse';

export type Scte35Sink = (signal: Scte35Signal) => void;

const SCTE_TAG = /SCTE|CUE-(OUT|IN)/i;
const DATERANGE_KEYS = ['SCTE35-OUT', 'SCTE35-IN', 'SCTE35-CMD'] as const;

/** hls.js parçası (yalnızca kullanılan alanlar). */
interface HlsFrag {
    sn: number | 'initSegment';
    cc: number;
    level: number;
    start: number;
    duration: number;
    programDateTime: number | null;
    tagList?: string[][];
}
interface HlsDateRange {
    id: string;
    attr: Record<string, unknown>;
    startDate: Date;
    endDate: Date | null;
    duration: number | null;
    plannedDuration: number | null;
}
interface HlsLike {
    on(event: string, cb: (event: string, data: { frag?: HlsFrag }) => void): void;
    off(event: string, cb: (event: string, data: { frag?: HlsFrag }) => void): void;
    levels: Array<{ details?: { dateRanges?: Record<string, HlsDateRange> } }>;
}

const plainAttrs = (attr: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(attr)) if (typeof v === 'string') out[k.toUpperCase()] = v;
    return out;
};

/** Zamanı gelince çalışacak sinyaller (DATERANGE parçanın ortasında başlayabilir). */
function scheduler(video: HTMLVideoElement): { at(time: number, run: () => void): void; stop(): void } {
    let queue: Array<{ time: number; run: () => void }> = [];
    const tick = (): void => {
        const due = queue.filter((q) => q.time <= video.currentTime + 0.05);
        if (!due.length) return;
        queue = queue.filter((q) => !due.includes(q));
        for (const q of due) q.run();
    };
    video.addEventListener('timeupdate', tick);
    return {
        at(time, run) {
            if (time <= video.currentTime + 0.05) run();
            else queue.push({ time, run });
        },
        stop() {
            queue = [];
            video.removeEventListener('timeupdate', tick);
        },
    };
}

/** hls.js: parça oynamaya başlayınca etiketleri (tagList) ve DATERANGE'leri (PROGRAM-DATE-TIME ile) okur. */
export function watchHlsJs(hls: HlsLike, fragChanged: string, video: HTMLVideoElement, push: Scte35Sink): () => void {
    const seenFrags = new Set<string>();
    const seenRanges = new Set<string>();
    const sched = scheduler(video);

    const dateRange = (attrs: Record<string, string>, key: string, time: number, elapsed: number): void => {
        const only: Record<string, string> = { ...attrs };
        for (const k of DATERANGE_KEYS) if (k !== key) delete only[k];
        const s = signalFromDateRange(only, time, elapsed);
        if (s) push(s);
    };

    const onFrag = (_e: string, data: { frag?: HlsFrag }): void => {
        const frag = data.frag;
        if (!frag || frag.sn === 'initSegment') return;
        const pdt = frag.programDateTime;
        const key = `${frag.cc}|${frag.sn}`;
        if (!seenFrags.has(key)) {
            seenFrags.add(key);
            if (seenFrags.size > 1000) seenFrags.clear();
            for (const [tag, value = ''] of frag.tagList ?? []) {
                if (!tag || (!SCTE_TAG.test(tag) && tag !== 'EXT-X-DATERANGE')) continue;
                if (tag === 'EXT-X-DATERANGE') {
                    // PROGRAM-DATE-TIME yoksa DATERANGE zamanlanamaz — bulunduğu parçanın başında uygulanır.
                    if (pdt !== null) continue;
                    const attrs = Object.fromEntries(Object.entries(parseDateRangeText(value)));
                    const id = attrs['ID'] ?? value;
                    for (const k of DATERANGE_KEYS) {
                        if (!attrs[k] || seenRanges.has(`${id}|${k}`)) continue;
                        seenRanges.add(`${id}|${k}`);
                        dateRange(attrs, k, frag.start, 0);
                    }
                    continue;
                }
                const s = signalFromHlsTag(tag, value, frag.start);
                if (s) push(s);
            }
        }
        if (pdt === null) return;
        const ranges = hls.levels[frag.level]?.details?.dateRanges;
        if (!ranges) return;
        const fragEnd = pdt + frag.duration * 1000;
        for (const dr of Object.values(ranges)) {
            const attrs = plainAttrs(dr.attr);
            attrs['ID'] ??= dr.id;
            const duration = dr.duration ?? dr.plannedDuration;
            for (const k of DATERANGE_KEYS) {
                if (!attrs[k] || seenRanges.has(`${dr.id}|${k}`)) continue;
                const start = dr.startDate.getTime();
                // IN: aynı ID'nin bitişi (END-DATE / DURATION) ya da ayrı bir DATERANGE'in başlangıcı.
                const at = k === 'SCTE35-IN' && dr.endDate ? dr.endDate.getTime() : start;
                if (at >= fragEnd) continue;
                seenRanges.add(`${dr.id}|${k}`);
                // Çoktan bitmiş ara (aranın ortasında değil, sonrasında katılındı) yok sayılır.
                if (k !== 'SCTE35-IN' && duration !== null && start + duration * 1000 <= pdt) continue;
                if (k === 'SCTE35-IN' && at < pdt - frag.duration * 1000) continue;
                const mediaTime = frag.start + (at - pdt) / 1000;
                const elapsed = Math.max(0, (pdt - start) / 1000);
                sched.at(mediaTime, () => dateRange(attrs, k, Math.max(frag.start, mediaTime), k === 'SCTE35-IN' ? 0 : elapsed + Math.max(0, video.currentTime - Math.max(frag.start, mediaTime))));
            }
        }
    };
    hls.on(fragChanged, onFrag);
    return () => {
        hls.off(fragChanged, onFrag);
        sched.stop();
    };
}

/** "ID=…,START-DATE=…" metni (tırnaklı değerler dahil). */
function parseDateRangeText(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out[m[1]!.toUpperCase()] = m[2]!.replace(/^"|"$/g, '');
    return out;
}

const toHex = (b: Uint8Array): string => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

/** Safari native HLS: DATERANGE (ve bazı paketleyicilerin etiket) metadata cue'ları. */
export function watchNativeCues(video: HTMLVideoElement, push: Scte35Sink): () => void {
    const done = new WeakSet<TextTrackCue>();
    const listeners = new Map<TextTrack, () => void>();

    const process = (cue: TextTrackCue): void => {
        const c = cue as TextTrackCue & { value?: { key?: string; data?: unknown; value?: unknown }; text?: string };
        const elapsed = Math.max(0, video.currentTime - cue.startTime);
        if (c.value && typeof c.value.key === 'string') {
            const key = c.value.key.toUpperCase();
            const data = c.value.data ?? c.value.value;
            if ((DATERANGE_KEYS as readonly string[]).includes(key)) {
                const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : typeof data === 'string' ? decodeBytes(data) : null;
                if (!bytes) return;
                const attrs: Record<string, string> = { [key]: toHex(bytes) };
                if (cue.id) attrs['ID'] = cue.id;
                if (Number.isFinite(cue.endTime) && cue.endTime > cue.startTime) attrs['DURATION'] = String(cue.endTime - cue.startTime);
                const s = signalFromDateRange(attrs, cue.startTime, key === 'SCTE35-IN' ? 0 : elapsed);
                if (s) push({ ...s, format: 'metadata-cue' });
            } else if (key.startsWith('EXT')) {
                const s = signalFromHlsTag(key, typeof data === 'string' ? data : '', cue.startTime);
                if (s) push({ ...s, format: s.format, elapsed: s.elapsed || 0 });
            }
            return;
        }
        const m = typeof c.text === 'string' ? /^#?(EXT[^:]+):?(.*)$/.exec(c.text.trim()) : null;
        if (m) {
            const s = signalFromHlsTag(m[1]!, m[2] ?? '', cue.startTime);
            if (s) push(s);
        }
    };
    const listen = (track: TextTrack): void => {
        if (track.kind !== 'metadata' || listeners.has(track)) return;
        track.mode = 'hidden';
        const onChange = (): void => {
            const cues = track.activeCues;
            if (!cues) return;
            for (let i = 0; i < cues.length; i++) {
                const cue = cues[i]!;
                if (done.has(cue)) continue;
                done.add(cue);
                process(cue);
            }
        };
        track.addEventListener('cuechange', onChange);
        listeners.set(track, onChange);
    };
    const onAdd = (e: TrackEvent): void => {
        if (e.track) listen(e.track as TextTrack);
    };
    for (let i = 0; i < video.textTracks.length; i++) listen(video.textTracks[i]!);
    video.textTracks.addEventListener('addtrack', onAdd);
    return () => {
        video.textTracks.removeEventListener('addtrack', onAdd);
        for (const [track, fn] of listeners) track.removeEventListener('cuechange', fn);
        listeners.clear();
    };
}

/** DASH SCTE-35 şemaları (MPD EventStream ve inband emsg). */
export const DASH_SCTE35_SCHEMES = ['urn:scte:scte35:2013:xml', 'urn:scte:scte35:2014:xml', 'urn:scte:scte35:2014:xml+bin', 'urn:scte:scte35:2013:bin', 'urn:scte:scte35:2014:bin'];

interface DashEvent {
    id?: number | null;
    duration?: number;
    presentationTime?: number;
    calculatedPresentationTime?: number;
    messageData?: unknown;
    eventStream?: { schemeIdUri?: string };
}
interface DashPlayerLike {
    on(type: string, cb: (e: { event?: DashEvent }) => void, scope?: unknown, options?: { mode?: string }): void;
    off(type: string, cb: (e: { event?: DashEvent }) => void, scope?: unknown): void;
    getDashAdapter?(): { getMpd?(): { manifest?: Record<string, unknown> } | null };
}
interface ManifestNode {
    attributes?: Record<string, string>;
    childNodes?: ManifestNode[];
    nodeName?: string;
    [k: string]: unknown;
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** dash.js XML olaylarında içerik olay nesnesine taşınmaz — manifest ağacından bulunur. */
function manifestEvent(player: DashPlayerLike, scheme: string, ev: DashEvent): ManifestNode | null {
    try {
        const manifest = player.getDashAdapter?.()?.getMpd?.()?.manifest as { Period?: ManifestNode | ManifestNode[] } | undefined;
        for (const period of asArray(manifest?.Period)) {
            for (const stream of asArray(period['EventStream'] as ManifestNode | ManifestNode[] | undefined)) {
                if ((stream.attributes?.['schemeIdUri'] ?? stream['schemeIdUri']) !== scheme) continue;
                for (const e of asArray(stream['Event'] as ManifestNode | ManifestNode[] | undefined)) {
                    const id = e.attributes?.['id'] ?? e['id'];
                    const pt = Number(e.attributes?.['presentationTime'] ?? e['presentationTime'] ?? 0);
                    if (String(id ?? '') === String(ev.id ?? '') && (ev.presentationTime === undefined || pt === ev.presentationTime)) return e;
                }
            }
        }
    } catch {
        /* manifest erişilemedi */
    }
    return null;
}

/** dash.js: SCTE-35 şemalarına abone olur; olay başlarken sinyal üretir. */
export function watchDash(player: DashPlayerLike, video: HTMLVideoElement, push: Scte35Sink): () => void {
    const handler = (e: { event?: DashEvent }): void => {
        const ev = e.event;
        if (!ev) return;
        const scheme = ev.eventStream?.schemeIdUri ?? '';
        const time = ev.calculatedPresentationTime ?? video.currentTime;
        const node = manifestEvent(player, scheme, ev);
        const base = {
            source: 'dash' as const,
            format: (node || !(ev.messageData instanceof Uint8Array) ? 'event-stream' : 'emsg') as Scte35Signal['format'],
            time,
            id: ev.id !== null && ev.id !== undefined ? String(ev.id) : undefined,
            elapsed: Math.max(0, video.currentTime - time),
        };
        const md = ev.messageData;
        let s: Scte35Signal | null = null;
        if (md instanceof Uint8Array) s = signalFromBytes(md, base);
        else if (typeof md === 'string' && md.trim()) {
            const t = md.trim();
            const bytes = t.startsWith('<') ? null : decodeBytes(t);
            s = t.startsWith('<') ? signalFromXmlText(t, base) : bytes ? signalFromBytes(bytes, base) : null;
        } else if (node) s = signalFromXml(node as Parameters<typeof signalFromXml>[0], base);
        if (!s) return;
        // Event@duration, break_duration / segmentation_duration yoksa ara süresidir.
        if (s.action === 'start' && s.duration === null && ev.duration && ev.duration > 0) s.duration = ev.duration;
        push(s);
    };
    for (const scheme of DASH_SCTE35_SCHEMES) player.on(scheme, handler, null, { mode: 'eventModeOnStart' });
    return () => {
        for (const scheme of DASH_SCTE35_SCHEMES) player.off(scheme, handler, null);
    };
}

interface ActiveBreak {
    id: string | null;
    typeId?: number;
    timer: ReturnType<typeof setTimeout> | null;
}

/** Sinyallerden reklam arası durumu: hp:scte35 (her sinyal), hp:adbreakstart, hp:adbreakend. */
export class Scte35Tracker {
    private active: ActiveBreak | null = null;
    private readonly recent = new Map<string, number>();

    constructor(private readonly host: HTMLElement) {}

    readonly push = (s: Scte35Signal): void => {
        // Aynı sinyal birden fazla yoldan (ör. kalite değişiminde aynı parça, DATERANGE güncellemesi) gelebilir.
        // Kimliksiz sinyaller (CUE-OUT / CUE-IN) ve her parçada tekrarlanan CUE-OUT-CONT zamanıyla ayırt edilir.
        const byTime = (!s.id && !s.raw) || s.format === 'cue-out-cont';
        const key = `${s.format}|${s.action}|${s.id ?? ''}|${s.raw ?? ''}|${byTime ? Math.round(s.time) : ''}`;
        const now = Date.now();
        const last = this.recent.get(key);
        if (last !== undefined && now - last < 30_000) return;
        this.recent.set(key, now);
        if (this.recent.size > 200) for (const [k, t] of this.recent) if (now - t > 30_000) this.recent.delete(k);

        this.host.dispatchEvent(new CustomEvent('hp:scte35', { detail: s }));
        if (s.action === 'start') this.start(s);
        else if (s.action === 'end') this.endFrom(s);
        else if (s.action === 'cancel' && this.active && (!s.id || !this.active.id || s.id === this.active.id)) this.end('cancel');
    };

    get inBreak(): boolean {
        return this.active !== null;
    }

    private start(s: Scte35Signal): void {
        if (this.active) {
            // Aranın içindeki reklam başlangıçları (ör. 0x34 içinde 0x30) ve CUE-OUT-CONT yeni ara değildir.
            if (this.active.id && s.id === this.active.id && s.duration !== null && !this.active.timer) this.arm(s.duration - s.elapsed);
            return;
        }
        const remaining = s.duration !== null ? Math.max(0, s.duration - s.elapsed) : null;
        if (remaining !== null && remaining <= 0.5) return;
        this.active = { id: s.id, typeId: s.segmentationTypeId, timer: null };
        if (remaining !== null) this.arm(remaining);
        this.host.dispatchEvent(new CustomEvent('hp:adbreakstart', { detail: { id: s.id, duration: s.duration, remaining, signal: s } }));
    }

    /** Bitiş sinyali gelmezse ara süresi dolunca biter (auto_return). */
    private arm(seconds: number): void {
        if (!this.active) return;
        if (this.active.timer) clearTimeout(this.active.timer);
        this.active.timer = setTimeout(() => this.end('duration'), (Math.max(0, seconds) + 1) * 1000);
    }

    private endFrom(s: Scte35Signal): void {
        const a = this.active;
        if (!a) return;
        // time_signal çiftleri: yalnızca başlangıcın eşi bitirir (0x34 → 0x35); içerdeki reklam bitişleri (0x31) bitirmez.
        if (a.typeId !== undefined && s.segmentationTypeId !== undefined && s.segmentationTypeId !== a.typeId + 1) return;
        this.end('signal');
    }

    private end(reason: 'signal' | 'duration' | 'cancel' | 'source'): void {
        const a = this.active;
        if (!a) return;
        if (a.timer) clearTimeout(a.timer);
        this.active = null;
        this.host.dispatchEvent(new CustomEvent('hp:adbreakend', { detail: { id: a.id, reason } }));
    }

    /** Kaynak değişti: açık ara kapanır, geçmiş sinyaller unutulur. */
    reset(): void {
        this.end('source');
        this.recent.clear();
    }

    destroy(): void {
        if (this.active?.timer) clearTimeout(this.active.timer);
        this.active = null;
        this.recent.clear();
    }
}
