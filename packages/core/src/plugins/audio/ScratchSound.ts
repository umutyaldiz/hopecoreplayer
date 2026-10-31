/**
 * Plak scratch sesi (options.audio.vinyl.scratchSound). `<audio>/<video>` geriye çalamaz ve sarma sırasında ses vermez;
 * bu yüzden scratch boyunca ses Web Audio ile üretilir: dosya bir kez ham sese çözülür, bir AudioWorklet bu sesi
 * parmağın gösterdiği konuma doğru (ileri / geri, yavaş / hızlı) okur — parmak durunca okuma da durur, ses kesilir.
 *
 * Konum güdümlü: işlemciye hız değil hedef konum verilir; okuma kafası hedefe kısa bir gecikmeyle (yay gibi) yaklaşır.
 * Böylece ses ile plağın açısı hiçbir zaman birbirinden kaymaz ve hız değişimleri yumuşak duyulur.
 *
 * Desteklenmeyen durumlarda (HLS / MediaSource, çok uzun dosya, CORS izni yok, AudioWorklet yok) `prepare()` false
 * döner ve scratch eskisi gibi sessiz çalışır.
 */

/** Bundan uzun dosyalar çözülmez — çözülmüş ses dakikada ~10 MB yer kaplar. */
export const SCRATCH_SOUND_MAX_SECONDS = 15 * 60;
const FADE_SECONDS = 0.015;

const WORKLET_SOURCE = `
class HopeScratchProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.channels = null;
        this.length = 0;
        this.ratio = 1;
        this.pos = 0;
        this.target = 0;
        this.rate = 0;
        this.active = false;
        this.blocks = 0;
        this.port.onmessage = (e) => {
            const d = e.data;
            if (d.type === 'buffer') {
                this.channels = d.channels;
                this.length = d.channels[0].length;
                this.ratio = d.sampleRate / sampleRate;
            } else if (d.type === 'start') {
                this.pos = this.target = d.position * (this.ratio * sampleRate);
                this.rate = 0;
                this.active = true;
            } else if (d.type === 'target') {
                this.target = Math.max(0, Math.min(this.length - 1, d.position * (this.ratio * sampleRate)));
            } else if (d.type === 'stop') {
                this.active = false;
            }
        };
    }
    process(inputs, outputs) {
        const out = outputs[0];
        const frames = out[0].length;
        if (!this.active || !this.channels) {
            for (const ch of out) ch.fill(0);
            return true;
        }
        const src = this.channels;
        const last = this.length - 1;
        // Okuma kafası hedefe ~25 ms'lik bir gecikmeyle yaklaşır; hız değişimi ~5 ms'de yumuşatılır.
        const lag = 0.025 * sampleRate;
        const smooth = 1 / (0.005 * sampleRate);
        const maxRate = 8 * this.ratio;
        for (let i = 0; i < frames; i++) {
            let want = (this.target - this.pos) / lag;
            if (want > maxRate) want = maxRate;
            else if (want < -maxRate) want = -maxRate;
            this.rate += (want - this.rate) * smooth;
            const p = this.pos;
            const i0 = p | 0;
            const f = p - i0;
            const i1 = i0 < last ? i0 + 1 : last;
            for (let c = 0; c < out.length; c++) {
                const ch = src[c < src.length ? c : src.length - 1];
                out[c][i] = ch[i0] + (ch[i1] - ch[i0]) * f;
            }
            let next = p + this.rate;
            if (next < 0) next = 0;
            else if (next > last) next = last;
            this.pos = next;
        }
        if (++this.blocks % 8 === 0) this.port.postMessage({ type: 'position', position: this.pos / (this.ratio * sampleRate) });
        return true;
    }
}
registerProcessor('hope-scratch', HopeScratchProcessor);
`;

type State = 'idle' | 'loading' | 'ready' | 'unsupported';

export class ScratchSound {
    private ctx: AudioContext | null = null;
    private node: AudioWorkletNode | null = null;
    private gain: GainNode | null = null;
    private loadedSrc = '';
    private loading: Promise<boolean> | null = null;
    private unsupportedSrc = '';
    private playing = false;
    /** İşlemcinin bildirdiği son okuma konumu (sn) — teşhis / test için. */
    lastPosition = 0;
    onStateChange: ((state: State) => void) | null = null;

    constructor(private readonly video: HTMLMediaElement) {}

    static isSupported(): boolean {
        return typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && 'audioWorklet' in AudioContext.prototype;
    }

    /** Şu anki kaynak hazır mı (çözüldü + işlemci kuruldu)? */
    get ready(): boolean {
        return !!this.node && this.loadedSrc === this.currentSrc();
    }

    private currentSrc(): string {
        return this.video.currentSrc || '';
    }

    /**
     * Kaynağı çözer ve işlemciyi kurar (kaynak başına bir kez). Kullanıcı etkileşimi gerektirmez — çalma başlayınca
     * boşta çağrılır ki ilk scratch'te gecikme olmasın.
     */
    prepare(): Promise<boolean> {
        const src = this.currentSrc();
        if (this.ready) return Promise.resolve(true);
        if (!src || src === this.unsupportedSrc) return Promise.resolve(false);
        if (this.loading) return this.loading;
        this.loading = this.load(src)
            .then((ok) => {
                if (!ok) this.unsupportedSrc = src;
                this.onStateChange?.(ok ? 'ready' : 'unsupported');
                return ok;
            })
            .finally(() => {
                this.loading = null;
            });
        this.onStateChange?.('loading');
        return this.loading;
    }

    private async load(src: string): Promise<boolean> {
        // HLS (MediaSource / blob:) parça parça gelir — tek dosya olarak çözülemez.
        if (!ScratchSound.isSupported() || src.startsWith('blob:') || /\.m3u8(\?|#|$)/i.test(src)) return false;
        const duration = this.video.duration;
        if (!Number.isFinite(duration) || duration <= 0 || duration > SCRATCH_SOUND_MAX_SECONDS) return false;
        try {
            this.ctx ??= new AudioContext({ latencyHint: 'interactive' });
            const ctx = this.ctx;
            if (!this.node) {
                const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
                try {
                    await ctx.audioWorklet.addModule(url);
                } finally {
                    URL.revokeObjectURL(url);
                }
            }
            // Başka sunucudaki dosya için o sunucunun CORS izni gerekir; yoksa fetch reddedilir.
            const res = await fetch(src, { credentials: 'same-origin' });
            if (!res.ok) return false;
            const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
            if (src !== this.currentSrc()) return false; // çözülürken kaynak değişti
            if (!this.node) {
                this.gain = ctx.createGain();
                this.gain.gain.value = 0;
                this.gain.connect(ctx.destination);
                this.node = new AudioWorkletNode(ctx, 'hope-scratch', { numberOfInputs: 0, outputChannelCount: [Math.min(2, buffer.numberOfChannels)] });
                this.node.port.onmessage = (e: MessageEvent<{ type: string; position: number }>) => {
                    if (e.data.type === 'position') this.lastPosition = e.data.position;
                };
                this.node.connect(this.gain);
            }
            const channels: Float32Array[] = [];
            for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c).slice());
            this.node.port.postMessage({ type: 'buffer', channels, sampleRate: buffer.sampleRate }, channels.map((ch) => ch.buffer));
            this.loadedSrc = src;
            return true;
        } catch {
            return false;
        }
    }

    /** Plak tutuldu. Kullanıcı etkileşimi (pointerdown) içinde çağrılmalı — AudioContext'i başlatır. */
    start(position: number): void {
        if (!this.ready || !this.ctx || !this.node || !this.gain) return;
        void this.ctx.resume().catch(() => {});
        const volume = this.video.muted ? 0 : this.video.volume;
        const now = this.ctx.currentTime;
        this.gain.gain.cancelScheduledValues(now);
        this.gain.gain.setValueAtTime(0, now);
        this.gain.gain.linearRampToValueAtTime(volume, now + FADE_SECONDS);
        this.node.port.postMessage({ type: 'start', position });
        this.lastPosition = position;
        this.playing = true;
    }

    /** Parmağın gösterdiği konum (sn). */
    setTarget(position: number): void {
        if (!this.playing || !this.node) return;
        this.node.port.postMessage({ type: 'target', position });
    }

    /** Plak bırakıldı: kısa bir sönümle sus (çıtırtı olmasın). */
    stop(): void {
        if (!this.playing || !this.ctx || !this.node || !this.gain) return;
        this.playing = false;
        const now = this.ctx.currentTime;
        this.gain.gain.cancelScheduledValues(now);
        this.gain.gain.setValueAtTime(this.gain.gain.value, now);
        this.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
        const node = this.node;
        // Sönüm bitince işlemciyi durdur — o arada plak yeniden tutulduysa (hızlı tut-bırak-tut) yeni scratch'i kesme.
        setTimeout(() => {
            if (!this.playing) node.port.postMessage({ type: 'stop' });
        }, FADE_SECONDS * 1000 + 10);
    }

    get active(): boolean {
        return this.playing;
    }

    destroy(): void {
        this.playing = false;
        this.node?.disconnect();
        this.gain?.disconnect();
        this.node = null;
        this.gain = null;
        void this.ctx?.close().catch(() => {});
        this.ctx = null;
    }
}
