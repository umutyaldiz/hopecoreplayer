/** Bizim anahtarlarımız: hp-*, hp_*, hope-*, hope_* (localStorage + sessionStorage). */
export function clearStoredData(): void {
    for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
        try {
            const keys: string[] = [];
            for (let i = 0; i < store.length; i++) {
                const k = store.key(i);
                if (k && /^(hp|hope)[-_:]/.test(k)) keys.push(k);
            }
            for (const k of keys) store.removeItem(k);
        } catch {
            /* depolama kapalı */
        }
    }
}
