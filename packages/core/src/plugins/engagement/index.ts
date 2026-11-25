import type { HopePlayerOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import type { ControlBar } from '../../controls/ControlBar';
import type { Paywall } from '../paywall';
import type { Watermark } from '../watermark';
import type { Clips } from '../clips';
import type { WatchParty } from '../watch-party';
import type { Reactions } from '../reactions';
import type { Course } from '../course';
import type { Podcast } from '../podcast';
import type { SignLanguage } from '../sign-language';
import type { Ambient } from '../ambient';
import type { StableVolume } from '../stable-volume';
import type { Snapshot } from '../snapshot';
import type { TouchLock } from '../touch-lock';

export interface EngagementHost {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    videoArea: HTMLElement;
    i18n: HopeLocaleStrings;
    controlBar: ControlBar;
    isAdPlaying(): boolean;
    blockChrome(key: string): void;
    unblockChrome(key: string): void;
    holdChrome(key: string, hold: boolean): void;
    log(message: string): void;
}

/** Fonksiyonları atıp karşılaştırma anahtarı üretir (callback değişince eklenti yeniden kurulmaz). */
function optionKey(value: unknown): string {
    return value ? JSON.stringify(value, (_k, v: unknown) => (typeof v === 'function' ? undefined : v)) : '';
}


/**
 * 1.8 eklentileri (ödeme duvarı, filigran, klip, birlikte izle, tepkiler, eğitim modu, podcast, işaret dili): seçenek
 * değişince ilgili eklenti yeniden kurulur. Ana pakete girmesin diye ayrı parça.
 */
export class EngagementController {
    paywall: Paywall | null = null;
    watermark: Watermark | null = null;
    clips: Clips | null = null;
    watchParty: WatchParty | null = null;
    reactions: Reactions | null = null;
    course: Course | null = null;
    podcast: Podcast | null = null;
    signLanguage: SignLanguage | null = null;
    ambient: Ambient | null = null;
    stableVolume: StableVolume | null = null;
    snapshot: Snapshot | null = null;
    touchLock: TouchLock | null = null;
    private keys: Record<string, string> = {};

    constructor(private readonly h: EngagementHost) {}

    private changed(name: string, key: string): boolean {
        if (this.keys[name] === key) return false;
        this.keys[name] = key;
        return true;
    }

    async apply(options: HopePlayerOptions): Promise<void> {
        const h = this.h;
        const base = { hostEl: h.hostEl, videoEl: h.videoEl, overlayEl: h.videoArea, i18n: h.i18n };
        const isLive = (): boolean => h.videoEl.duration === Infinity;
        const isAdActive = (): boolean => h.isAdPlaying();
        /** Kontrol çubuğu butonu — anahtar `controlsOrder`'da kullanılır. */
        const buttonFor = (key: string) => (label: string, icon: string, onClick: () => void) => h.controlBar.addButton(label, icon, onClick, key);
        const menu = h.controlBar.settingsMenu;
        const registerToggle = (row: { key: string; label: string; getValueLabel(): string; onToggle(): void }): void => menu.registerToggle(row.key, row);
        const unregisterToggle = (k: string): void => menu.unregisterToggle(k);
        const seekBar = h.controlBar.seekBar;

        // Ödeme duvarı — callback'ler (onClick, checkAccess) anahtara girmez, setOptions ile güncellenir.
        const pw = options.paywall && options.paywall.previewSeconds > 0 ? options.paywall : null;
        const pwKey = optionKey(pw);
        if (this.changed('paywall', pwKey)) {
            this.paywall?.destroy();
            this.paywall = null;
            if (pw) {
                const { installPaywall } = await import('../paywall');
                if (this.keys.paywall === pwKey)
                    this.paywall = installPaywall({ ...base, isLive, isAdActive, blockChrome: () => h.blockChrome('paywall'), unblockChrome: () => h.unblockChrome('paywall') }, pw);
            }
        } else if (pw) this.paywall?.setOptions(pw);

        const wm = options.watermark?.text ? options.watermark : null;
        const wmKey = optionKey(wm);
        if (this.changed('watermark', wmKey)) {
            this.watermark?.destroy();
            this.watermark = null;
            if (wm) {
                const { installWatermark } = await import('../watermark');
                if (this.keys.watermark === wmKey) this.watermark = installWatermark({ videoEl: h.videoEl, overlayEl: h.videoArea, isAdActive }, wm);
            }
        }

        const cl = options.clips ? (options.clips === true ? {} : options.clips) : null;
        const clKey = optionKey(cl);
        if (this.changed('clips', clKey)) {
            this.clips?.destroy();
            this.clips = null;
            if (cl) {
                const { installClips } = await import('../clips');
                if (this.keys.clips === clKey)
                    this.clips = installClips(
                        { ...base, seekBarEl: seekBar.el, ratioAtClientX: (x) => seekBar.ratioAtClientX(x), addButton: buttonFor('clip'), isLive, holdChrome: (hold) => h.holdChrome('clips', hold) },
                        cl
                    );
            }
        }

        const wp = options.watchParty ?? null;
        const wpKey = wp ? optionKey(wp) || '{}' : '';
        if (this.changed('watchParty', wpKey)) {
            this.watchParty?.destroy();
            this.watchParty = null;
            if (wp) {
                const { installWatchParty } = await import('../watch-party');
                if (this.keys.watchParty === wpKey) this.watchParty = installWatchParty({ ...base, isAdActive }, wp);
            }
        } else if (wp) this.watchParty?.setOptions(wp);

        const re = options.reactions ? (options.reactions === true ? {} : options.reactions) : null;
        const reKey = optionKey(re);
        if (this.changed('reactions', reKey)) {
            this.reactions?.destroy();
            this.reactions = null;
            if (re) {
                const { installReactions } = await import('../reactions');
                if (this.keys.reactions === reKey)
                    this.reactions = installReactions({ ...base, addButton: buttonFor('reactions'), registerToggle, unregisterToggle, isAdActive, holdChrome: (hold) => h.holdChrome('reactions', hold) }, re);
            }
        }

        const co = options.course?.id ? options.course : null;
        const coKey = optionKey(co);
        if (this.changed('course', coKey)) {
            this.course?.destroy();
            this.course = null;
            if (co) {
                const { installCourse } = await import('../course');
                if (this.keys.course === coKey)
                    this.course = installCourse(
                        {
                            ...base,
                            seekBarEl: seekBar.el,
                            addSeekBarMarker: (ratio, cls, label) => seekBar.addMarker(ratio, cls, label),
                            addButton: buttonFor('notes'),
                            isAdActive,
                            isLive,
                            holdChrome: (hold) => h.holdChrome('course', hold),
                        },
                        co
                    );
            }
        }

        const pc = options.podcast ? (options.podcast === true ? {} : options.podcast) : null;
        const pcKey = optionKey(pc);
        if (this.changed('podcast', pcKey)) {
            this.podcast?.destroy();
            this.podcast = null;
            if (pc) {
                const { installPodcast } = await import('../podcast');
                if (this.keys.podcast === pcKey)
                    this.podcast = installPodcast(
                        {
                            ...base,
                            seekBarEl: seekBar.el,
                            registerSubmenu: (def) => menu.registerSubmenu(def),
                            unregisterSubmenu: (k) => menu.unregisterSubmenu(k),
                            registerToggle,
                            unregisterToggle,
                            log: (message) => h.log(message),
                        },
                        pc
                    );
            }
        }

        const sl = options.signLanguage?.src ? options.signLanguage : null;
        const slKey = optionKey(sl);
        if (this.changed('signLanguage', slKey)) {
            this.signLanguage?.destroy();
            this.signLanguage = null;
            if (sl) {
                const { installSignLanguage } = await import('../sign-language');
                if (this.keys.signLanguage === slKey) this.signLanguage = installSignLanguage({ ...base, addButton: buttonFor('signLanguage'), registerToggle, unregisterToggle, isAdActive }, sl);
            }
        }

        // Ortam ışığı — yalnızca açılıp kapanınca yeniden kurulur, ayarlar yerinde güncellenir.
        const am = options.ambient ? (options.ambient === true ? {} : options.ambient) : null;
        if (!am) {
            this.ambient?.destroy();
            this.ambient = null;
            delete this.keys.ambient;
        } else if (this.ambient) this.ambient.setOptions(am);
        else if (this.changed('ambient', 'on')) {
            const { installAmbient } = await import('../ambient');
            if (this.keys.ambient === 'on' && !this.ambient) this.ambient = installAmbient({ hostEl: h.hostEl, videoEl: h.videoEl, videoArea: h.videoArea, i18n: h.i18n, isAdActive, registerToggle, unregisterToggle }, am);
        }

        // Sabit ses, anlık görüntü, dokunma kilidi — açılınca bir kez kurulur, ayarlar yerinde güncellenir.
        const opt = <T extends object>(v: boolean | T | undefined): T | null => (v ? (v === true ? ({} as T) : v) : null);
        const sv = opt(options.stableVolume);
        if (!sv) {
            this.stableVolume?.destroy();
            this.stableVolume = null;
            delete this.keys.stableVolume;
        } else if (!this.stableVolume && this.changed('stableVolume', 'on')) {
            const { installStableVolume } = await import('../stable-volume');
            if (this.keys.stableVolume === 'on' && !this.stableVolume) this.stableVolume = installStableVolume({ videoEl: h.videoEl, i18n: h.i18n, registerToggle, unregisterToggle }, sv);
        }
        const sn = opt(options.snapshot);
        if (!sn) {
            this.snapshot?.destroy();
            this.snapshot = null;
            delete this.keys.snapshot;
        } else if (this.snapshot) this.snapshot.setOptions(sn);
        else if (this.changed('snapshot', 'on')) {
            const { installSnapshot } = await import('../snapshot');
            if (this.keys.snapshot === 'on' && !this.snapshot) this.snapshot = installSnapshot({ ...base, addButton: buttonFor('snapshot') }, sn);
        }
        const tl = opt(options.touchLock);
        if (!tl) {
            this.touchLock?.destroy();
            this.touchLock = null;
            delete this.keys.touchLock;
        } else if (this.touchLock) this.touchLock.setOptions(tl);
        else if (this.changed('touchLock', 'on')) {
            const { installTouchLock } = await import('../touch-lock');
            if (this.keys.touchLock === 'on' && !this.touchLock)
                this.touchLock = installTouchLock(
                    { ...base, registerToggle, unregisterToggle, closeMenu: () => menu.closeMenu(), blockChrome: () => h.blockChrome('touch-lock'), unblockChrome: () => h.unblockChrome('touch-lock') },
                    tl
                );
        }
    }

    /** Reklam başladı / bitti: filigran gizlenir / döner, bekleyen "birlikte izle" durumu uygulanır. */
    onAdPhase(): void {
        this.watermark?.refresh();
        if (!this.h.isAdPlaying()) this.watchParty?.flush();
    }

    refreshLabels(): void {
        this.paywall?.refreshLabels();
        this.clips?.refreshLabels();
        this.reactions?.refreshLabels();
        this.course?.refreshLabels();
        this.podcast?.refreshLabels();
        this.signLanguage?.refreshLabels();
        this.stableVolume?.refreshLabels();
        this.snapshot?.refreshLabels();
        this.touchLock?.refreshLabels();
    }

    destroy(): void {
        for (const p of [this.paywall, this.watermark, this.clips, this.watchParty, this.reactions, this.course, this.podcast, this.signLanguage, this.ambient, this.stableVolume, this.snapshot, this.touchLock]) p?.destroy();
        this.paywall = this.watermark = this.clips = this.watchParty = this.reactions = this.course = this.podcast = this.signLanguage = this.ambient = null;
        this.stableVolume = this.snapshot = this.touchLock = null;
        this.keys = {};
    }
}
