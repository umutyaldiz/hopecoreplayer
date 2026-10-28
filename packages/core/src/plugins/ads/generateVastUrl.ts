/** adTaxonomy.keyValues → GAM cust_params (key=value, & ile; virgül GAM'de aynı key'in çoklu değer ayracı). */
function buildAdTaxonomyKeyValues(): string {
    const w = window as unknown as { adTaxonomy?: { keyValues?: Record<string, unknown> } };
    const kv = w.adTaxonomy?.keyValues;
    if (!kv || typeof kv !== 'object') return '';

    const pairs: string[] = [];
    for (const [key, value] of Object.entries(kv)) {
        if (value === undefined || value === null || value === '') continue;
        pairs.push(`${key}=${value}`);
    }
    return pairs.join('&');
}

export interface GenerateVastUrlOptions {
    adRefreshCount?: number;
    /** true ise cust_params'a adrefreshCount eklenir (adsRetry.enabled ile aynı anlam). */
    includeRefreshCount?: boolean;
}

/** [referrer_url]/[description_url]/[timestamp] placeholder'larını doldurur, cust_params'a adrefreshCount + adTaxonomy ekler. */
export function generateVastUrl(baseUrl: string, options: GenerateVastUrlOptions = {}): string {
    const referrerUrl = encodeURIComponent(document.referrer || window.location.href);
    const descriptionUrl = encodeURIComponent(window.location.href);
    const timestamp = Date.now();

    let url = baseUrl;
    const params: Record<string, string | number> = {
        referrer_url: referrerUrl,
        description_url: descriptionUrl,
        timestamp,
    };

    for (const [key, value] of Object.entries(params)) {
        const placeholder = `[${key}]`;
        if (url.includes(placeholder)) {
            url = url.replace(placeholder, String(value));
        } else if (!new URLSearchParams(url.split('?')[1]).has(key)) {
            const delimiter = url.includes('?') ? '&' : '?';
            url += `${delimiter}${key}=${value}`;
        }
    }

    try {
        const parsedUrl = new URL(url);
        const isVmap = parsedUrl.pathname.includes('/vmap/');
        if (isVmap) return baseUrl;

        const extras: string[] = [];
        if (options.includeRefreshCount) extras.push(`adrefreshCount=${options.adRefreshCount ?? 0}`);
        const taxonomyKeyValues = buildAdTaxonomyKeyValues();
        if (taxonomyKeyValues) extras.push(taxonomyKeyValues);

        if (extras.length) {
            const custParams = parsedUrl.searchParams.get('cust_params');
            parsedUrl.searchParams.set('cust_params', custParams ? `${custParams}&${extras.join('&')}` : extras.join('&'));
        }

        return parsedUrl.toString();
    } catch {
        return url;
    }
}
