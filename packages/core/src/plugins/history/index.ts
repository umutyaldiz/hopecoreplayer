import { PlaybackHistory, type HistoryPlayerContext } from './PlaybackHistory';
import type { HistoryOptions } from '../../types';

export function installHistory(ctx: HistoryPlayerContext, options: HistoryOptions): PlaybackHistory {
    return new PlaybackHistory(ctx, options);
}

export { PlaybackHistory };
export type { HistoryPlayerContext };
