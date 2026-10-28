/** SCTE-35 sinyal ayrıştırma + canlı yayın reklam yöneticisi. */

export interface Scte35Signal {
    type: 'out' | 'in' | 'cancel';
    spliceEventId?: number;
    duration?: number | null;
    breakDuration?: { autoReturn: number; seconds: number } | null;
    programSplice?: boolean;
    class?: string | null;
    raw?: string;
}

/** Base64 encoded SCTE-35 binary verisini parse eder — yalnızca splice_insert (0x05) komutlarını destekler. */
export function parseScte35Base64(base64: string): Scte35Signal | null {
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        if (bytes[0] !== 0xfc) return null; // table_id

        const spliceCommandType = bytes[13];
        if (spliceCommandType !== 0x05) return null; // yalnızca splice_insert

        const spliceEventId = ((bytes[14]! << 24) | (bytes[15]! << 16) | (bytes[16]! << 8) | bytes[17]!) >>> 0;

        const cancelIndicator = (bytes[18]! >> 7) & 0x01;
        if (cancelIndicator) return { type: 'cancel', spliceEventId };

        const outOfNetwork = (bytes[19]! >> 7) & 0x01;
        const programSplice = (bytes[19]! >> 6) & 0x01;
        const durationFlag = (bytes[19]! >> 5) & 0x01;

        let breakDuration: Scte35Signal['breakDuration'] = null;

        if (programSplice) {
            let offset = 20;
            const timeSpecified = (bytes[offset]! >> 7) & 0x01;
            offset += timeSpecified ? 5 : 1;

            if (durationFlag) {
                const autoReturn = (bytes[offset]! >> 7) & 0x01;
                const durationHigh = bytes[offset]! & 0x01;
                const duration =
                    durationHigh * Math.pow(2, 32) +
                    bytes[offset + 1]! * Math.pow(2, 24) +
                    bytes[offset + 2]! * Math.pow(2, 16) +
                    bytes[offset + 3]! * Math.pow(2, 8) +
                    bytes[offset + 4]!;
                breakDuration = { autoReturn, seconds: duration / 90000 };
            }
        }

        return { type: outOfNetwork ? 'out' : 'in', spliceEventId, breakDuration, programSplice: !!programSplice };
    } catch {
        return null;
    }
}

/** HLS manifest/segment'teki EXT-X-CUE-OUT/IN, EXT-X-DATERANGE, EXT-OATCLS-SCTE35 tag'lerini parse eder. */
export function parseHlsScteTag(tagName: string, tagValue: string): Scte35Signal | null {
    if (tagName === 'EXT-X-CUE-OUT') {
        return { type: 'out', duration: parseFloat(tagValue) || null };
    }
    if (tagName === 'EXT-X-CUE-IN') {
        return { type: 'in' };
    }
    if (tagName === 'EXT-X-DATERANGE') {
        const scteOut = tagValue.match(/SCTE35-OUT=0x([0-9A-Fa-f]+)/);
        const scteIn = tagValue.match(/SCTE35-IN=0x([0-9A-Fa-f]+)/);
        const duration = tagValue.match(/PLANNED-DURATION=([\d.]+)/);
        const classAttr = tagValue.match(/CLASS="([^"]+)"/);

        if (scteOut) {
            return { type: 'out', duration: duration ? parseFloat(duration[1]!) : null, class: classAttr ? classAttr[1]! : null, raw: scteOut[1]! };
        }
        if (scteIn) return { type: 'in', raw: scteIn[1]! };
    }
    if (tagName === 'EXT-OATCLS-SCTE35') {
        return parseScte35Base64(tagValue);
    }
    return null;
}

export interface Scte35ManagerCallbacks {
    onAdBreakStart(duration: number | null): void;
    onAdBreakEnd(): void;
}

/** textTracks metadata cue'larından SCTE-35 sinyallerini dinler (hls.js ve Safari native HLS). */
export class Scte35LiveAdManager {
    private inAdBreak = false;
    private adBreakTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly processedEventIds = new Set<number>();
    private readonly trackListeners = new Map<TextTrack, () => void>();

    constructor(
        private readonly videoEl: HTMLVideoElement,
        private readonly callbacks: Scte35ManagerCallbacks
    ) {
        this.attachExistingTracks();
        videoEl.textTracks.addEventListener('addtrack', this.onAddTrack);
    }

    destroy(): void {
        this.videoEl.textTracks.removeEventListener('addtrack', this.onAddTrack);
        for (const [track, listener] of this.trackListeners) {
            track.removeEventListener('cuechange', listener);
        }
        this.trackListeners.clear();
        if (this.adBreakTimer) clearTimeout(this.adBreakTimer);
        this.processedEventIds.clear();
    }

    private readonly onAddTrack = (e: TrackEvent): void => {
        if (e.track instanceof TextTrack) this.listenTrack(e.track);
    };

    private attachExistingTracks(): void {
        for (let i = 0; i < this.videoEl.textTracks.length; i++) {
            this.listenTrack(this.videoEl.textTracks[i]!);
        }
    }

    private listenTrack(track: TextTrack): void {
        if (track.kind !== 'metadata' || this.trackListeners.has(track)) return;
        track.mode = 'hidden'; // cue'lar işlensin diye aktif olmalı ama görünmesin.

        const listener = () => {
            const cues = track.activeCues;
            if (!cues) return;
            for (let i = 0; i < cues.length; i++) this.processCue(cues[i]!);
        };
        track.addEventListener('cuechange', listener);
        this.trackListeners.set(track, listener);
    }

    private processCue(cue: TextTrackCue): void {
        const anyCue = cue as unknown as { value?: { key?: string; data?: string; value?: string }; text?: string };
        let tagName: string | null = null;
        let tagValue = '';

        if (anyCue.value && typeof anyCue.value === 'object') {
            tagName = anyCue.value.key ?? null;
            tagValue = anyCue.value.data ?? anyCue.value.value ?? '';
        } else if (typeof anyCue.text === 'string') {
            const match = anyCue.text.match(/^(EXT[^:]+):?(.*)$/);
            if (match) {
                tagName = match[1]!;
                tagValue = match[2] ?? '';
            }
        }

        if (!tagName) return;
        const signal = parseHlsScteTag(tagName, tagValue);
        if (signal) this.handleSignal(signal);
    }

    private handleSignal(signal: Scte35Signal): void {
        if (signal.spliceEventId !== undefined) {
            if (this.processedEventIds.has(signal.spliceEventId)) return;
            this.processedEventIds.add(signal.spliceEventId);
            setTimeout(() => this.processedEventIds.delete(signal.spliceEventId!), 5 * 60 * 1000);
        }

        if (signal.type === 'cancel') {
            this.endAdBreak(true);
            return;
        }
        if (signal.type === 'out' && !this.inAdBreak) {
            this.startAdBreak(signal.breakDuration?.seconds ?? signal.duration ?? null);
        } else if (signal.type === 'in' && this.inAdBreak) {
            this.endAdBreak(false);
        }
    }

    private startAdBreak(duration: number | null): void {
        if (this.inAdBreak) return;
        this.inAdBreak = true;
        this.callbacks.onAdBreakStart(duration);

        if (duration && duration > 0) {
            this.adBreakTimer = setTimeout(() => {
                if (this.inAdBreak) this.endAdBreak(true);
            }, (duration + 5) * 1000);
        }
    }

    endAdBreak(_forced = false): void {
        if (!this.inAdBreak) return;
        this.inAdBreak = false;
        if (this.adBreakTimer) {
            clearTimeout(this.adBreakTimer);
            this.adBreakTimer = null;
        }
        this.callbacks.onAdBreakEnd();
    }
}
