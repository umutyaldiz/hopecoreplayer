import { LiveWallClock, type LiveWallClockPlayerContext } from './LiveWallClock';
import type { LiveWallClockOptions } from '../../types';

export function installLiveWallClock(ctx: LiveWallClockPlayerContext, options: LiveWallClockOptions): LiveWallClock {
    return new LiveWallClock(ctx, options);
}

export { LiveWallClock };
export type { LiveWallClockPlayerContext };
