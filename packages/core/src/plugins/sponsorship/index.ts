import { SponsorshipLayer, normalizeSponsorship, type SponsorshipContext } from './SponsorshipLayer';
import type { SponsorshipOptions } from '../../types';

/** Sponsorluk katmanını kurar (ayarları `endpoint`'ten alır). */
export function installSponsorship(ctx: SponsorshipContext, options: SponsorshipOptions): SponsorshipLayer {
    return new SponsorshipLayer(ctx, options);
}

export { SponsorshipLayer, normalizeSponsorship };
export type { SponsorshipContext };
