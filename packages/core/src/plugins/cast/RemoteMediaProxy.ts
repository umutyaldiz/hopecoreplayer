/** Uzak oynatıcıya (TV) giden komutlar. */
export interface RemoteCommands {
    play(): void;
    pause(): void;
    seek(time: number): void;
    setVolume(volume: number): void;
    setMuted(muted: boolean): void;
}

export interface RemoteState {
    paused: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    muted: boolean;
    ended: boolean;
}

const PROXIED = ['paused', 'currentTime', 'duration', 'ended', 'volume', 'muted', 'readyState', 'seeking', 'buffered', 'play', 'pause'] as const;
const EMPTY_RANGES: TimeRanges = {
    length: 0,
    start: () => {
        throw new DOMException('Index out of range', 'IndexSizeError');
    },
    end: () => {
        throw new DOMException('Index out of range', 'IndexSizeError');
    },
};
/** Seek bar sürüklenirken her harekette TV'ye istek gitmesin. */
const SEEK_DEBOUNCE_MS = 150;

/** <video>'nun gerçek (prototip) değeri — vekil kuruluyken de. */
export function nativeGet<K extends 'currentTime' | 'duration' | 'paused' | 'ended'>(video: HTMLVideoElement, key: K): HTMLMediaElement[K] {
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, key);
    return d!.get!.call(video) as HTMLMediaElement[K];
}

/**
 * Cast sırasında `<video>` örneğinin oynatma yüzeyini (paused, currentTime, play(), volume…) TV'ye bağlar ve TV'den
 * gelen durumu olay olarak (play / pause / timeupdate / volumechange…) yayar. Böylece kontrol çubuğu, seek bar,
 * klavye kısayolları ve eklentiler hiç değişmeden TV'yi yönetir. Kaldırılınca örnek özellikleri silinir, prototip
 * (gerçek video) geri gelir.
 */
export class RemoteMediaProxy {
    private state: RemoteState;
    private pendingSeek: number | null = null;
    private seekTimer: ReturnType<typeof setTimeout> | null = null;
    private installed = false;

    constructor(
        private readonly video: HTMLVideoElement,
        private readonly commands: RemoteCommands,
        initial: RemoteState
    ) {
        this.state = { ...initial };
    }

    get current(): Readonly<RemoteState> {
        return this.state;
    }

    install(): void {
        if (this.installed) return;
        this.installed = true;
        const v = this.video;
        const s = (): RemoteState => this.state;
        const define = (key: string, desc: PropertyDescriptor): void => {
            Object.defineProperty(v, key, { configurable: true, enumerable: false, ...desc });
        };
        define('paused', { get: () => s().paused });
        define('ended', { get: () => s().ended });
        define('duration', { get: () => s().duration });
        define('readyState', { get: () => 4 });
        define('seeking', { get: () => this.pendingSeek !== null });
        define('buffered', { get: () => EMPTY_RANGES });
        define('currentTime', {
            get: () => this.pendingSeek ?? s().currentTime,
            set: (t: number) => this.seek(t),
        });
        define('volume', {
            get: () => s().volume,
            set: (vol: number) => {
                const clamped = Math.min(1, Math.max(0, Number(vol) || 0));
                this.state.volume = clamped;
                this.commands.setVolume(clamped);
                this.fire('volumechange');
            },
        });
        define('muted', {
            get: () => s().muted,
            set: (m: boolean) => {
                this.state.muted = !!m;
                this.commands.setMuted(!!m);
                this.fire('volumechange');
            },
        });
        define('play', {
            value: () => {
                if (this.state.ended) this.seek(0);
                this.commands.play();
                return Promise.resolve();
            },
        });
        define('pause', { value: () => this.commands.pause() });
    }

    uninstall(): void {
        if (!this.installed) return;
        this.installed = false;
        if (this.seekTimer) clearTimeout(this.seekTimer);
        this.seekTimer = null;
        this.pendingSeek = null;
        for (const key of PROXIED) delete (this.video as unknown as Record<string, unknown>)[key];
    }

    /** TV'den gelen durum — değişen alanlar için olay yayar. */
    update(patch: Partial<RemoteState>): void {
        const prev = this.state;
        this.state = { ...prev, ...patch };
        const next = this.state;
        if (patch.duration !== undefined && patch.duration !== prev.duration) this.fire('durationchange');
        if (patch.currentTime !== undefined && patch.currentTime !== prev.currentTime && this.pendingSeek === null) this.fire('timeupdate');
        if (patch.volume !== undefined || patch.muted !== undefined) {
            if (next.volume !== prev.volume || next.muted !== prev.muted) this.fire('volumechange');
        }
        if (patch.paused !== undefined && patch.paused !== prev.paused) {
            if (next.paused) this.fire('pause');
            else {
                this.fire('play');
                this.fire('playing');
            }
        }
        if (patch.ended && !prev.ended) this.fire('ended');
    }

    private seek(t: number): void {
        const target = Math.max(0, Number(t) || 0);
        const first = this.pendingSeek === null;
        this.pendingSeek = target;
        if (first) this.fire('seeking');
        this.fire('timeupdate');
        if (this.seekTimer) clearTimeout(this.seekTimer);
        this.seekTimer = setTimeout(() => {
            this.seekTimer = null;
            const to = this.pendingSeek ?? target;
            this.commands.seek(to);
            this.state = { ...this.state, currentTime: to, ended: false };
            this.pendingSeek = null;
            this.fire('seeked');
            this.fire('timeupdate');
        }, SEEK_DEBOUNCE_MS);
    }

    private fire(type: string): void {
        this.video.dispatchEvent(new Event(type));
    }
}
