import { PauseAd, type PauseAdPlayerContext } from './PauseAd';
import type { PauseAdOptions } from '../../types';

export function installPauseAd(ctx: PauseAdPlayerContext, options: PauseAdOptions): PauseAd {
    return new PauseAd(ctx, options);
}

export { PauseAd };
export type { PauseAdPlayerContext };
