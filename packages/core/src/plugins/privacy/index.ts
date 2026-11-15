import type { PrivacyConsent, PrivacyGroupMap, PrivacyOptions } from '../../types';
import { updatePrivacy } from '../../utils/privacy';

type Apply = (consent: PrivacyConsent, source: string) => void;

interface TcfData {
    gdprApplies?: boolean;
    eventStatus?: string;
    listenerId?: number;
    purpose?: { consents?: Record<string, boolean> };
}

declare global {
    interface Window {
        OnetrustActiveGroups?: string;
        OneTrust?: { OnConsentChanged?: (cb: () => void) => void };
        Cookiebot?: { consent?: { preferences?: boolean; statistics?: boolean; marketing?: boolean }; hasResponse?: boolean };
    }
}

const ONETRUST_GROUPS: Required<Omit<PrivacyGroupMap, 'ads'>> = { analytics: 'C0002', functional: 'C0003', personalizedAds: 'C0004' };

/** OnetrustActiveGroups (",C0001,C0002,") → kategoriler; grup tanımlı değilse alan değişmez. */
export function fromOneTrust(active: string, groups: PrivacyGroupMap = {}): PrivacyConsent {
    const set = new Set(active.split(',').map((g) => g.trim()).filter(Boolean));
    const map: PrivacyGroupMap = { ...ONETRUST_GROUPS, ...groups };
    const has = (g: string | string[] | undefined): boolean | undefined => (g === undefined ? undefined : (Array.isArray(g) ? g : [g]).every((x) => set.has(x)));
    const out: PrivacyConsent = {};
    for (const k of ['ads', 'personalizedAds', 'analytics', 'functional'] as const) {
        const v = has(map[k]);
        if (v !== undefined) out[k] = v;
    }
    return out;
}

/**
 * IAB TCF v2 amaçları → kategoriler. 1: cihazda saklama / erişim, 3–4: kişiselleştirilmiş reklam profili / seçimi,
 * 8–9: içerik performansını ölçme / pazar araştırması. GDPR uygulanmıyorsa hepsi açık.
 */
export function fromTcf(data: TcfData): PrivacyConsent {
    if (data.gdprApplies === false) return { personalizedAds: true, analytics: true, functional: true };
    const c = data.purpose?.consents ?? {};
    const p = (n: number): boolean => c[n] === true || c[String(n)] === true;
    return { functional: p(1), personalizedAds: p(1) && p(3) && p(4), analytics: p(1) && (p(8) || p(9)) };
}

/** Cookiebot: preferences → işlevsel, statistics → analitik, marketing → kişiselleştirilmiş reklam. */
export function fromCookiebot(c: { preferences?: boolean; statistics?: boolean; marketing?: boolean }): PrivacyConsent {
    return { functional: !!c.preferences, analytics: !!c.statistics, personalizedAds: !!c.marketing };
}

/**
 * Onay kaynağına bağlanır: ilk yanıt gelince `ready` çözülür, değişiklikler `apply` ile bildirilir. Dönen `disconnect`
 * dinleyicileri kaldırır. CMP hiç yanıt vermezse `ready` çözülmez — çağıran `waitMs` ile yarıştırır.
 */
export function connectPrivacy(o: PrivacyOptions, apply: Apply): { ready: Promise<void>; disconnect: () => void } {
    const cleanups: Array<() => void> = [];
    let resolve!: () => void;
    const ready = new Promise<void>((r) => (resolve = r));
    const answer = (consent: PrivacyConsent, source: string): void => {
        apply(consent, source);
        resolve();
    };

    if (o.getConsent) {
        void Promise.resolve()
            .then(() => o.getConsent!())
            .then((c) => c && answer(c, 'getConsent'))
            .catch((err: unknown) => console.warn('[hope-player] privacy.getConsent:', err));
    }

    if (o.source === 'onetrust') {
        let last: string | undefined;
        const read = (): void => {
            const active = window.OnetrustActiveGroups;
            if (typeof active !== 'string' || active === last) return;
            last = active;
            answer(fromOneTrust(active, o.groups), 'onetrust');
        };
        read();
        // Yeni sürümler OneTrustGroupsUpdated, eskiler consent.onetrust yayar; OnConsentChanged + yoklama yedek.
        for (const ev of ['OneTrustGroupsUpdated', 'consent.onetrust']) {
            window.addEventListener(ev, read);
            cleanups.push(() => window.removeEventListener(ev, read));
        }
        try {
            window.OneTrust?.OnConsentChanged?.(read);
        } catch {
            /* eski SDK */
        }
        const poll = setInterval(read, 1000);
        cleanups.push(() => clearInterval(poll));
    }

    if (o.source === 'cookiebot') {
        const read = (): void => {
            const c = window.Cookiebot?.consent;
            if (c && window.Cookiebot?.hasResponse !== false) answer(fromCookiebot(c), 'cookiebot');
        };
        read();
        for (const ev of ['CookiebotOnConsentReady', 'CookiebotOnAccept', 'CookiebotOnDecline']) {
            window.addEventListener(ev, read);
            cleanups.push(() => window.removeEventListener(ev, read));
        }
    }

    if (o.source === 'tcf') {
        let listenerId: number | undefined;
        const attach = (): boolean => {
            const api = (window as unknown as { __tcfapi?: (cmd: string, v: number, cb: (d: TcfData, ok: boolean) => void, param?: unknown) => void }).__tcfapi;
            if (typeof api !== 'function') return false;
            api('addEventListener', 2, (data, ok) => {
                if (!ok || !data) return;
                listenerId = data.listenerId;
                // tcloaded: kayıtlı seçim var; useractioncomplete: kullanıcı şimdi seçti. cmpuishown: henüz karar yok.
                if (data.eventStatus === 'tcloaded' || data.eventStatus === 'useractioncomplete' || data.gdprApplies === false) answer(fromTcf(data), 'tcf');
            });
            cleanups.push(() => {
                if (listenerId !== undefined) api('removeEventListener', 2, () => {}, listenerId);
            });
            return true;
        };
        // CMP betiği player'dan sonra yüklenebilir — kısa süre bekle.
        if (!attach()) {
            const t = setInterval(() => attach() && clearInterval(t), 250);
            const stop = setTimeout(() => clearInterval(t), 10_000);
            cleanups.push(() => {
                clearInterval(t);
                clearTimeout(stop);
            });
        }
    }

    return { ready, disconnect: () => cleanups.splice(0).forEach((fn) => fn()) };
}

/** CMP'ye bağlan; ilk yanıt ya da `waitMs` dolunca çözülür. `own` bağlantıyı kesecek fonksiyonu alır. */
export function startPrivacy(o: PrivacyOptions, own: (disconnect: () => void) => void): Promise<void> {
    // Yanıt gelene kadar: 'deny' (varsayılan) kişiselleştirme / analitik / kayıt kapalı; seçenekteki değerler önce gelir.
    const grant = o.default === 'grant';
    updatePrivacy({ ads: o.ads ?? true, personalizedAds: o.personalizedAds ?? grant, analytics: o.analytics ?? grant, functional: o.functional ?? grant }, 'options');
    if (!o.source && !o.getConsent) return Promise.resolve();
    const c = connectPrivacy(o, (consent, source) => updatePrivacy(consent, source));
    own(c.disconnect);
    return Promise.race([c.ready, new Promise<void>((r) => setTimeout(r, Math.max(0, o.waitMs ?? 2000)))]);
}
