import type { AdsOptions, CastOptions } from '../../types';
import { generateVastUrl, mergeCustParams, toCustRecord } from '../ads/generateVastUrl';

export type CastAdTags = { vmap?: string; preroll?: string; midroll?: string; midrollIntervalSeconds?: number; postroll?: string } | null;

/** TV'ye gidecek reklam tag'leri (makrolar doldurulmuş) — `cast.ads` ya da player'ın `ads` seçeneğinden; null = reklamsız. */
export function castAdTags(cast: CastOptions['ads'], adsOpts: AdsOptions | null): CastAdTags {
    if (cast === false) return null;
    // TV de aynı GAM birimini ister — Prebid custParams'ı (preroll / midroll) TV tag'lerine de eklenir.
    const prebid = adsOpts?.prebid;
    const preCust = prebid?.custParams;
    const midCust = prebid ? { ...toCustRecord(prebid.custParams), ...toCustRecord(prebid.midroll?.custParams) } : undefined;
    const tag = (t: string | string[] | undefined, cust?: Parameters<typeof mergeCustParams>[1]): string | undefined => {
        const first = Array.isArray(t) ? t[0] : t;
        return first ? mergeCustParams(generateVastUrl(first), cust) : undefined;
    };
    const ads =
        typeof cast === 'object'
            ? {
                  vmap: cast.vmap ? generateVastUrl(cast.vmap) : undefined,
                  preroll: tag(cast.preroll),
                  midroll: tag(cast.midroll),
                  midrollIntervalSeconds: cast.midrollIntervalSeconds,
                  postroll: tag(cast.postroll),
              }
            : adsOpts
              ? {
                    vmap: adsOpts.adTagVmap ? generateVastUrl(adsOpts.adTagVmap) : undefined,
                    preroll: tag(adsOpts.adTagPreroll, preCust),
                    midroll: tag(adsOpts.adTagMidroll, midCust),
                    midrollIntervalSeconds: adsOpts.midrollIntervalSeconds,
                    postroll: tag(adsOpts.adTagPostroll),
                }
              : null;
    return ads && (ads.vmap || ads.preroll || ads.midroll || ads.postroll) ? ads : null;
}
