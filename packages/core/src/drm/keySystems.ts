// `options.drm` → hls.js / dash.js ayarları.
import type { HlsConfig } from 'hls.js';
import type { ProtectionDataSet } from 'dashjs';
import type { HopeDrmLicense, HopeDrmOptions } from '../types';

export const KEY_SYSTEMS = {
    widevine: 'com.widevine.alpha',
    playready: 'com.microsoft.playready',
    fairplay: 'com.apple.fps',
    clearkey: 'org.w3.clearkey',
} as const;

export type DrmName = keyof typeof KEY_SYSTEMS;

/** Verilen sistemler, öncelik sırasıyla. */
export function drmEntries(drm: HopeDrmOptions | undefined): Array<[DrmName, HopeDrmLicense]> {
    if (!drm) return [];
    const order: DrmName[] = ['fairplay', 'widevine', 'playready', 'clearkey'];
    return order.filter((n) => drm[n]?.licenseUrl).map((n) => [n, drm[n]!]);
}

export function hasDrm(drm: HopeDrmOptions | undefined): boolean {
    return drmEntries(drm).length > 0;
}

const nameOf = (keySystem: string): DrmName | undefined => (Object.keys(KEY_SYSTEMS) as DrmName[]).find((n) => KEY_SYSTEMS[n] === keySystem);

/** hls.js EME ayarları. */
export function hlsDrmConfig(drm: HopeDrmOptions, user: Partial<HlsConfig>): Partial<HlsConfig> {
    const drmSystems: NonNullable<HlsConfig['drmSystems']> = {};
    for (const [name, lic] of drmEntries(drm)) {
        const cert = name === 'fairplay' ? drm.fairplay!.certificateUrl : undefined;
        drmSystems[KEY_SYSTEMS[name] as keyof typeof drmSystems] = { licenseUrl: lic.licenseUrl, ...(cert ? { serverCertificateUrl: cert } : {}) };
    }
    const userSetup = user.licenseXhrSetup;
    const userResponse = user.licenseResponseCallback;
    const config: Partial<HlsConfig> = {
        emeEnabled: true,
        drmSystems,
        licenseXhrSetup(xhr, url, keyContext, challenge) {
            const name = nameOf(keyContext.keySystem);
            const lic = name ? drm[name] : undefined;
            for (const [k, v] of Object.entries(lic?.headers ?? {})) xhr.setRequestHeader(k, v);
            if (lic?.withCredentials) xhr.withCredentials = true;
            if (name === 'fairplay' && drm.fairplay?.prepareLicenseRequest) {
                return Promise.resolve(drm.fairplay.prepareLicenseRequest(challenge, new Uint8Array(0))).then(toChallenge);
            }
            return userSetup?.call(this, xhr, url, keyContext, challenge);
        },
    };
    if (drm.fairplay?.parseLicenseResponse || userResponse) {
        config.licenseResponseCallback = function (xhr, url, keyContext) {
            if (nameOf(keyContext.keySystem) === 'fairplay' && drm.fairplay?.parseLicenseResponse) {
                // hls.js eşzamanlı yanıt bekler; Promise dönen ayrıştırıcı burada kullanılamaz.
                const out = drm.fairplay.parseLicenseResponse(xhr.response as ArrayBuffer);
                if (!(out instanceof Promise)) return toArrayBuffer(out);
            }
            return userResponse ? userResponse.call(this, xhr, url, keyContext) : (xhr.response as ArrayBuffer);
        };
    }
    if (drm.widevine?.robustness) {
        config.drmSystemOptions = { videoRobustness: drm.widevine.robustness, audioRobustness: drm.widevine.robustness };
    }
    return config;
}

function toChallenge(body: BodyInit): Uint8Array | string {
    if (typeof body === 'string') return body;
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return String(body);
}

function toArrayBuffer(b: BufferSource): ArrayBuffer {
    if (b instanceof ArrayBuffer) return b;
    const view = b as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** dash.js koruma verisi (FairPlay DASH'te kullanılmaz). */
export function dashProtectionData(drm: HopeDrmOptions): ProtectionDataSet {
    const out: ProtectionDataSet = {};
    for (const [name, lic] of drmEntries(drm)) {
        if (name === 'fairplay') continue;
        out[KEY_SYSTEMS[name]] = {
            serverURL: lic.licenseUrl,
            ...(lic.headers ? { httpRequestHeaders: lic.headers } : {}),
            ...(lic.withCredentials ? { withCredentials: true } : {}),
            ...(name === 'widevine' && drm.widevine?.robustness ? { videoRobustness: drm.widevine.robustness, audioRobustness: drm.widevine.robustness } : {}),
        };
    }
    return out;
}
