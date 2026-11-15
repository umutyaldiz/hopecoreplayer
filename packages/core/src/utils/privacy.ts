/**
 * Sayfa geneli gizlilik onayı: reklam, kişiselleştirilmiş reklam, analitik ve işlevsel (cihazda saklama, işlevsel dış
 * hizmetler). `privacy` verilmezse hepsi açık (eski davranış). CMP bağlayıcıları ayrı parçada (plugins/privacy).
 */
export interface PrivacyState {
    /** Reklam gösterilsin mi (false → hiç reklam isteği yapılmaz). */
    ads: boolean;
    /** Kişiselleştirilmiş reklam (false → npa=1, GPT nonPersonalizedAds, Prebid açık artırması yapılmaz). */
    personalizedAds: boolean;
    /** Ölçüm: QoE / GA4, izleme pikselleri, CMCD oturum kimliği. */
    analytics: boolean;
    /** Tercihlerin cihazda saklanması (localStorage) ve işlevsel dış hizmetler (konum API'si, Cast SDK). */
    functional: boolean;
}

const state: PrivacyState = { ads: true, personalizedAds: true, analytics: true, functional: true };
const listeners = new Set<(s: Readonly<PrivacyState>, source: string) => void>();
let pending: Promise<void> | null = null;
let waiting = false;

export function getPrivacy(): Readonly<PrivacyState> {
    return state;
}

/** Onayı güncelle (yalnızca verilen alanlar); işlevsel onay geri çekilirse kayıtlı tercihler silinir. */
export function updatePrivacy(next: Partial<PrivacyState>, source: string): void {
    let changed = false;
    const hadFunctional = state.functional;
    for (const k of ['ads', 'personalizedAds', 'analytics', 'functional'] as const) {
        const v = next[k];
        if (typeof v === 'boolean' && state[k] !== v) {
            state[k] = v;
            changed = true;
        }
    }
    // Onay geri çekildi: kayıtlı tercihler silinir (silme kodu ayrı parçada).
    // Başlangıç varsayılanı ('options') geri çekme sayılmaz — CMP yanıtı gelince kayıtlar silinmesin.
    if (hadFunctional && !state.functional && source !== 'options') void import('../plugins/privacy/clear').then((m) => m.clearStoredData());
    if (changed) for (const fn of listeners) fn(state, source);
}

export function onPrivacyChange(fn: (s: Readonly<PrivacyState>, source: string) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** CMP'nin ilk yanıtı beklenirken reklam isteği bunu bekler (en fazla `waitMs`). */
export function setPrivacyPending(p: Promise<void> | null): void {
    pending = p;
    waiting = !!p;
    void p?.finally(() => {
        if (pending === p) waiting = false;
    });
}

/** İlk onay yanıtı bekleniyor mu — bu sırada önceden (onayla) kaydedilmiş tercihler okunabilir, yazılmaz. */
export function privacyWaiting(): boolean {
    return waiting;
}

export function privacyReady(): Promise<void> {
    return pending ?? Promise.resolve();
}
