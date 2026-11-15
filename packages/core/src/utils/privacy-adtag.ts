import { getPrivacy } from './privacy';

/** GAM ad tag'ine kişiselleştirme parametreleri: npa=1, depolama izni de yoksa ltd=1 (sınırlı reklam). */
export function privacyAdTag(url: string): string {
    const state = getPrivacy();
    if (state.personalizedAds) return url;
    try {
        const u = new URL(url);
        if (!/(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com)$/.test(u.hostname)) return url;
        u.searchParams.set('npa', '1');
        if (!state.functional) u.searchParams.set('ltd', '1');
        return u.toString();
    } catch {
        return url;
    }
}
