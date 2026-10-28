import type { AdsOptions } from '../../types';

/**
 * Generic TCF/USP consent — options.consentAware === true gerektirir. Non-blocking; yetersiz onay/opt-out'ta
 * google.ima.settings.setPrivacySettings({ nonPersonalizedAds: true }) zorlar.
 */

interface TcfData {
    gdprApplies?: boolean;
    vendor?: { consents?: Record<number, boolean> };
    purpose?: { consents?: Record<number, boolean> };
}

declare global {
    interface Window {
        __uspapi?: (command: string, version: number, callback: (data: { uspString?: string } | undefined, success: boolean) => void) => void;
        __tcfapi?: (command: string, version: number, callback: (data: TcfData | undefined, success: boolean) => void) => void;
    }
}

function restrictAdsForConsent(ima: typeof google.ima | null, reason: string): void {
    try {
        if (ima?.settings?.setPrivacySettings) {
            ima.settings.setPrivacySettings({ nonPersonalizedAds: true });
            console.warn(`[HopePlayer consent] non-personalized ads zorlandı (${reason})`);
        }
    } catch (err) {
        console.warn('[HopePlayer consent] setPrivacySettings hatası:', err);
    }
}

/** options.consentAware değilse no-op. IMA TC/GPP string'ini zaten ekliyor; bu ek bir "Limited Ads" zorlaması. */
export function initConsentAware(options: AdsOptions, ima: typeof google.ima | null): void {
    if (!options.consentAware) return;

    try {
        if (typeof window.__uspapi === 'function') {
            window.__uspapi('getUSPData', 1, (uspData, success) => {
                if (!success || !uspData?.uspString) return;
                if (uspData.uspString.charAt(2) === 'Y') restrictAdsForConsent(ima, 'USP/CCPA opt-out');
            });
        }
    } catch (err) {
        console.warn('[HopePlayer consent] __uspapi okuma hatası:', err);
    }

    try {
        if (typeof window.__tcfapi === 'function') {
            window.__tcfapi('getTCData', 2, (tcData, success) => {
                if (!success || !tcData || tcData.gdprApplies !== true) return;
                const googleVendorConsent = tcData.vendor?.consents?.[755];
                const purpose1Consent = tcData.purpose?.consents?.[1];
                if (googleVendorConsent === false || purpose1Consent === false) {
                    restrictAdsForConsent(ima, 'TCF yetersiz onay');
                }
            });
        }
    } catch (err) {
        console.warn('[HopePlayer consent] __tcfapi okuma hatası:', err);
    }
}
