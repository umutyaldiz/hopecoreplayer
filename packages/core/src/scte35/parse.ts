// SCTE-35 (ANSI/SCTE 35) splice_info_section çözücü + HLS etiketleri ve DASH XML'i için ortak sinyal biçimi.
import type { Scte35Signal, Scte35SpliceInfo, Scte35SegmentationDescriptor } from '../types';

const PTS_WRAP = 2 ** 33;
const CUEI = 0x43554549;

/** Bit okuyucu (en fazla 53 bit, sayı olarak). */
class Bits {
    private pos = 0;
    constructor(private readonly b: Uint8Array) {}
    get byte(): number {
        return this.pos >> 3;
    }
    read(n: number): number {
        let v = 0;
        for (let i = 0; i < n; i++) {
            const byte = this.b[this.pos >> 3];
            if (byte === undefined) throw new RangeError('scte35: eof');
            v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
            this.pos++;
        }
        return v;
    }
    skip(n: number): void {
        this.pos += n;
    }
    seek(byte: number): void {
        this.pos = byte * 8;
    }
    bytes(n: number): Uint8Array {
        const start = this.pos >> 3;
        this.pos += n * 8;
        return this.b.subarray(start, start + n);
    }
}

/** Segmentation type id → ad (SCTE 35 Tablo 22). */
export const SEGMENTATION_TYPES: Record<number, string> = {
    0x00: 'Not Indicated',
    0x01: 'Content Identification',
    0x02: 'Call Ad Server',
    0x10: 'Program Start',
    0x11: 'Program End',
    0x12: 'Program Early Termination',
    0x13: 'Program Breakaway',
    0x14: 'Program Resumption',
    0x15: 'Program Runover Planned',
    0x16: 'Program Runover Unplanned',
    0x17: 'Program Overlap Start',
    0x18: 'Program Blackout Override',
    0x19: 'Program Join',
    0x20: 'Chapter Start',
    0x21: 'Chapter End',
    0x22: 'Break Start',
    0x23: 'Break End',
    0x24: 'Opening Credit Start',
    0x25: 'Opening Credit End',
    0x26: 'Closing Credit Start',
    0x27: 'Closing Credit End',
    0x30: 'Provider Advertisement Start',
    0x31: 'Provider Advertisement End',
    0x32: 'Distributor Advertisement Start',
    0x33: 'Distributor Advertisement End',
    0x34: 'Provider Placement Opportunity Start',
    0x35: 'Provider Placement Opportunity End',
    0x36: 'Distributor Placement Opportunity Start',
    0x37: 'Distributor Placement Opportunity End',
    0x38: 'Provider Overlay Placement Opportunity Start',
    0x39: 'Provider Overlay Placement Opportunity End',
    0x3a: 'Distributor Overlay Placement Opportunity Start',
    0x3b: 'Distributor Overlay Placement Opportunity End',
    0x3c: 'Provider Promo Start',
    0x3d: 'Provider Promo End',
    0x3e: 'Distributor Promo Start',
    0x3f: 'Distributor Promo End',
    0x40: 'Unscheduled Event Start',
    0x41: 'Unscheduled Event End',
    0x42: 'Alternate Content Opportunity Start',
    0x43: 'Alternate Content Opportunity End',
    0x44: 'Provider Ad Block Start',
    0x45: 'Provider Ad Block End',
    0x46: 'Distributor Ad Block Start',
    0x47: 'Distributor Ad Block End',
    0x50: 'Network Start',
    0x51: 'Network End',
};

/** Reklam arası başlatan / bitiren segmentation type id'leri (Break, Advertisement, Placement Opportunity, Ad Block). */
export const BREAK_START_TYPES = [0x22, 0x30, 0x32, 0x34, 0x36, 0x44, 0x46];
export const BREAK_END_TYPES = [0x23, 0x31, 0x33, 0x35, 0x37, 0x45, 0x47];
/** sub_segment alanları olan tipler. */
const SUB_SEGMENT_TYPES = [0x34, 0x36, 0x38, 0x3a, 0x44, 0x46];

const COMMANDS: Record<number, Scte35SpliceInfo['command']> = {
    0x00: 'splice_null',
    0x04: 'splice_schedule',
    0x05: 'splice_insert',
    0x06: 'time_signal',
    0x07: 'bandwidth_reservation',
    0xff: 'private_command',
};

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** base64 ya da hex ("0xFC30…") metni → bayt. Çözülemezse null. */
export function decodeBytes(text: string): Uint8Array | null {
    const t = text.trim().replace(/^"|"$/g, '');
    if (!t) return null;
    if (/^0x[0-9a-f]+$/i.test(t) || (/^[0-9a-f]+$/i.test(t) && t.length % 2 === 0 && /^fc/i.test(t))) {
        const h = t.replace(/^0x/i, '');
        const out = new Uint8Array(h.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
        return out;
    }
    try {
        const bin = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch {
        return null;
    }
}

/** CRC-32/MPEG-2 (splice_info_section'ın son 4 baytı). */
function crc32(b: Uint8Array, end: number): number {
    let crc = 0xffffffff;
    for (let i = 0; i < end; i++) {
        crc ^= b[i]! << 24;
        for (let k = 0; k < 8; k++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    return crc >>> 0;
}

function spliceTime(r: Bits, ptsAdjustment: number): number | null {
    const specified = r.read(1);
    if (!specified) {
        r.skip(7);
        return null;
    }
    r.skip(6);
    return ((r.read(33) + ptsAdjustment) % PTS_WRAP) / 90000;
}

function upidText(type: number, b: Uint8Array): string {
    // Metin tabanlı UPID'ler: User Defined, ISCI, Ad-ID, ADI, URI, UUID değil — yazdırılabilirse metin, değilse hex.
    if ([0x01, 0x02, 0x03, 0x09, 0x0e, 0x0f].includes(type) && b.every((x) => x >= 0x20 && x < 0x7f)) return String.fromCharCode(...b);
    return hex(b);
}

function segmentation(r: Bits, end: number): Scte35SegmentationDescriptor {
    const eventId = r.read(32);
    const cancel = r.read(1) === 1;
    r.skip(7);
    if (cancel) return { eventId, cancel, typeId: null, type: null, duration: null, upidType: 0, upid: '', segmentNum: 0, segmentsExpected: 0 };
    const program = r.read(1);
    const hasDuration = r.read(1);
    const deliveryNotRestricted = r.read(1);
    let restrictions: Scte35SegmentationDescriptor['restrictions'];
    if (!deliveryNotRestricted) {
        restrictions = { webDeliveryAllowed: r.read(1) === 1, noRegionalBlackout: r.read(1) === 1, archiveAllowed: r.read(1) === 1, deviceRestrictions: r.read(2) };
    } else r.skip(5);
    if (!program) {
        const count = r.read(8);
        r.skip(count * 48);
    }
    const duration = hasDuration ? r.read(40) / 90000 : null;
    const upidType = r.read(8);
    const upidLength = r.read(8);
    const upid = upidText(upidType, r.bytes(upidLength));
    const typeId = r.read(8);
    const d: Scte35SegmentationDescriptor = {
        eventId,
        cancel,
        typeId,
        type: SEGMENTATION_TYPES[typeId] ?? `0x${typeId.toString(16)}`,
        duration,
        upidType,
        upid,
        segmentNum: r.read(8),
        segmentsExpected: r.read(8),
        restrictions,
    };
    if (SUB_SEGMENT_TYPES.includes(typeId) && r.byte + 2 <= end) {
        d.subSegmentNum = r.read(8);
        d.subSegmentsExpected = r.read(8);
    }
    return d;
}

/** splice_info_section'ı çözer (tüm komutlar ve segmentation descriptor'lar). Geçersizse null. */
export function parseSpliceInfo(bytes: Uint8Array): Scte35SpliceInfo | null {
    try {
        const r = new Bits(bytes);
        if (r.read(8) !== 0xfc) return null;
        r.skip(2);
        const sapType = r.read(2);
        const sectionLength = r.read(12);
        const protocolVersion = r.read(8);
        const encrypted = r.read(1) === 1;
        r.skip(6);
        const ptsAdjustment = r.read(33);
        r.skip(8);
        const tier = r.read(12);
        const commandLength = r.read(12);
        const commandType = r.read(8);
        const commandStart = r.byte;
        const total = 3 + sectionLength;
        const info: Scte35SpliceInfo = {
            protocolVersion,
            sapType,
            encrypted,
            ptsAdjustment: ptsAdjustment / 90000,
            tier,
            commandType,
            command: COMMANDS[commandType] ?? 'unknown',
            descriptors: [],
            crcValid: total <= bytes.length && total >= 4 ? crc32(bytes, total) === 0 : false,
        };
        // Şifreli paketin komutu okunamaz.
        if (encrypted) return info;

        if (commandType === 0x05) {
            const eventId = r.read(32);
            const cancel = r.read(1) === 1;
            r.skip(7);
            const si: NonNullable<Scte35SpliceInfo['spliceInsert']> = { eventId, cancel, outOfNetwork: false, programSplice: true, immediate: false, spliceTime: null, breakDuration: null, uniqueProgramId: 0, availNum: 0, availsExpected: 0 };
            if (!cancel) {
                si.outOfNetwork = r.read(1) === 1;
                si.programSplice = r.read(1) === 1;
                const hasDuration = r.read(1) === 1;
                si.immediate = r.read(1) === 1;
                r.skip(4);
                if (si.programSplice && !si.immediate) si.spliceTime = spliceTime(r, ptsAdjustment);
                if (!si.programSplice) {
                    const count = r.read(8);
                    for (let i = 0; i < count; i++) {
                        r.skip(8);
                        if (!si.immediate) spliceTime(r, ptsAdjustment);
                    }
                }
                if (hasDuration) {
                    const autoReturn = r.read(1) === 1;
                    r.skip(6);
                    si.breakDuration = { autoReturn, seconds: r.read(33) / 90000 };
                }
                si.uniqueProgramId = r.read(16);
                si.availNum = r.read(8);
                si.availsExpected = r.read(8);
            }
            info.spliceInsert = si;
        } else if (commandType === 0x06) {
            info.timeSignal = { spliceTime: spliceTime(r, ptsAdjustment) };
        } else if (commandType === 0xff) {
            info.privateIdentifier = r.read(32);
        }

        if (commandLength !== 0xfff) r.seek(commandStart + commandLength);
        const loopLength = r.read(16);
        const loopEnd = r.byte + loopLength;
        while (r.byte + 2 <= loopEnd) {
            const tag = r.read(8);
            const length = r.read(8);
            const start = r.byte;
            const identifier = length >= 4 ? r.read(32) : 0;
            if (identifier === CUEI && tag === 0x02) info.descriptors.push(segmentation(r, start + length));
            else if (identifier === CUEI && tag === 0x00 && length >= 8) info.availId = r.read(32);
            r.seek(start + length);
        }
        return info;
    } catch {
        return null;
    }
}

type SignalBase = Pick<Scte35Signal, 'source' | 'format' | 'time'> & Partial<Pick<Scte35Signal, 'id' | 'duration' | 'elapsed'>>;

/** Çözülmüş splice_info_section → reklam arası sinyali. */
export function signalFromInfo(info: Scte35SpliceInfo, base: SignalBase, raw?: string): Scte35Signal {
    const s: Scte35Signal = { action: 'info', id: base.id ?? null, duration: base.duration ?? null, elapsed: base.elapsed ?? 0, source: base.source, format: base.format, time: base.time, command: info.command, raw, spliceInfo: info };
    if (info.encrypted) return s;
    const si = info.spliceInsert;
    if (si) {
        s.id ??= String(si.eventId);
        if (si.cancel) s.action = 'cancel';
        else if (si.outOfNetwork) {
            s.action = 'start';
            s.duration = si.breakDuration?.seconds ?? s.duration;
        } else s.action = 'end';
        return s;
    }
    const cancel = info.descriptors.find((d) => d.cancel);
    const start = info.descriptors.find((d) => d.typeId !== null && BREAK_START_TYPES.includes(d.typeId));
    const end = info.descriptors.find((d) => d.typeId !== null && BREAK_END_TYPES.includes(d.typeId));
    const d = start ?? end ?? cancel ?? info.descriptors[0];
    if (!d) return s;
    s.id ??= String(d.eventId);
    s.segmentationTypeId = d.typeId ?? undefined;
    s.segmentationType = d.type ?? undefined;
    if (d.upid) s.upid = d.upid;
    if (d === start) {
        s.action = 'start';
        s.duration = d.duration ?? s.duration;
    } else if (d === end) s.action = 'end';
    else if (d === cancel) s.action = 'cancel';
    return s;
}

/** Bayt dizisi → sinyal (çözülemezse null). */
export function signalFromBytes(bytes: Uint8Array, base: SignalBase): Scte35Signal | null {
    const info = parseSpliceInfo(bytes);
    return info ? signalFromInfo(info, base, hex(bytes)) : null;
}

/** HLS öznitelik listesi: KEY=VALUE,KEY="quoted". */
export function parseAttrs(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out[m[1]!.toUpperCase()] = m[2]!.replace(/^"|"$/g, '');
    return out;
}

const num = (v: string | undefined): number | null => {
    const n = v === undefined ? NaN : parseFloat(v);
    return Number.isFinite(n) ? n : null;
};

/** HLS medya listesi etiketi → sinyal. Desteklenen: CUE-OUT / CUE-OUT-CONT / CUE-IN, OATCLS-SCTE35, X-SCTE35, SPLICEPOINT-SCTE35. */
export function signalFromHlsTag(tag: string, value: string, time: number): Scte35Signal | null {
    const name = tag.replace(/^#/, '').toUpperCase();
    const base = { source: 'hls', time } as const;
    if (name === 'EXT-X-CUE-OUT') {
        const a = parseAttrs(value);
        return { action: 'start', id: a['ID'] ?? null, duration: num(a['DURATION'] ?? value), elapsed: 0, format: 'cue-out', ...base };
    }
    if (name === 'EXT-X-CUE-OUT-CONT') {
        // "5/30" ya da "ElapsedTime=5,Duration=30,SCTE35=…"
        const slash = /^\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(value);
        const a = parseAttrs(value);
        const elapsed = slash ? num(slash[1]) : num(a['ELAPSEDTIME'] ?? a['ELAPSED']);
        const duration = slash ? num(slash[2]) : num(a['DURATION']);
        const bytes = a['SCTE35'] ? decodeBytes(a['SCTE35']) : null;
        const parsed = bytes ? signalFromBytes(bytes, { format: 'cue-out-cont', ...base }) : null;
        return { ...(parsed ?? {}), action: 'start', id: parsed?.id ?? a['ID'] ?? null, duration: duration ?? parsed?.duration ?? null, elapsed: elapsed ?? 0, format: 'cue-out-cont', ...base };
    }
    if (name === 'EXT-X-CUE-IN') return { action: 'end', id: parseAttrs(value)['ID'] ?? null, duration: null, elapsed: 0, format: 'cue-in', ...base };
    if (name === 'EXT-OATCLS-SCTE35' || name === 'EXT-X-SPLICEPOINT-SCTE35') {
        const bytes = decodeBytes(value);
        return bytes ? signalFromBytes(bytes, { format: name === 'EXT-OATCLS-SCTE35' ? 'oatcls' : 'splicepoint', ...base }) : null;
    }
    if (name === 'EXT-X-SCTE35') {
        // Adobe: CUE="base64",DURATION=…,ID=…,CUE-OUT=YES|CONT,ELAPSED=…,CUE-IN=YES
        const a = parseAttrs(value);
        const bytes = a['CUE'] ? decodeBytes(a['CUE']) : null;
        const parsed = bytes ? signalFromBytes(bytes, { format: 'ext-x-scte35', ...base, id: a['ID'] }) : null;
        const cueOut = (a['CUE-OUT'] ?? '').toUpperCase();
        const s: Scte35Signal = parsed ?? { action: 'info', id: a['ID'] ?? null, duration: null, elapsed: 0, format: 'ext-x-scte35', ...base };
        if (cueOut === 'YES' || cueOut === 'CONT') s.action = 'start';
        else if ((a['CUE-IN'] ?? '').toUpperCase() === 'YES') s.action = 'end';
        s.duration = num(a['DURATION']) ?? s.duration;
        s.elapsed = num(a['ELAPSED']) ?? s.elapsed;
        return s;
    }
    return null;
}

/** HLS EXT-X-DATERANGE (SCTE35-OUT / SCTE35-IN / SCTE35-CMD öznitelikleri) → sinyal. */
export function signalFromDateRange(attrs: Record<string, string>, time: number, elapsed: number): Scte35Signal | null {
    const key = attrs['SCTE35-OUT'] ? 'SCTE35-OUT' : attrs['SCTE35-IN'] ? 'SCTE35-IN' : attrs['SCTE35-CMD'] ? 'SCTE35-CMD' : null;
    if (!key) return null;
    const duration = num(attrs['DURATION']) ?? num(attrs['PLANNED-DURATION']);
    const base = { source: 'hls', format: 'daterange', time, id: attrs['ID'] ?? undefined, elapsed } as const;
    const bytes = decodeBytes(attrs[key]!);
    const parsed = bytes ? signalFromBytes(bytes, base) : null;
    const s: Scte35Signal = parsed ?? { action: 'info', id: attrs['ID'] ?? null, duration: null, elapsed, source: 'hls', format: 'daterange', time };
    // DATERANGE'in kendi kimliği ve süresi önceliklidir (başlangıç / bitiş eşleşmesi ID ile yapılır).
    if (attrs['ID']) s.id = attrs['ID'];
    // Öznitelik adı belirleyicidir: SCTE35-OUT başlangıç, SCTE35-IN bitiş (içindeki komut iptal değilse).
    if (key === 'SCTE35-OUT' && s.action !== 'cancel') s.action = 'start';
    if (key === 'SCTE35-IN' && s.action !== 'cancel') s.action = 'end';
    if (s.action === 'start') s.duration = duration ?? s.duration;
    return s;
}

/** dash.js manifest düğümü (nodeName / attributes / childNodes). */
interface XmlNode {
    nodeName?: string;
    localName?: string;
    attributes?: Record<string, string>;
    childNodes?: XmlNode[];
    __text?: string;
    textContent?: string;
}

const localName = (n: XmlNode): string => (n.localName ?? n.nodeName ?? '').replace(/^.*:/, '');
const children = (n: XmlNode): XmlNode[] => (n.childNodes ?? []).filter((c) => c && typeof c === 'object' && (c.nodeName ?? '') !== '#text');
const find = (n: XmlNode, name: string): XmlNode | undefined => {
    if (localName(n) === name) return n;
    for (const c of children(n)) {
        const f = find(c, name);
        if (f) return f;
    }
    return undefined;
};
const attr = (n: XmlNode | undefined, k: string): string | undefined => n?.attributes?.[k];
const bool = (v: string | undefined): boolean => v === 'true' || v === '1';
const text = (n: XmlNode): string => n.__text ?? n.textContent ?? (n.childNodes ?? []).map((c) => (c.nodeName === '#text' ? ((c as { nodeValue?: string }).nodeValue ?? '') : '')).join('');

/** DOM Element (DOMParser) → dash.js biçimli düğüm. */
export function nodeFromElement(el: Element): XmlNode {
    const attributes: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) attributes[a.name] = a.value;
    return { nodeName: el.nodeName, localName: el.localName, attributes, childNodes: Array.from(el.children, nodeFromElement), __text: el.children.length ? undefined : (el.textContent ?? '') };
}

/** DASH SCTE-35 XML (urn:scte:scte35:2013:xml SpliceInfoSection ya da 2014:xml+bin Signal/Binary) → sinyal. */
export function signalFromXml(node: XmlNode, base: SignalBase): Scte35Signal | null {
    const binary = find(node, 'Binary');
    if (binary) {
        const bytes = decodeBytes(text(binary));
        return bytes ? signalFromBytes(bytes, base) : null;
    }
    const section = find(node, 'SpliceInfoSection');
    if (!section) return null;
    const ptsAdjustment = (num(attr(section, 'ptsAdjustment')) ?? 0) / 90000;
    const info: Scte35SpliceInfo = { protocolVersion: 0, sapType: 3, encrypted: false, ptsAdjustment, tier: num(attr(section, 'tier')) ?? 0xfff, commandType: 0, command: 'unknown', descriptors: [], crcValid: true };
    const insert = find(section, 'SpliceInsert');
    const signal = find(section, 'TimeSignal');
    const time = (n: XmlNode | undefined): number | null => {
        const st = n && find(n, 'SpliceTime');
        const pts = num(attr(st, 'ptsTime'));
        return pts === null ? null : (pts / 90000 + ptsAdjustment) % (PTS_WRAP / 90000);
    };
    if (insert) {
        const bd = find(insert, 'BreakDuration');
        info.commandType = 0x05;
        info.command = 'splice_insert';
        info.spliceInsert = {
            eventId: num(attr(insert, 'spliceEventId')) ?? 0,
            cancel: bool(attr(insert, 'spliceEventCancelIndicator')),
            outOfNetwork: bool(attr(insert, 'outOfNetworkIndicator')),
            programSplice: !find(insert, 'Component'),
            immediate: bool(attr(insert, 'spliceImmediateFlag')),
            spliceTime: time(insert),
            breakDuration: bd ? { autoReturn: bool(attr(bd, 'autoReturn')), seconds: (num(attr(bd, 'duration')) ?? 0) / 90000 } : null,
            uniqueProgramId: num(attr(insert, 'uniqueProgramId')) ?? 0,
            availNum: num(attr(insert, 'availNum')) ?? 0,
            availsExpected: num(attr(insert, 'availsExpected')) ?? 0,
        };
    } else if (signal) {
        info.commandType = 0x06;
        info.command = 'time_signal';
        info.timeSignal = { spliceTime: time(signal) };
    } else if (find(section, 'SpliceNull')) {
        info.command = 'splice_null';
    }
    const collect = (n: XmlNode): void => {
        if (localName(n) === 'SegmentationDescriptor') {
            const typeId = num(attr(n, 'segmentationTypeId'));
            const upidNode = find(n, 'SegmentationUpid');
            const cancel = bool(attr(n, 'segmentationEventCancelIndicator'));
            info.descriptors.push({
                eventId: num(attr(n, 'segmentationEventId')) ?? 0,
                cancel,
                typeId: cancel ? null : typeId,
                type: cancel || typeId === null ? null : (SEGMENTATION_TYPES[typeId] ?? `0x${typeId.toString(16)}`),
                duration: attr(n, 'segmentationDuration') !== undefined ? (num(attr(n, 'segmentationDuration')) ?? 0) / 90000 : null,
                upidType: num(attr(upidNode, 'segmentationUpidType')) ?? 0,
                upid: upidNode ? text(upidNode).trim() : '',
                segmentNum: num(attr(n, 'segmentNum')) ?? 0,
                segmentsExpected: num(attr(n, 'segmentsExpected')) ?? 0,
            });
            return;
        }
        for (const c of children(n)) collect(c);
    };
    collect(section);
    return signalFromInfo(info, base);
}

/** XML metni → sinyal (DOMParser). */
export function signalFromXmlText(xml: string, base: SignalBase): Scte35Signal | null {
    try {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) return null;
        return signalFromXml(nodeFromElement(doc.documentElement), base);
    } catch {
        return null;
    }
}
