import { RewardedUnlock, type RewardedUnlockContext } from './RewardedUnlock';
import type { RewardedUnlockOptions } from '../../types';

/** Ödüllü reklamla kalite kilidini kurar. */
export function installRewardedUnlock(ctx: RewardedUnlockContext, options: RewardedUnlockOptions): RewardedUnlock {
    return new RewardedUnlock(ctx, options);
}

export { RewardedUnlock };
export type { RewardedUnlockContext };
