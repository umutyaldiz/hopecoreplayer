// Native oynatmada (Safari HLS / FairPlay, şifreli MP4) EME: `encrypted` olayında anahtar sistemi, oturum, lisans.
import type { HopeDrmLicense, HopeDrmOptions } from '../types';
import { KEY_SYSTEMS, drmEntries, type DrmName } from './keySystems';

export interface NativeEmeCallbacks {
    onError(message: string, keySystem?: string): void;
    onLicense?(keySystem: string): void;
}

const VIDEO_TYPES = ['video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="avc1.640028"', 'video/webm; codecs="vp9"'];
const AUDIO_TYPES = ['audio/mp4; codecs="mp4a.40.2"'];

export class NativeEme {
    private setup: Promise<{ name: DrmName; lic: HopeDrmLicense } | null> | null = null;
    private readonly sessions: MediaKeySession[] = [];
    /** Aynı initData için ikinci oturum açılmaz. */
    private readonly seen = new Set<string>();
    private disposed = false;

    constructor(
        private readonly video: HTMLVideoElement,
        private readonly drm: HopeDrmOptions,
        private readonly cb: NativeEmeCallbacks
    ) {
        video.addEventListener('encrypted', this.onEncrypted);
    }

    destroy(): void {
        this.disposed = true;
        this.video.removeEventListener('encrypted', this.onEncrypted);
        for (const s of this.sessions.splice(0)) void s.close().catch(() => {});
    }

    private readonly onEncrypted = (e: MediaEncryptedEvent): void => {
        if (!e.initData) return;
        const initData = new Uint8Array(e.initData) as Uint8Array<ArrayBuffer>;
        const key = `${e.initDataType}:${Array.from(initData.subarray(0, 64)).join(',')}:${initData.length}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        void this.handle(e.initDataType, initData).catch((err) => this.fail(err));
    };

    private async handle(initDataType: string, initData: Uint8Array): Promise<void> {
        this.setup ??= this.createKeys(initDataType);
        const chosen = await this.setup;
        if (!chosen || this.disposed) return;
        const keys = this.video.mediaKeys;
        if (!keys) return;
        const session = keys.createSession();
        this.sessions.push(session);
        session.addEventListener('message', (ev) => {
            void this.license(chosen.name, chosen.lic, session, new Uint8Array((ev as MediaKeyMessageEvent).message), initData).catch((err) => this.fail(err, chosen.name));
        });
        await session.generateRequest(initDataType, initData as Uint8Array<ArrayBuffer>);
    }

    private async createKeys(initDataType: string): Promise<{ name: DrmName; lic: HopeDrmLicense } | null> {
        if (!navigator.requestMediaKeySystemAccess) throw new Error('EME is not supported');
        const hlsNative = /\.m3u8|mpegurl/i.test(this.video.currentSrc || this.video.src);
        for (const [name, lic] of drmEntries(this.drm)) {
            const robustness = name === 'widevine' ? (this.drm.widevine?.robustness ?? '') : '';
            const videoCapabilities =
                name === 'fairplay' && hlsNative ? [{ contentType: 'application/vnd.apple.mpegurl', robustness: '' }] : VIDEO_TYPES.map((contentType) => ({ contentType, robustness }));
            const config: MediaKeySystemConfiguration = {
                initDataTypes: [initDataType],
                videoCapabilities,
                ...(name === 'fairplay' && hlsNative ? {} : { audioCapabilities: AUDIO_TYPES.map((contentType) => ({ contentType, robustness })) }),
            };
            let access: MediaKeySystemAccess;
            try {
                access = await navigator.requestMediaKeySystemAccess(KEY_SYSTEMS[name], [config]);
            } catch {
                continue;
            }
            const keys = await access.createMediaKeys();
            if (name === 'fairplay') {
                const cert = await fetchBinary(this.drm.fairplay!.certificateUrl, { headers: lic.headers, credentials: lic.withCredentials ? 'include' : 'same-origin' });
                await keys.setServerCertificate(cert);
            }
            if (this.disposed) return null;
            await this.video.setMediaKeys(keys);
            return { name, lic };
        }
        throw new Error('None of the configured DRM systems is supported by this browser');
    }

    private async license(name: DrmName, lic: HopeDrmLicense, session: MediaKeySession, message: Uint8Array, initData: Uint8Array): Promise<void> {
        const fp = name === 'fairplay' ? this.drm.fairplay : undefined;
        const body = fp?.prepareLicenseRequest ? await fp.prepareLicenseRequest(message, initData) : message;
        const headers: Record<string, string> = { ...(typeof body === 'string' || fp?.prepareLicenseRequest ? {} : { 'Content-Type': 'application/octet-stream' }), ...lic.headers };
        const res = await fetch(lic.licenseUrl, { method: 'POST', body: body as BodyInit, headers, credentials: lic.withCredentials ? 'include' : 'same-origin' });
        if (!res.ok) throw new Error(`License request failed (HTTP ${res.status})`);
        const raw = await res.arrayBuffer();
        const out = fp?.parseLicenseResponse ? await fp.parseLicenseResponse(raw) : raw;
        if (this.disposed) return;
        await session.update(out);
        this.cb.onLicense?.(KEY_SYSTEMS[name]);
    }

    private fail(err: unknown, name?: DrmName): void {
        if (this.disposed) return;
        this.cb.onError((err as Error)?.message ?? String(err), name ? KEY_SYSTEMS[name] : undefined);
    }
}

async function fetchBinary(url: string, init: RequestInit): Promise<ArrayBuffer> {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`Certificate request failed (HTTP ${res.status})`);
    return res.arrayBuffer();
}
