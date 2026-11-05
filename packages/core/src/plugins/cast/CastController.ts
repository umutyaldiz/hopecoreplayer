import type { CastOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { setIconName } from '../../icons/Icon';
import { loadCastSdk, type CastApi, type CastContextLike, type CastMediaInfo, type CastSessionLike, type RemotePlayerControllerLike, type RemotePlayerLike } from './castSdk';
import { RemoteMediaProxy, nativeGet } from './RemoteMediaProxy';
import { seekWhenReady } from '../shared/seekWhenReady';

/** TV'ye gönderilecek içerik — player o anki duruma göre hazırlar. */
export interface CastMedia {
    src: string;
    contentType: string;
    live: boolean;
    title?: string;
    subtitle?: string;
    image?: string;
    /** Ses modu: TV'de müzik parçası olarak (kapak, sanatçı). */
    music: boolean;
    subtitles: Array<{ src: string; label: string; lang: string; default?: boolean }>;
    /** TV'de oynatılacak reklamlar (makroları doldurulmuş tag'ler); null = reklamsız. */
    ads: { vmap?: string; preroll?: string; midroll?: string; midrollIntervalSeconds?: number; postroll?: string } | null;
}

export interface CastPlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    log(entry: { message: string; fatal?: boolean; details?: Record<string, string | number | boolean | undefined> }): void;
    addButton(label: string, icon: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
    getMedia(): CastMedia | null;
    /** Yerelde video reklamı oynuyor — bu sırada yayın başlatılmaz. */
    isAdPlaying(): boolean;
    /** hls.js (MSE) ile oynatılıyor — AirPlay / Remote Playback bu kaynağı TV'ye veremez. */
    isMse(): boolean;
    /** İçerik kimliği — kalite / yedek kaynak değişimi aynı içerik sayılır (TV'de konum korunur). */
    contentKey(): string;
    /** İçerik TV'de mi (Chromecast) — player yerel reklamları askıya alır, otomatik oynatmayı keser. */
    onRemoteChange(remote: boolean): void;
}

type Via = 'chromecast' | 'airplay' | 'remote';
type CastState = 'available' | 'unavailable' | 'connecting' | 'connected' | 'disconnected';

/** Aynı sayfada birden çok player: Cast oturumu, butonuna basılan player'ındır. */
let requester: CastController | null = null;
let owner: CastController | null = null;
/** Midroll aralığından üretilecek en fazla ara. */
const MAX_INTERVAL_BREAKS = 20;
const MIDROLL_END_MARGIN_S = 5;

/**
 * TV'ye yayın: Google Cast (Chromecast / Google TV), AirPlay ve Remote Playback API. Her biri ayrı ayrı açılır;
 * butonlar yalnızca uygun cihaz varken görünür. Chromecast'te içerik TV'de oynar, player kumandaya dönüşür
 * (RemoteMediaProxy); bağlantı bitince yerelde TV'deki saniyeden devam eder.
 */
export class CastController {
    private options: CastOptions;
    private api: CastApi | null = null;
    private context: CastContextLike | null = null;
    private session: CastSessionLike | null = null;
    private player: RemotePlayerLike | null = null;
    private controller: RemotePlayerControllerLike | null = null;
    private proxy: RemoteMediaProxy | null = null;
    private castBtn: HTMLButtonElement | null = null;
    private castIcon: HTMLElement | null = null;
    private airplayBtn: HTMLButtonElement | null = null;
    private remoteBtn: HTMLButtonElement | null = null;
    private overlay: HTMLDivElement | null = null;
    private loadedSrc = '';
    private loadedContent = '';
    private savedAutoplay = false;
    private airplayActive = false;
    private destroyed = false;
    private remoteWatchId: number | null = null;

    constructor(
        private readonly ctx: CastPlayerContext,
        options: CastOptions
    ) {
        this.options = options;
        if (options.chromecast) void this.initChromecast();
        if (options.airplay) this.initAirPlay();
        if (options.remotePlayback) this.initRemotePlayback();
    }

    update(options: CastOptions): void {
        const prev = this.options;
        this.options = options;
        if (options.chromecast && !prev.chromecast) void this.initChromecast();
        if (options.airplay && !prev.airplay) this.initAirPlay();
        if (options.remotePlayback && !prev.remotePlayback) this.initRemotePlayback();
        if (this.castBtn) this.castBtn.hidden = !options.chromecast || this.castBtn.hidden;
        if (this.airplayBtn && !options.airplay) this.airplayBtn.hidden = true;
        if (this.remoteBtn && !options.remotePlayback) this.remoteBtn.hidden = true;
    }

    /** İçerik şu an TV'de mi (herhangi bir yoldan). */
    get casting(): boolean {
        return !!this.proxy || this.airplayActive || this.ctx.videoEl.remote?.state === 'connected';
    }

    private emit(state: CastState, via: Via, device?: string): void {
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:cast', { detail: { state, via, device } }));
    }

    private button(label: string, icon: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement } {
        const b = this.ctx.addButton(label, icon, onClick);
        b.btn.hidden = true;
        return b;
    }

    // ── Google Cast ─────────────────────────────────────────────────────────

    private async initChromecast(): Promise<void> {
        if (this.castBtn) return;
        const { btn, icon } = this.button(this.ctx.i18n.castButton, 'cast', () => this.requestCast());
        btn.setAttribute('part', 'cast-button');
        this.castBtn = btn;
        this.castIcon = icon;
        const api = await loadCastSdk();
        if (!api || this.destroyed) {
            if (!api) this.ctx.log({ message: 'Google Cast is not available in this browser (Chrome / Edge over HTTPS needed)' });
            return;
        }
        this.api = api;
        const context = api.framework.CastContext.getInstance();
        this.context = context;
        context.setOptions({
            receiverApplicationId: this.options.receiverAppId || api.chrome.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            autoJoinPolicy: api.chrome.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        const types = api.framework.CastContextEventType;
        context.addEventListener(types.CAST_STATE_CHANGED, this.onCastState);
        context.addEventListener(types.SESSION_STATE_CHANGED, this.onSessionState);
        this.onCastState({ castState: context.getCastState() });
        // Sayfa yenilendi ve oturum sürüyor (TV aynı içeriği oynatıyor) → kumandayı yeniden bağla.
        const existing = context.getCurrentSession();
        if (existing && !owner) this.tryResume(existing);
    }

    private readonly onCastState = (e: { castState?: string }): void => {
        const state = e.castState ?? 'NO_DEVICES_AVAILABLE';
        if (this.castBtn) this.castBtn.hidden = state === 'NO_DEVICES_AVAILABLE';
        this.castBtn?.toggleAttribute('data-connecting', state === 'CONNECTING');
        if (!this.proxy) this.emit(state === 'NO_DEVICES_AVAILABLE' ? 'unavailable' : state === 'CONNECTING' ? 'connecting' : 'available', 'chromecast');
    };

    private readonly onSessionState = (e: { sessionState?: string; session?: CastSessionLike }): void => {
        const s = e.sessionState;
        if ((s === 'SESSION_STARTED' || s === 'SESSION_RESUMED') && e.session) {
            if (requester === this) {
                requester = null;
                void this.attach(e.session, true);
            } else if (s === 'SESSION_RESUMED' && !owner) {
                this.tryResume(e.session);
            }
        } else if (s === 'SESSION_ENDED' || s === 'SESSION_START_FAILED') {
            if (requester === this) requester = null;
            if (owner === this) this.detach();
        }
    };

    private requestCast(): void {
        if (!this.context) return;
        if (this.ctx.isAdPlaying()) {
            this.ctx.log({ message: 'Cast: wait for the ad to finish' });
            return;
        }
        requester = this;
        // Bağlıyken Chrome'un seçicisi "yayını durdur"u da sunar.
        this.context.requestSession().catch((err: unknown) => {
            if (requester === this) requester = null;
            // Kullanıcı seçiciyi kapattı ('cancel') — hata değil.
            if (String(err) !== 'cancel') this.ctx.log({ message: `Cast session failed: ${String(err)}` });
        });
    }

    private tryResume(session: CastSessionLike): void {
        const media = this.ctx.getMedia();
        const remoteId = session.getMediaSession()?.media?.contentId;
        if (media && remoteId && remoteId === media.src) void this.attach(session, false);
    }

    private async attach(session: CastSessionLike, load: boolean): Promise<void> {
        const api = this.api;
        if (!api || this.destroyed) return;
        if (owner && owner !== this) owner.detach();
        owner = this;
        this.session = session;
        const v = this.ctx.videoEl;
        const startAt = nativeGet(v, 'currentTime');
        const duration = nativeGet(v, 'duration');
        HTMLMediaElement.prototype.pause.call(v);
        // Cast sırasında kaynak değişirse (playlist / kalite) yerel video kendiliğinden çalmasın.
        this.savedAutoplay = v.autoplay;
        v.autoplay = false;

        const player = new api.framework.RemotePlayer();
        const controller = new api.framework.RemotePlayerController(player);
        this.player = player;
        this.controller = controller;
        this.proxy = new RemoteMediaProxy(
            v,
            {
                play: () => player.isPaused && controller.playOrPause(),
                pause: () => !player.isPaused && controller.playOrPause(),
                seek: (t) => {
                    player.currentTime = t;
                    controller.seek();
                },
                setVolume: (vol) => {
                    player.volumeLevel = vol;
                    controller.setVolumeLevel();
                },
                setMuted: (m) => player.isMuted !== m && controller.muteOrUnmute(),
            },
            { paused: false, currentTime: startAt, duration, volume: v.volume, muted: v.muted, ended: false }
        );
        this.proxy.install();
        controller.addEventListener(api.framework.RemotePlayerEventType.ANY_CHANGE, this.onRemoteChange);
        v.addEventListener('loadstart', this.onLocalSourceChange);
        this.ctx.onRemoteChange(true);
        const device = session.getCastDevice()?.friendlyName || this.ctx.i18n.castDeviceFallback;
        this.showOverlay(this.ctx.i18n.castPlayingOn.replace('{device}', device));
        this.castBtn?.setAttribute('aria-pressed', 'true');
        if (this.castIcon) setIconName(this.castIcon, 'cast-connected');
        this.emit('connected', 'chromecast', device);
        if (load) await this.loadMedia(startAt, true);
        else {
            this.loadedSrc = session.getMediaSession()?.media?.contentId ?? '';
            this.loadedContent = this.ctx.contentKey();
        }
    }

    /** O an çalan içeriği TV'ye yükler (reklam araları ve altyazılarla). */
    private async loadMedia(currentTime: number, autoplay: boolean): Promise<void> {
        const api = this.api;
        const session = this.session;
        const media = this.ctx.getMedia();
        if (!api || !session || !media) {
            this.ctx.log({ message: 'Cast: nothing to send (no playable source)' });
            return;
        }
        const m = api.chrome.media;
        const info: CastMediaInfo = new m.MediaInfo(media.src, media.contentType);
        info.streamType = media.live ? m.StreamType.LIVE : m.StreamType.BUFFERED;
        const md = media.music ? new m.MusicTrackMediaMetadata() : new m.GenericMediaMetadata();
        md.title = media.title;
        if (media.music) md.artist = media.subtitle;
        else md.subtitle = media.subtitle;
        if (media.image) md.images = [new api.chrome.Image(media.image)];
        info.metadata = md;
        if (/mpegurl/i.test(media.contentType) && this.options.hlsSegmentFormat === 'fmp4') {
            if (m.HlsSegmentFormat) info.hlsSegmentFormat = m.HlsSegmentFormat.FMP4;
            if (m.HlsVideoSegmentFormat) info.hlsVideoSegmentFormat = m.HlsVideoSegmentFormat.FMP4;
        }
        const activeTrackIds: number[] = [];
        info.tracks = media.subtitles.map((s, i) => {
            const t = new m.Track(i + 1, m.TrackType.TEXT);
            t.trackContentId = s.src;
            t.trackContentType = 'text/vtt';
            t.subtype = m.TextTrackType.SUBTITLES;
            t.name = s.label;
            t.language = s.lang;
            if (s.default) activeTrackIds.push(i + 1);
            return t;
        });
        this.applyAds(info, media);
        const req = new m.LoadRequest(info);
        req.currentTime = media.live ? undefined : currentTime;
        req.autoplay = autoplay;
        if (activeTrackIds.length) req.activeTrackIds = activeTrackIds;
        this.loadedSrc = media.src;
        this.loadedContent = this.ctx.contentKey();
        try {
            await session.loadMedia(req);
            this.ctx.log({ message: 'Cast: media loaded on the TV', details: { src: media.src, ads: media.ads ? (media.ads.vmap ? 'vmap' : 'vast') : 'none' } });
        } catch (err) {
            this.ctx.log({ message: `Cast: the TV could not load the media: ${String(err)}`, fatal: true, details: { src: media.src } });
        }
    }

    /**
     * Reklamlar TV'de: VMAP verilmişse receiver tüm araları kendisi planlar (vmapAdsRequest); yoksa VAST tag'leri
     * ara olarak eklenir — preroll (0), aralıklı midroll'lar, postroll (-1). Reklamları receiver oynatır ve sayar.
     */
    private applyAds(info: CastMediaInfo, media: CastMedia): void {
        const ads = media.ads;
        const m = this.api!.chrome.media;
        if (!ads) return;
        if (ads.vmap) {
            const req = new m.VastAdsRequest();
            req.adTagUrl = ads.vmap;
            info.vmapAdsRequest = req;
            return;
        }
        const clips: unknown[] = [];
        const breaks: unknown[] = [];
        const add = (id: string, tag: string, position: number): void => {
            const clip = new m.BreakClip(`clip-${id}`);
            const req = new m.VastAdsRequest();
            req.adTagUrl = tag;
            clip.vastAdsRequest = req;
            clips.push(clip);
            breaks.push(new m.Break(`break-${id}`, [`clip-${id}`], position));
        };
        if (ads.preroll) add('pre', ads.preroll, 0);
        const every = ads.midrollIntervalSeconds ?? 0;
        const duration = this.proxy?.current.duration ?? NaN;
        if (ads.midroll && every > 0 && !media.live && Number.isFinite(duration)) {
            // Bitişe çok yakın midroll olmasın (orada postroll var).
            for (let t = every, i = 1; t < duration - MIDROLL_END_MARGIN_S && i <= MAX_INTERVAL_BREAKS; t += every, i++) add(`mid-${i}`, ads.midroll, t);
        }
        if (ads.postroll && !media.live) add('post', ads.postroll, -1);
        if (clips.length) {
            info.breakClips = clips as CastMediaInfo['breakClips'];
            info.breaks = breaks;
        }
    }

    private readonly onRemoteChange = (e: { field: string; value: unknown }): void => {
        const p = this.player;
        const proxy = this.proxy;
        if (!p || !proxy) return;
        switch (e.field) {
            case 'isPaused':
                proxy.update({ paused: !!e.value });
                break;
            case 'currentTime':
                proxy.update({ currentTime: Number(e.value) || 0 });
                break;
            case 'duration':
                proxy.update({ duration: Number(e.value) > 0 ? Number(e.value) : proxy.current.duration });
                break;
            case 'volumeLevel':
                proxy.update({ volume: Number(e.value) });
                break;
            case 'isMuted':
                proxy.update({ muted: !!e.value });
                break;
            case 'playerState':
                // İçerik TV'de bitti (IDLE + daha önce oynuyordu) → ended.
                if (e.value === 'IDLE' && p.isMediaLoaded === false && proxy.current.currentTime > 0) proxy.update({ ended: true, paused: true });
                else if (e.value === 'PLAYING') proxy.update({ ended: false, paused: false });
                break;
            case 'isPlayingBreak':
                this.overlay?.toggleAttribute('data-break', !!e.value);
                break;
            case 'isConnected':
                if (!e.value && owner === this) this.detach();
                break;
        }
    };

    /** Cast sırasında player başka bir kaynağa geçti (playlist sonraki öğe, kalite, yedek kaynak) → TV'ye de gönder. */
    private readonly onLocalSourceChange = (): void => {
        if (!this.proxy) return;
        HTMLMediaElement.prototype.pause.call(this.ctx.videoEl);
        const media = this.ctx.getMedia();
        if (!media || media.src === this.loadedSrc) return;
        // Aynı içeriğin başka kalitesi / yedeği ise kaldığı yerden, yeni bir içerikse (playlist) baştan.
        const same = this.ctx.contentKey() === this.loadedContent;
        void this.loadMedia(same ? this.proxy.current.currentTime : 0, true);
    };

    private detach(): void {
        const proxy = this.proxy;
        if (!proxy) return;
        if (owner === this) owner = null;
        const { currentTime, paused, ended } = proxy.current;
        const v = this.ctx.videoEl;
        this.controller?.removeEventListener(this.api!.framework.RemotePlayerEventType.ANY_CHANGE, this.onRemoteChange);
        v.removeEventListener('loadstart', this.onLocalSourceChange);
        proxy.uninstall();
        this.proxy = null;
        this.player = null;
        this.controller = null;
        this.session = null;
        this.loadedSrc = '';
        v.autoplay = this.savedAutoplay;
        this.ctx.onRemoteChange(false);
        this.hideOverlay();
        this.castBtn?.setAttribute('aria-pressed', 'false');
        if (this.castIcon) setIconName(this.castIcon, 'cast');
        // TV'deki saniyeden yerelde devam (bittiyse olduğu yerde kalır).
        // Seek doğrulanmadan play() çağrılırsa WebKit seek'i kaybedip baştan oynatabiliyor.
        const resume = () => {
            if (!paused && !ended) void v.play().catch(() => {});
        };
        if (Number.isFinite(currentTime) && currentTime > 0 && !ended) seekWhenReady(v, currentTime, resume);
        else resume();
        this.emit('disconnected', 'chromecast');
    }

    // ── AirPlay (Safari) ────────────────────────────────────────────────────

    private initAirPlay(): void {
        if (this.airplayBtn || !('WebKitPlaybackTargetAvailabilityEvent' in window)) return;
        const v = this.ctx.videoEl as HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void; webkitCurrentPlaybackTargetIsWireless?: boolean };
        v.setAttribute('x-webkit-airplay', 'allow');
        const { btn } = this.button(this.ctx.i18n.airplayButton, 'airplay', () => {
            if (this.ctx.isMse()) {
                this.ctx.log({ message: 'AirPlay: this source plays through hls.js (MSE) — use hls.engine: "auto" / "native" on Safari for AirPlay' });
                return;
            }
            v.webkitShowPlaybackTargetPicker?.();
        });
        btn.setAttribute('part', 'airplay-button');
        this.airplayBtn = btn;
        v.addEventListener('webkitplaybacktargetavailabilitychanged', ((e: Event & { availability?: string }) => {
            const available = e.availability === 'available';
            btn.hidden = !available || !this.options.airplay;
            if (!this.airplayActive) this.emit(available ? 'available' : 'unavailable', 'airplay');
        }) as EventListener);
        v.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => {
            const on = !!v.webkitCurrentPlaybackTargetIsWireless;
            if (on === this.airplayActive) return;
            this.airplayActive = on;
            btn.setAttribute('aria-pressed', String(on));
            if (on) this.showOverlay(this.ctx.i18n.airplayPlaying);
            else this.hideOverlay();
            this.emit(on ? 'connected' : 'disconnected', 'airplay');
        });
    }

    // ── Remote Playback API ─────────────────────────────────────────────────

    private initRemotePlayback(): void {
        const v = this.ctx.videoEl;
        const remote = v.remote;
        if (this.remoteBtn || !remote) return;
        v.disableRemotePlayback = false;
        const { btn } = this.button(this.ctx.i18n.castButton, 'cast', () => {
            if (this.ctx.isMse()) {
                this.ctx.log({ message: 'Remote playback: hls.js (MSE) sources cannot be sent to the device' });
                return;
            }
            remote.prompt().catch((err: unknown) => this.ctx.log({ message: `Remote playback: ${String(err)}` }));
        });
        btn.setAttribute('part', 'remote-playback-button');
        this.remoteBtn = btn;
        remote
            .watchAvailability((available) => {
                // Google Cast butonu görünüyorsa aynı işi yapan ikinci butonu gösterme.
                btn.hidden = !available || this.ctx.isMse() || !!(this.castBtn && !this.castBtn.hidden);
                if (remote.state === 'disconnected') this.emit(available ? 'available' : 'unavailable', 'remote');
            })
            .then((id) => (this.remoteWatchId = id))
            .catch(() => (btn.hidden = true));
        remote.addEventListener('connecting', () => this.emit('connecting', 'remote'));
        remote.addEventListener('connect', () => {
            btn.setAttribute('aria-pressed', 'true');
            this.showOverlay(this.ctx.i18n.castPlayingOn.replace('{device}', this.ctx.i18n.castDeviceFallback));
            this.emit('connected', 'remote');
        });
        remote.addEventListener('disconnect', () => {
            btn.setAttribute('aria-pressed', 'false');
            this.hideOverlay();
            this.emit('disconnected', 'remote');
        });
    }

    // ── "TV'de oynatılıyor" katmanı ─────────────────────────────────────────

    private showOverlay(text: string): void {
        if (!this.overlay) {
            const el = document.createElement('div');
            el.className = 'hp-cast-overlay';
            el.setAttribute('part', 'cast-overlay');
            el.setAttribute('role', 'status');
            const icon = document.createElement('i');
            icon.className = 'hp-icon hp-icon-cast-connected';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'hp-cast-overlay-text';
            const ad = document.createElement('span');
            ad.className = 'hp-cast-overlay-ad';
            el.append(icon, label, ad);
            this.ctx.overlayEl.appendChild(el);
            this.overlay = el;
        }
        this.overlay.querySelector('.hp-cast-overlay-text')!.textContent = text;
        this.overlay.querySelector('.hp-cast-overlay-ad')!.textContent = this.ctx.i18n.castAdOnTv;
        this.overlay.removeAttribute('data-break');
        this.overlay.setAttribute('data-open', '');
        this.ctx.overlayEl.setAttribute('data-casting', '');
    }

    private hideOverlay(): void {
        this.overlay?.removeAttribute('data-open');
        this.ctx.overlayEl.removeAttribute('data-casting');
    }

    refreshLabels(): void {
        this.castBtn?.setAttribute('aria-label', this.ctx.i18n.castButton);
        this.airplayBtn?.setAttribute('aria-label', this.ctx.i18n.airplayButton);
        this.remoteBtn?.setAttribute('aria-label', this.ctx.i18n.castButton);
    }

    destroy(): void {
        this.destroyed = true;
        if (owner === this) {
            // Player sayfadan kalkıyor: TV'deki yayın sürsün (Cast'in olağan davranışı), kumanda bağı kopsun.
            this.detach();
        }
        if (requester === this) requester = null;
        if (this.context && this.api) {
            const types = this.api.framework.CastContextEventType;
            this.context.removeEventListener(types.CAST_STATE_CHANGED, this.onCastState);
            this.context.removeEventListener(types.SESSION_STATE_CHANGED, this.onSessionState);
        }
        if (this.remoteWatchId !== null) void this.ctx.videoEl.remote?.cancelWatchAvailability(this.remoteWatchId).catch(() => {});
        this.castBtn?.remove();
        this.airplayBtn?.remove();
        this.remoteBtn?.remove();
        this.overlay?.remove();
    }
}
