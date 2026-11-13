import { adoptStyle } from '../../utils/plugin-style';
import css from './pause-ad.css?inline';
import { PauseAd, type PauseAdPlayerContext } from './PauseAd';
import type { PauseAdOptions } from '../../types';

export function installPauseAd(ctx: PauseAdPlayerContext, options: PauseAdOptions): PauseAd {
    adoptStyle(ctx.videoEl, 'pause-ad', css);
    return new PauseAd(ctx, options);
}

export { PauseAd };
export type { PauseAdPlayerContext };
