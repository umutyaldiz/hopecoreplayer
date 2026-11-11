import { QoeTracker, type AnalyticsPlayerContext } from './QoeTracker';
import type { HopeAnalyticsOptions } from '../../types';

export function installAnalytics(ctx: AnalyticsPlayerContext, options: HopeAnalyticsOptions): QoeTracker {
    return new QoeTracker(ctx, options);
}

export { QoeTracker };
export type { AnalyticsPlayerContext };
