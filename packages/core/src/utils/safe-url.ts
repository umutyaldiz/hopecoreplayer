/** Yalnızca http(s) ya da göreli adres — `javascript:` / `data:` / `vbscript:` gibi şemalar reddedilir. */
export function isSafeUrl(value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        const { protocol } = new URL(value, document.baseURI);
        return protocol === 'https:' || protocol === 'http:';
    } catch {
        return false;
    }
}

/** Güvenliyse mutlak adres, değilse null. */
export function safeUrl(value: unknown): string | null {
    return isSafeUrl(value) ? new URL(value, document.baseURI).href : null;
}
