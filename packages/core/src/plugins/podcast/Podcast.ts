import type { PodcastOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import type { SettingsSubmenuDef } from '../../controls/SettingsMenu';
import { formatTime } from '../../utils/format-time';
import { mediaAudio } from '../../utils/media-audio';
import { adoptStyle } from '../../utils/plugin-style';
import { showToast } from '../shared/toast';
import css from './podcast.css?inline';
import { storageGet, storageSet } from '../../utils/storage';

export interface PodcastPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    seekBarEl: HTMLElement;
    i18n: HopeLocaleStrings;
    registerSubmenu(def: SettingsSubmenuDef): void;
    unregisterSubmenu(key: string): void;
    registerToggle(row: { key: string; label: string; getValueLabel(): string; onToggle(): void }): void;
    unregisterToggle(key: string): void;
    log(message: string): void;
}

const SLEEP_KEY = 'podcast-sleep';
const SILENCE_KEY = 'podcast-silence';
const SILENCE_STORE = 'hp-skip-silence';
const FADE_MS = 8000;
const MAX_WAVE_BYTES = 40 * 1024 * 1024;
/** Tek seferde en uzun hızlı geçiş (medya sn) — analiz takılırsa video kalıcı hızlı kalmasın. */
const MAX_FAST_MEDIA_S = 15;

/** WebKit (Safari, iOS'taki tüm tarayıcılar): hız değişince ses analizi veri vermeyi kesiyor — sessizlik algılanamaz. */
function isWebKit(): boolean {
    const ua = navigator.userAgent;
    return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
}

/** Tepe değerlerini 0–1'e ölçekler ve `bars` sayıya indirir. */
export function normalizePeaks(data: number[], bars: number): number[] {
    const clean = data.map((x) => (Number.isFinite(x) ? Math.abs(x) : 0));
    if (!clean.length) return [];
    const out: number[] = [];
    const n = Math.max(8, Math.min(bars, clean.length));
    for (let i = 0; i < n; i++) {
        const a = Math.floor((i / n) * clean.length);
        const b = Math.max(a + 1, Math.floor(((i + 1) / n) * clean.length));
        let m = 0;
        for (let j = a; j < b; j++) m = Math.max(m, clean[j]!);
        out.push(m);
    }
    const max = Math.max(...out) || 1;
    return out.map((x) => x / max);
}

/**
 * Podcast araçları: uyku zamanlayıcısı (ses yavaşça kısılıp durur), sessiz kısımları hızlı geçme (Web Audio ile ses
 * düzeyi dinlenir) ve seek bar'ın üstünde dalga formu.
 */
export class Podcast {
    private sleepAt: number | 'end' | null = null;
    private sleepTimer: ReturnType<typeof setTimeout> | null = null;
    private fadeTimer: ReturnType<typeof setInterval> | null = null;
    private stopNextPlayUntil = 0;
    private silenceOn = false;
    private analyser: AnalyserNode | null = null;
    private silencePoll: ReturnType<typeof setInterval> | null = null;
    private quietSince = 0;
    /** Gerçek ses duyuldu mu — hiç sinyal yoksa (ses çıkışı yok / analiz çalışmıyor) her şey sessiz sanılmasın. */
    private heard = false;
    private fast = false;
    private baseRate = 1;
    private ownRate = false;
    private saved = 0;
    private lastPoll = 0;
    private wave: HTMLElement | null = null;
    private destroyed = false;

    constructor(
        private readonly ctx: PodcastPlayerContext,
        private readonly options: PodcastOptions
    ) {
        adoptStyle(ctx.seekBarEl, 'podcast', css);
        const v = ctx.videoEl;
        v.addEventListener('ended', this.onEnded);
        v.addEventListener('play', this.onPlay);
        v.addEventListener('ratechange', this.onRate);
        v.addEventListener('timeupdate', this.renderWaveProgress);
        this.register();
        if (this.silenceOptions && this.restoreSilence()) {
            // Grafik ancak kaynak yüklenince kurulabilir (currentSrc gerekir).
            if (v.currentSrc) this.setSilence(true, false);
            else v.addEventListener('loadedmetadata', () => this.setSilence(true, false), { once: true });
        }
        void this.loadWaveform();
    }

    private get sleepMinutes(): number[] | null {
        const s = this.options.sleepTimer;
        if (s === false) return null;
        const list = typeof s === 'object' && s.minutes?.length ? s.minutes : [5, 15, 30, 45, 60];
        return list.filter((m) => m > 0);
    }

    private get silenceOptions(): { threshold: number; minDuration: number; rate: number; default: boolean } | null {
        const s = this.options.skipSilence;
        if (!s) return null;
        const o = typeof s === 'object' ? s : {};
        return { threshold: o.threshold ?? -45, minDuration: Math.max(0.2, o.minDuration ?? 0.5), rate: Math.min(4, Math.max(1.25, o.rate ?? 3)), default: !!o.default };
    }

    refreshLabels(): void {
        this.register();
    }

    destroy(): void {
        this.destroyed = true;
        this.clearSleep();
        this.setSilence(false, false);
        const v = this.ctx.videoEl;
        v.removeEventListener('ended', this.onEnded);
        v.removeEventListener('play', this.onPlay);
        v.removeEventListener('ratechange', this.onRate);
        v.removeEventListener('timeupdate', this.renderWaveProgress);
        this.ctx.unregisterSubmenu(SLEEP_KEY);
        this.ctx.unregisterToggle(SILENCE_KEY);
        this.wave?.remove();
        this.ctx.seekBarEl.removeAttribute('data-waveform');
    }

    private register(): void {
        const t = this.ctx.i18n;
        const minutes = this.sleepMinutes;
        if (minutes) {
            this.ctx.registerSubmenu({
                key: SLEEP_KEY,
                title: t.sleepTimer,
                getValueLabel: () => this.sleepLabel(),
                getItems: () => [
                    { label: t.sleepOff, active: this.sleepAt === null, onSelect: () => this.setSleep(null) },
                    ...minutes.map((m) => ({ label: t.sleepMinutes(m), active: false, onSelect: () => this.setSleep(m) })),
                    { label: t.sleepEndOfEpisode, active: this.sleepAt === 'end', onSelect: () => this.setSleep('end') },
                ],
            });
        }
        if (this.silenceOptions) {
            this.ctx.registerToggle({
                key: SILENCE_KEY,
                label: t.skipSilence,
                getValueLabel: () => (this.silenceOn ? (this.saved >= 1 ? `${t.skipSilenceOn} · −${formatTime(this.saved)}` : t.skipSilenceOn) : t.skipSilenceOff),
                onToggle: () => this.setSilence(!this.silenceOn, true),
            });
        }
    }

    // ── Uyku zamanlayıcısı ──

    private sleepLabel(): string {
        const t = this.ctx.i18n;
        if (this.sleepAt === null) return t.sleepOff;
        if (this.sleepAt === 'end') return t.sleepEndOfEpisode;
        return formatTime(Math.max(0, (this.sleepAt - Date.now()) / 1000));
    }

    /** Dakika, 'end' (bölüm sonunda) ya da null (kapat). */
    setSleep(value: number | 'end' | null): void {
        this.clearSleep();
        if (value === null) {
            this.sleepAt = null;
        } else if (value === 'end') {
            this.sleepAt = 'end';
        } else {
            this.sleepAt = Date.now() + value * 60_000;
            this.sleepTimer = setTimeout(() => this.fadeOut(), Math.max(0, value * 60_000 - FADE_MS));
        }
        if (value !== null) this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:podcast', { detail: { state: 'sleep', minutes: value } }));
    }

    private clearSleep(): void {
        if (this.sleepTimer) clearTimeout(this.sleepTimer);
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.sleepTimer = null;
        this.fadeTimer = null;
    }

    /** Ses yavaşça kısılır, durur, ses düzeyi eski haline döner. */
    private fadeOut(): void {
        const v = this.ctx.videoEl;
        const start = v.volume;
        const t0 = performance.now();
        this.fadeTimer = setInterval(() => {
            const k = Math.min(1, (performance.now() - t0) / FADE_MS);
            v.volume = Math.max(0, start * (1 - k));
            if (k >= 1) this.stopForSleep(start);
        }, 200);
    }

    private stopForSleep(volume?: number): void {
        this.clearSleep();
        const v = this.ctx.videoEl;
        v.pause();
        if (volume !== undefined) v.volume = volume;
        this.sleepAt = null;
        showToast(this.ctx.overlayEl, this.ctx.i18n.sleepStopped, 3000);
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:podcast', { detail: { state: 'sleepend' } }));
    }

    private readonly onEnded = (): void => {
        if (this.sleepAt !== 'end') return;
        // Çalma listesi sıradakine geçerse o da durdurulsun.
        this.stopNextPlayUntil = Date.now() + 4000;
        this.stopForSleep();
    };

    private readonly onPlay = (): void => {
        if (Date.now() < this.stopNextPlayUntil) {
            this.stopNextPlayUntil = 0;
            this.ctx.videoEl.pause();
        }
    };

    // ── Sessiz kısımları hızlı geç ──

    private restoreSilence(): boolean {
        try {
            const v = storageGet(SILENCE_STORE);
            if (v === '0' || v === '1') return v === '1';
        } catch {
            /* depolama kapalı */
        }
        return this.silenceOptions?.default ?? false;
    }

    setSilence(on: boolean, user: boolean): void {
        if (this.destroyed && on) return;
        if (on && !this.analyser) {
            const graph = isWebKit() ? null : mediaAudio(this.ctx.videoEl);
            if (!graph) {
                if (user) showToast(this.ctx.overlayEl, this.ctx.i18n.skipSilenceUnavailable, 3500);
                this.ctx.log('skipSilence: Web Audio is unavailable for this source (cross-origin without CORS).');
                return;
            }
            this.analyser = graph.ctx.createAnalyser();
            this.analyser.fftSize = 2048;
            graph.source.connect(this.analyser);
        }
        this.silenceOn = on;
        if (on) {
            this.lastPoll = performance.now();
            this.silencePoll ??= setInterval(this.poll, 100);
        } else {
            if (this.silencePoll) clearInterval(this.silencePoll);
            this.silencePoll = null;
            this.exitFast();
        }
        if (user) {
            try {
                storageSet(SILENCE_STORE, on ? '1' : '0');
            } catch {
                /* depolama kapalı */
            }
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:podcast', { detail: { state: 'silence', enabled: on, saved: Math.round(this.saved) } }));
        }
    }

    private buf: Float32Array<ArrayBuffer> | null = null;

    private readonly poll = (): void => {
        const a = this.analyser;
        const v = this.ctx.videoEl;
        const now = performance.now();
        const dt = (now - this.lastPoll) / 1000;
        this.lastPoll = now;
        if (!a || v.paused || v.seeking) {
            this.quietSince = 0;
            return this.exitFast();
        }
        if (this.fast) this.saved += (dt * (v.playbackRate - this.baseRate)) / (this.baseRate || 1);
        this.buf ??= new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(this.buf);
        let sum = 0;
        for (const x of this.buf) sum += x * x;
        const db = 20 * Math.log10(Math.sqrt(sum / this.buf.length) || 1e-8);
        const o = this.silenceOptions!;
        if (db < o.threshold) {
            this.quietSince ||= now;
            if (!this.fast && this.heard && now - this.quietSince >= o.minDuration * 1000) this.enterFast(o.rate);
            // Sigorta: çok uzun "sessizlik" analizin takıldığını gösterir — normal hıza dön, yeniden ses duyulana kadar bekle.
            else if (this.fast && v.currentTime - this.fastFrom > MAX_FAST_MEDIA_S) {
                this.heard = false;
                this.exitFast();
            }
        } else {
            this.heard = true;
            this.quietSince = 0;
            this.exitFast();
        }
    };

    private fastFrom = 0;

    private enterFast(rate: number): void {
        const v = this.ctx.videoEl;
        this.fastFrom = v.currentTime;
        this.baseRate = v.playbackRate;
        if (rate <= this.baseRate) return;
        this.fast = true;
        this.setRate(rate);
    }

    private exitFast(): void {
        if (!this.fast) return;
        this.fast = false;
        this.setRate(this.baseRate);
    }

    private setRate(rate: number): void {
        this.ownRate = true;
        this.ctx.videoEl.playbackRate = rate;
        // ratechange zaman uyumsuz gelir.
        setTimeout(() => (this.ownRate = false), 0);
    }

    /** Kullanıcı hızı değiştirirse yeni temel hız odur. */
    private readonly onRate = (): void => {
        if (this.ownRate) return;
        this.fast = false;
        this.baseRate = this.ctx.videoEl.playbackRate;
    };

    // ── Dalga formu ──

    private async loadWaveform(): Promise<void> {
        const w = this.options.waveform;
        if (!w) return;
        const o = typeof w === 'object' ? w : {};
        const bars = Math.max(20, Math.min(400, o.bars ?? 120));
        let data: number[] | null = o.data?.length ? o.data : null;
        try {
            if (!data && o.src) {
                const json = (await (await fetch(o.src)).json()) as unknown;
                const arr = Array.isArray(json) ? json : (json as { data?: unknown })?.data;
                if (Array.isArray(arr)) data = arr.map(Number);
            }
            if (!data && w === true) data = await this.decodePeaks(bars * 4);
        } catch (err) {
            this.ctx.log(`waveform could not be loaded: ${String(err)}`);
        }
        if (this.destroyed || !data?.length) return;
        this.drawWave(normalizePeaks(data, bars));
    }

    /** Ses dosyasını indirip çözer (CORS gerekir) — her dilimin en yüksek genliği. */
    private async decodePeaks(count: number): Promise<number[] | null> {
        const v = this.ctx.videoEl;
        if (!v.currentSrc) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
        const src = v.currentSrc;
        if (!src || src.startsWith('blob:') || typeof AudioContext === 'undefined') return null;
        const res = await fetch(src);
        const size = Number(res.headers.get('content-length') ?? 0);
        if (size > MAX_WAVE_BYTES) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_WAVE_BYTES) return null;
        const ac = new AudioContext();
        try {
            const audio = await ac.decodeAudioData(buf);
            const ch = audio.getChannelData(0);
            const step = Math.max(1, Math.floor(ch.length / count));
            const out: number[] = [];
            for (let i = 0; i < ch.length; i += step) {
                let m = 0;
                for (let j = i; j < Math.min(ch.length, i + step); j += 16) m = Math.max(m, Math.abs(ch[j]!));
                out.push(m);
            }
            return out;
        } finally {
            void ac.close();
        }
    }

    private drawWave(peaks: number[]): void {
        const n = peaks.length;
        const svg = (cls: string): string =>
            `<svg class="${cls}" viewBox="0 0 ${n} 100" preserveAspectRatio="none" aria-hidden="true">${peaks
                .map((p, i) => {
                    const h = Math.max(6, p * 100);
                    return `<rect x="${i + 0.15}" y="${(100 - h) / 2}" width="0.7" height="${h}" rx="0.3"/>`;
                })
                .join('')}</svg>`;
        const el = document.createElement('div');
        el.className = 'hp-waveform';
        el.setAttribute('part', 'waveform');
        // Yalnızca sayılardan üretilen SVG — dış metin yok.
        el.innerHTML = svg('hp-waveform-base') + svg('hp-waveform-played');
        this.ctx.seekBarEl.prepend(el);
        this.ctx.seekBarEl.setAttribute('data-waveform', '');
        this.wave = el;
        this.renderWaveProgress();
    }

    private readonly renderWaveProgress = (): void => {
        const v = this.ctx.videoEl;
        if (!this.wave || !Number.isFinite(v.duration) || !v.duration) return;
        this.wave.style.setProperty('--hp-wave-p', `${(v.currentTime / v.duration) * 100}%`);
    };
}
