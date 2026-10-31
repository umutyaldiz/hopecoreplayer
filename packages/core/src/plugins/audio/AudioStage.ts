import type { AudioOptions, VinylOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { createDisc, createTonearm } from './vinylSvg';
import type { ScratchSound } from './ScratchSound';

export interface AudioStageContext {
    videoEl: HTMLVideoElement;
    /** Sahnenin ekleneceği katman (video ile reklam katmanı arasında). */
    layerEl: HTMLElement;
    /** Kapak verilmezse kullanılan görsel (options.poster). */
    poster(): string | undefined;
    /** Player'ın oynat / duraklat yolu (preroll kapısına uyar). */
    togglePlay(): void;
    play(): void;
    i18n: HopeLocaleStrings;
}

const DEFAULT_SIZE = 0.78;
const DEFAULT_RPM = 100 / 3;
/** Bu kadar dereceden az çevirme "dokunuş" sayılır: oynat / duraklat. */
const TAP_DEGREES = 4;
/** Bundan kısa, çevirmesiz basış "dokunuş"tur (oynat / duraklat); daha uzunu "tutuş" (bırakınca çalmaya devam). */
const TAP_MS = 250;
const MEDIA_SESSION_SEEK_SECONDS = 10;

type ResolvedVinyl = Required<VinylOptions>;

function resolveVinyl(v: AudioOptions['vinyl']): ResolvedVinyl | null {
    if (v === false) return null;
    const o = v === true || v === undefined ? {} : v;
    const size = typeof o.size === 'number' && Number.isFinite(o.size) ? Math.min(1, Math.max(0.3, o.size)) : DEFAULT_SIZE;
    const rpm = typeof o.rpm === 'number' && o.rpm > 0 ? o.rpm : DEFAULT_RPM;
    return {
        position: o.position === 'center' || o.position === 'left' ? o.position : 'right',
        size,
        rpm,
        scratch: o.scratch !== false,
        scratchSound: o.scratchSound === true,
        tonearm: o.tonearm !== false,
    };
}

/** -180..180 aralığına indirger (açı farkı). */
function wrapDegrees(d: number): number {
    return ((((d + 180) % 360) + 360) % 360) - 180;
}

/**
 * Ses modunun sahnesi: bulanık kapak zemini, kapak (plak kılıfı), dönen plak, pikap kolu, başlık / sanatçı.
 * Plağın açısı doğrudan çalma zamanından hesaplanır (açı = zaman / tur süresi × 360): sarınca, atlayınca, scratch
 * yapınca plak her zaman sesle aynı yerde durur.
 */
export class AudioStage {
    readonly el: HTMLDivElement;
    private readonly backdropImg: HTMLImageElement;
    private readonly sleeve: HTMLDivElement;
    private readonly sleeveImg: HTMLImageElement;
    private readonly vinylEl: HTMLDivElement;
    private readonly discEl: HTMLDivElement;
    private readonly armHolder: HTMLDivElement;
    private readonly titleEl: HTMLDivElement;
    private readonly artistEl: HTMLDivElement;
    private readonly disc: ReturnType<typeof createDisc>;

    private options: AudioOptions = {};
    private vinyl: ResolvedVinyl | null = null;
    private frame = 0;
    private lastAriaSecond = -1;
    private lastPositionState = 0;

    // Scratch durumu
    private dragging = false;
    private dragPointer = -1;
    private center = { x: 0, y: 0 };
    private lastPointerAngle = 0;
    private accum = 0;
    private dragStartTime = 0;
    private dragStartAngle = 0;
    private moved = false;
    private wasPlaying = false;
    private downAt = 0;
    private seekFrame = 0;
    private pendingSeek: number | null = null;
    /** vinyl.scratchSound — ayrı parça olarak yalnızca açıksa yüklenir. */
    private sound: ScratchSound | null = null;
    private soundImport: Promise<ScratchSound | null> | null = null;
    private prepareTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly ctx: AudioStageContext) {
        const el = document.createElement('div');
        el.className = 'hp-audio';
        el.setAttribute('part', 'audio-stage');
        el.innerHTML = `
            <div class="hp-audio-backdrop"><img alt="" decoding="async"></div>
            <div class="hp-audio-meta"><div class="hp-audio-title" part="audio-title"></div><div class="hp-audio-artist" part="audio-artist"></div></div>
            <div class="hp-audio-area">
                <div class="hp-audio-deck">
                    <div class="hp-audio-sleeve" part="audio-cover"><img alt="" decoding="async"></div>
                    <div class="hp-vinyl" part="vinyl" role="slider" tabindex="-1" aria-valuemin="0">
                        <div class="hp-vinyl-disc"></div>
                        <div class="hp-vinyl-sheen"></div>
                        <div class="hp-tonearm-holder"><div class="hp-tonearm"></div></div>
                    </div>
                </div>
            </div>`;
        this.el = el;
        this.backdropImg = el.querySelector('.hp-audio-backdrop img')!;
        this.sleeve = el.querySelector('.hp-audio-sleeve')!;
        this.sleeveImg = this.sleeve.querySelector('img')!;
        this.vinylEl = el.querySelector('.hp-vinyl')!;
        this.discEl = el.querySelector('.hp-vinyl-disc')!;
        this.armHolder = el.querySelector('.hp-tonearm-holder')!;
        this.titleEl = el.querySelector('.hp-audio-title')!;
        this.artistEl = el.querySelector('.hp-audio-artist')!;
        this.disc = createDisc();
        this.discEl.appendChild(this.disc.el);
        el.querySelector('.hp-tonearm')!.appendChild(createTonearm());
        // Kırık kapak bağlantısı: görseli gizle, zemin temaya düşsün.
        for (const img of [this.backdropImg, this.sleeveImg]) {
            img.addEventListener('error', () => img.removeAttribute('src'));
        }

        const v = ctx.videoEl;
        v.addEventListener('play', this.onPlay);
        v.addEventListener('pause', this.onPause);
        v.addEventListener('ended', this.onPause);
        v.addEventListener('seeked', this.render);
        v.addEventListener('timeupdate', this.onTimeUpdate);
        v.addEventListener('durationchange', this.onDurationChange);
        v.addEventListener('ratechange', this.updatePositionState);
        v.addEventListener('emptied', this.render);

        this.vinylEl.addEventListener('pointerdown', this.onPointerDown);
        this.vinylEl.addEventListener('pointermove', this.onPointerMove);
        this.vinylEl.addEventListener('pointerup', this.onPointerUp);
        this.vinylEl.addEventListener('pointercancel', this.onPointerUp);
        this.vinylEl.addEventListener('lostpointercapture', this.onPointerUp);
        // Plağa tık / dokunuş videonun "boş alana tık" işleyicilerine düşmesin (oynat/duraklat'ı kendimiz yapıyoruz).
        for (const type of ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick'] as const) {
            this.vinylEl.addEventListener(type, (e) => e.stopPropagation());
        }

        // Videonun hemen üstü: yükleme halkası ve reklam katmanı sahnenin üstünde kalır.
        ctx.layerEl.insertBefore(el, ctx.videoEl.nextSibling);
        this.refreshLabels();
    }

    update(options: AudioOptions): void {
        this.options = options;
        this.vinyl = resolveVinyl(options.vinyl);
        const cover = options.cover || this.ctx.poster() || '';
        for (const img of [this.backdropImg, this.sleeveImg]) {
            if (cover) img.src = cover;
            else img.removeAttribute('src');
        }
        this.el.toggleAttribute('data-cover', !!cover);
        this.titleEl.textContent = options.title ?? '';
        this.artistEl.textContent = [options.artist, options.album].filter(Boolean).join(' · ');
        this.el.toggleAttribute('data-meta', !!(options.title || options.artist || options.album));

        const vinyl = this.vinyl;
        this.el.setAttribute('data-position', vinyl ? vinyl.position : 'none');
        this.el.style.setProperty('--hp-vinyl-size', String(vinyl?.size ?? DEFAULT_SIZE));
        this.vinylEl.hidden = !vinyl;
        // 'center': kılıf yok. Plak kapalıysa yalnızca kapak. Etikette her zaman kapak (yoksa düz renk + başlık).
        this.sleeve.hidden = !!vinyl && vinyl.position === 'center';
        this.disc.setLabel(cover || null, options.title || 'HopeCore');
        this.armHolder.hidden = !vinyl?.tonearm;
        this.vinylEl.toggleAttribute('data-scratch', !!vinyl?.scratch);
        this.vinylEl.tabIndex = vinyl ? 0 : -1;

        if (!vinyl?.scratchSound) this.disableSound();
        else if (!this.ctx.videoEl.paused) this.schedulePrepareSound();

        this.applyMediaSession();
        this.onDurationChange();
        this.render();
        if (!this.ctx.videoEl.paused) this.onPlay();
    }

    // ── Scratch sesi ────────────────────────────────────────────────────

    private loadSound(): Promise<ScratchSound | null> {
        if (this.sound) return Promise.resolve(this.sound);
        this.soundImport ??= import('./ScratchSound')
            .then(({ ScratchSound }) => {
                if (!this.vinyl?.scratchSound || !ScratchSound.isSupported()) {
                    this.el.setAttribute('data-scratch-sound', 'unsupported');
                    return null;
                }
                this.sound ??= new ScratchSound(this.ctx.videoEl);
                this.sound.onStateChange = (state) => this.el.setAttribute('data-scratch-sound', state);
                return this.sound;
            })
            .catch(() => null)
            .finally(() => {
                this.soundImport = null;
            });
        return this.soundImport;
    }

    /** Çalma başlayınca, boşta: sesi önceden çöz ki ilk scratch gecikmesin. */
    private schedulePrepareSound(): void {
        if (!this.vinyl?.scratchSound || this.prepareTimer || this.sound?.ready) return;
        this.prepareTimer = setTimeout(() => {
            this.prepareTimer = null;
            const run = () => void this.loadSound().then((s) => s?.prepare());
            if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2000 });
            else run();
        }, 300);
    }

    private disableSound(): void {
        if (this.prepareTimer) clearTimeout(this.prepareTimer);
        this.prepareTimer = null;
        this.sound?.destroy();
        this.sound = null;
        this.el.removeAttribute('data-scratch-sound');
    }

    refreshLabels(): void {
        this.vinylEl.setAttribute('aria-label', this.ctx.i18n.audioVinyl);
    }

    // ── Dönüş ────────────────────────────────────────────────────────────

    private get secondsPerTurn(): number {
        return 60 / (this.vinyl?.rpm ?? DEFAULT_RPM);
    }

    private angleForTime(t: number): number {
        return ((t / this.secondsPerTurn) * 360) % 360;
    }

    private readonly render = (): void => {
        if (!this.vinyl || this.dragging) return;
        this.discEl.style.transform = `rotate(${this.angleForTime(this.ctx.videoEl.currentTime || 0)}deg)`;
    };

    private readonly loop = (): void => {
        this.render();
        this.frame = requestAnimationFrame(this.loop);
    };

    private readonly onPlay = (): void => {
        this.el.setAttribute('data-playing', '');
        this.schedulePrepareSound();
        cancelAnimationFrame(this.frame);
        if (this.vinyl) this.frame = requestAnimationFrame(this.loop);
        if (this.options.mediaSession !== false && 'mediaSession' in navigator) {
            // Sayfada birden fazla player varsa son çalan sistemin medya kontrollerini alır.
            this.applyMediaSession();
            navigator.mediaSession.playbackState = 'playing';
        }
    };

    private readonly onPause = (): void => {
        // Scratch sırasında plak elde tutuluyor — pikap kolu kalkmasın.
        if (!this.dragging) this.el.removeAttribute('data-playing');
        cancelAnimationFrame(this.frame);
        this.render();
        if (this.ownsMediaSession()) navigator.mediaSession.playbackState = 'paused';
    };

    private readonly onTimeUpdate = (): void => {
        const v = this.ctx.videoEl;
        if (v.paused) this.render();
        const second = Math.floor(v.currentTime || 0);
        if (second !== this.lastAriaSecond) {
            this.lastAriaSecond = second;
            this.vinylEl.setAttribute('aria-valuenow', String(second));
        }
        const now = performance.now();
        if (now - this.lastPositionState > 1000) this.updatePositionState();
    };

    private readonly onDurationChange = (): void => {
        const d = this.ctx.videoEl.duration;
        const finite = Number.isFinite(d) && d > 0;
        if (finite) this.vinylEl.setAttribute('aria-valuemax', String(Math.floor(d)));
        else this.vinylEl.removeAttribute('aria-valuemax');
        // Canlı yayında (süre sonsuz) sarma yok — plak yalnızca döner.
        this.vinylEl.toggleAttribute('data-live', !finite && d === Infinity);
        this.updatePositionState();
    };

    // ── Scratch ──────────────────────────────────────────────────────────

    private canScratch(): boolean {
        const d = this.ctx.videoEl.duration;
        return !!this.vinyl?.scratch && Number.isFinite(d) && d > 0;
    }

    private pointerAngle(e: PointerEvent): number {
        return (Math.atan2(e.clientY - this.center.y, e.clientX - this.center.x) * 180) / Math.PI;
    }

    private readonly onPointerDown = (e: PointerEvent): void => {
        if (!this.vinyl || this.dragging) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const rect = this.vinylEl.getBoundingClientRect();
        this.center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        this.dragging = true;
        this.dragPointer = e.pointerId;
        this.lastPointerAngle = this.pointerAngle(e);
        this.accum = 0;
        this.moved = false;
        this.dragStartTime = this.ctx.videoEl.currentTime || 0;
        this.dragStartAngle = this.angleForTime(this.dragStartTime);
        this.wasPlaying = !this.ctx.videoEl.paused;
        this.downAt = performance.now();
        // Gerçek plak gibi: elle tutulan plak anında susar (çevirmeye başlamayı beklemeden).
        if (this.wasPlaying && this.canScratch()) this.ctx.videoEl.pause();
        if (this.vinyl.scratchSound && this.canScratch()) {
            // AudioContext yalnızca kullanıcı etkileşimi içinde başlatılabilir — pointerdown'da.
            if (this.sound?.ready) this.sound.start(this.dragStartTime);
            else void this.loadSound().then((s) => s?.prepare());
        }
        try {
            this.vinylEl.setPointerCapture(e.pointerId);
        } catch {
            /* eski tarayıcı */
        }
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        if (!this.dragging || e.pointerId !== this.dragPointer) return;
        e.stopPropagation();
        const angle = this.pointerAngle(e);
        const delta = wrapDegrees(angle - this.lastPointerAngle);
        this.lastPointerAngle = angle;
        if (!this.canScratch()) {
            this.accum += delta;
            if (Math.abs(this.accum) > TAP_DEGREES) this.moved = true;
            return;
        }
        // Başa / sona dayanınca plak daha fazla dönmez.
        const spt = this.secondsPerTurn;
        const duration = this.ctx.videoEl.duration;
        const minAccum = (-this.dragStartTime / spt) * 360;
        const maxAccum = ((duration - this.dragStartTime) / spt) * 360;
        this.accum = Math.min(maxAccum, Math.max(minAccum, this.accum + delta));
        if (!this.moved && Math.abs(this.accum) > TAP_DEGREES) {
            this.moved = true;
            this.el.setAttribute('data-scratching', '');
        }
        if (!this.moved) return;
        this.discEl.style.transform = `rotate(${this.dragStartAngle + this.accum}deg)`;
        this.pendingSeek = this.dragStartTime + (this.accum / 360) * spt;
        this.sound?.setTarget(this.pendingSeek);
        if (!this.seekFrame) this.seekFrame = requestAnimationFrame(this.flushSeek);
    };

    private readonly flushSeek = (): void => {
        this.seekFrame = 0;
        if (this.pendingSeek === null) return;
        this.ctx.videoEl.currentTime = this.pendingSeek;
        this.pendingSeek = null;
    };

    private readonly onPointerUp = (e: PointerEvent): void => {
        if (!this.dragging || e.pointerId !== this.dragPointer) return;
        e.stopPropagation();
        this.dragging = false;
        this.dragPointer = -1;
        this.el.removeAttribute('data-scratching');
        this.sound?.stop();
        if (this.seekFrame) {
            cancelAnimationFrame(this.seekFrame);
            this.flushSeek();
        }
        if (!this.moved && this.canScratch() && this.wasPlaying) {
            // Çalarken basıldı (ve basınca sustu): kısa dokunuş = duraklat (öyle kalır); tutup bırakmak = devam.
            const held = performance.now() - this.downAt >= TAP_MS;
            // Basış iptal olduysa (ör. dokunmatikte sayfa kaydırması) kullanıcı duraklatmak istememiştir — devam.
            if (held || e.type !== 'pointerup') this.ctx.play();
            else {
                this.el.removeAttribute('data-playing'); // basılıyken inik tutulan pikap kolu kalksın
                this.render();
            }
            return;
        }
        if (!this.moved) {
            if (e.type === 'pointerup') this.ctx.togglePlay();
            return;
        }
        if (this.wasPlaying) this.ctx.play();
        else this.render();
    };

    // ── Media Session ───────────────────────────────────────────────────

    private ownsMediaSession(): boolean {
        return this.options.mediaSession !== false && 'mediaSession' in navigator && AudioStage.sessionOwner === this;
    }

    private static sessionOwner: AudioStage | null = null;

    private applyMediaSession(): void {
        if (this.options.mediaSession === false || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
        // Başka bir player çalıyorsa onun bilgilerini ezme — bu player çalmaya başlayınca alır.
        const owner = AudioStage.sessionOwner;
        if (owner && owner !== this && !owner.ctx.videoEl.paused && this.ctx.videoEl.paused) return;
        AudioStage.sessionOwner = this;
        const o = this.options;
        const cover = o.cover || this.ctx.poster();
        const ms = navigator.mediaSession;
        ms.metadata = new MediaMetadata({
            title: o.title ?? '',
            artist: o.artist ?? '',
            album: o.album ?? '',
            artwork: cover ? [{ src: new URL(cover, document.baseURI).href }] : [],
        });
        const v = this.ctx.videoEl;
        const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
            try {
                ms.setActionHandler(action, handler);
            } catch {
                /* tarayıcı bu eylemi desteklemiyor */
            }
        };
        set('play', () => this.ctx.play());
        set('pause', () => v.pause());
        set('seekbackward', (d) => (v.currentTime = Math.max(0, v.currentTime - (d.seekOffset ?? MEDIA_SESSION_SEEK_SECONDS))));
        set('seekforward', (d) => (v.currentTime = Math.min(v.duration || Infinity, v.currentTime + (d.seekOffset ?? MEDIA_SESSION_SEEK_SECONDS))));
        set('seekto', (d) => {
            if (typeof d.seekTime === 'number') v.currentTime = d.seekTime;
        });
        this.updatePositionState();
    }

    private readonly updatePositionState = (): void => {
        if (!this.ownsMediaSession()) return;
        this.lastPositionState = performance.now();
        const v = this.ctx.videoEl;
        const duration = v.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;
        try {
            navigator.mediaSession.setPositionState({
                duration,
                playbackRate: v.playbackRate || 1,
                position: Math.min(duration, Math.max(0, v.currentTime || 0)),
            });
        } catch {
            /* geçersiz durum (ör. kaynak değişirken) */
        }
    };

    private releaseMediaSession(): void {
        if (AudioStage.sessionOwner !== this) return;
        AudioStage.sessionOwner = null;
        if (!('mediaSession' in navigator)) return;
        const ms = navigator.mediaSession;
        ms.metadata = null;
        for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) {
            try {
                ms.setActionHandler(action, null);
            } catch {
                /* desteklenmiyor */
            }
        }
    }

    destroy(): void {
        cancelAnimationFrame(this.frame);
        cancelAnimationFrame(this.seekFrame);
        const v = this.ctx.videoEl;
        v.removeEventListener('play', this.onPlay);
        v.removeEventListener('pause', this.onPause);
        v.removeEventListener('ended', this.onPause);
        v.removeEventListener('seeked', this.render);
        v.removeEventListener('timeupdate', this.onTimeUpdate);
        v.removeEventListener('durationchange', this.onDurationChange);
        v.removeEventListener('ratechange', this.updatePositionState);
        v.removeEventListener('emptied', this.render);
        this.releaseMediaSession();
        this.disableSound();
        this.el.remove();
    }
}
