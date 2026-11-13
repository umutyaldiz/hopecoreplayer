import type { SettingsSubmenuDef } from '../../controls/SettingsMenu';
import type { StreamAudioTrack } from '../../hls/SourceManager';
import type { AudioDescriptionOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface AudioDescriptionContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    i18n: HopeLocaleStrings;
    registerSubmenu(def: SettingsSubmenuDef): void;
    unregisterSubmenu(key: string): void;
    streamAudio(): { tracks: StreamAudioTrack[]; active: number };
    setAudioTrack(index: number): void;
}

const MENU = 'audio-description';
const STORE = 'hp-audio-description';
/** Anlatım dosyası videodan bu kadar kayarsa yeniden hizalanır (sn). */
const DRIFT = 0.25;

/**
 * Sesli betimleme. İki kaynak: yayının kendi betimleme ses izi (HLS CHARACTERISTICS describes-video, Safari
 * kind 'description') — açılınca o ize geçilir; ya da ayrı anlatım dosyası (`src`) — videoyla eş zamanlı çalar,
 * orijinal sesin üstüne karışır, ses düzeyi player'ı izler. İkisi de varsa yayının izi önceliklidir.
 * Tercih tarayıcıda saklanır; ayarlar menüsünde "Sesli betimleme: Açık / Kapalı".
 */
export class AudioDescription {
    private enabled: boolean;
    private audio: HTMLAudioElement | null = null;
    private syncTimer: ReturnType<typeof setInterval> | null = null;
    /** Betimlemeden önceki ses izi — kapatınca dönülür. */
    private previousTrack = -1;
    private source: 'stream' | 'file' | null = null;

    constructor(
        private readonly ctx: AudioDescriptionContext,
        private readonly options: AudioDescriptionOptions
    ) {
        let saved: string | null = null;
        try {
            saved = localStorage.getItem(STORE);
        } catch {
            /* depolama kapalı */
        }
        this.enabled = saved === null ? !!options.default : saved === '1';
        const v = ctx.videoEl;
        for (const ev of ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'volumechange', 'waiting', 'playing'] as const) v.addEventListener(ev, this.sync);
        v.addEventListener('emptied', this.onEmptied);
        this.apply();
    }

    refreshLabels(): void {
        this.registerMenu();
    }

    destroy(): void {
        const v = this.ctx.videoEl;
        for (const ev of ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'volumechange', 'waiting', 'playing'] as const) v.removeEventListener(ev, this.sync);
        v.removeEventListener('emptied', this.onEmptied);
        this.stopFile();
        this.ctx.unregisterSubmenu(MENU);
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(on: boolean): void {
        if (on === this.enabled) return;
        this.enabled = on;
        try {
            localStorage.setItem(STORE, on ? '1' : '0');
        } catch {
            /* depolama kapalı */
        }
        this.apply();
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:audiodescription', { detail: { enabled: on, source: on ? this.source : null } }));
    }

    /** Yayının ses izleri değişti (kaynak yüklendi / iz değişti). */
    onStreamTracks(): void {
        const { tracks, active } = this.ctx.streamAudio();
        const now = tracks.find((t) => t.index === active);
        const was = tracks.find((t) => t.index === this.lastActive);
        const byUs = this.pending === active;
        // Betimleme izine geçiş henüz gelmeden izleyici başka iz seçmiş olabilir.
        const wanted = this.pending !== null ? tracks.find((t) => t.index === this.pending) : undefined;
        this.pending = null;
        this.lastActive = active;
        // İzleyici ses menüsünden betimlemesiz ize geçti → betimleme kapanır (geri çevrilmez).
        if (this.enabled && !byUs && (was?.description || wanted?.description) && now && !now.description) {
            this.enabled = false;
            try {
                localStorage.setItem(STORE, '0');
            } catch {
                /* depolama kapalı */
            }
            this.registerMenu();
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:audiodescription', { detail: { enabled: false, source: null } }));
            return;
        }
        this.apply();
    }

    private lastActive = -1;
    /** Eklentinin istediği iz — kendi geçişini izleyicininkinden ayırmak için. */
    private pending: number | null = null;

    private switchTrack(index: number): void {
        this.pending = index;
        this.ctx.setAudioTrack(index);
    }

    private descTrack(): StreamAudioTrack | null {
        const { tracks, active } = this.ctx.streamAudio();
        const list = tracks.filter((t) => t.description);
        if (!list.length) return null;
        // Aynı dilde olanı tercih et.
        const lang = tracks.find((t) => t.index === active)?.lang;
        return list.find((t) => t.lang === lang) ?? list[0]!;
    }

    private apply(): void {
        const desc = this.descTrack();
        this.source = desc ? 'stream' : this.options.src ? 'file' : null;
        this.registerMenu();
        const { tracks, active } = this.ctx.streamAudio();
        const current = tracks.find((t) => t.index === active);

        if (this.source === 'stream') {
            this.stopFile();
            if (this.enabled && desc && !current?.description) {
                this.previousTrack = active;
                this.switchTrack(desc.index);
            } else if (!this.enabled && current?.description) {
                // Önceki iz, yoksa aynı dildeki betimlemesiz iz.
                const back = tracks.find((t) => t.index === this.previousTrack && !t.description) ?? tracks.find((t) => !t.description && t.lang === current.lang) ?? tracks.find((t) => !t.description);
                if (back) this.switchTrack(back.index);
            }
            return;
        }
        if (this.source === 'file' && this.enabled) this.startFile();
        else this.stopFile();
    }

    private registerMenu(): void {
        if (!this.source) {
            this.ctx.unregisterSubmenu(MENU);
            return;
        }
        const i18n = this.ctx.i18n;
        this.ctx.registerSubmenu({
            key: MENU,
            title: i18n.audioDescription,
            getValueLabel: () => (this.enabled ? i18n.audioDescriptionOn : i18n.audioDescriptionOff),
            getItems: () => [
                { label: i18n.audioDescriptionOff, active: !this.enabled, onSelect: () => this.setEnabled(false) },
                { label: i18n.audioDescriptionOn, active: this.enabled, onSelect: () => this.setEnabled(true) },
            ],
        });
    }

    // ── Ayrı anlatım dosyası ──

    private startFile(): void {
        if (this.audio || !this.options.src) return;
        const a = document.createElement('audio');
        a.preload = 'auto';
        a.src = this.options.src;
        a.setAttribute('data-hp-audio-description', '');
        a.hidden = true;
        // Shadow root içinde (gizli) — geliştirici araçlarında ve testte görünsün.
        (this.ctx.hostEl.shadowRoot ?? this.ctx.hostEl).appendChild(a);
        this.audio = a;
        a.addEventListener('loadedmetadata', this.sync);
        this.syncTimer = setInterval(this.sync, 1000);
        this.sync();
    }

    private stopFile(): void {
        if (this.syncTimer) clearInterval(this.syncTimer);
        this.syncTimer = null;
        if (!this.audio) return;
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.audio.remove();
        this.audio = null;
    }

    /** Anlatımı videoya bağla: oynat / duraklat, konum, hız, ses düzeyi. */
    private readonly sync = (): void => {
        const a = this.audio;
        if (!a) return;
        const v = this.ctx.videoEl;
        a.volume = Math.max(0, Math.min(1, v.volume * (this.options.volume ?? 1)));
        a.muted = v.muted;
        a.playbackRate = v.playbackRate || 1;
        if (a.readyState >= 1 && Math.abs(a.currentTime - v.currentTime) > DRIFT) {
            a.currentTime = Math.min(v.currentTime, Number.isFinite(a.duration) ? a.duration : v.currentTime);
        }
        // Video takılırken (waiting) ya da duraklayınca anlatım da durur.
        const playing = !v.paused && !v.seeking && v.readyState >= 3;
        if (playing && a.paused && (!Number.isFinite(a.duration) || v.currentTime < a.duration)) void a.play().catch(() => {});
        else if (!playing && !a.paused) a.pause();
    };

    private readonly onEmptied = (): void => {
        this.previousTrack = -1;
        if (this.audio) this.audio.currentTime = 0;
    };
}
