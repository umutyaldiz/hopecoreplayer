import { getPrivacy, privacyWaiting } from './privacy';

/** İşlevsel onay yokken tercihler yalnızca bu sayfada (bellekte) tutulur. */
const memory = new Map<string, string>();

/** localStorage / sessionStorage — işlevsel onay yoksa yalnızca bellek. Hata vermez. */
export function storageGet(key: string, session = false): string | null {
    try {
        // Onay yanıtı beklenirken daha önce kaydedilmiş tercih okunabilir (yazma yok).
        return memory.get(key) ?? (getPrivacy().functional || privacyWaiting() ? (session ? sessionStorage : localStorage).getItem(key) : null);
    } catch {
        return null;
    }
}

export function storageSet(key: string, value: string, session = false): void {
    try {
        if (getPrivacy().functional) (session ? sessionStorage : localStorage).setItem(key, value);
        else memory.set(key, value);
    } catch {
        /* dolu / kapalı */
    }
}

export function storageRemove(key: string, session = false): void {
    memory.delete(key);
    try {
        (session ? sessionStorage : localStorage).removeItem(key);
    } catch {
        /* kapalı */
    }
}
