import { adoptStyle } from '../../utils/plugin-style';
import css from './history.css?inline';
import { PlaybackHistory, type HistoryPlayerContext } from './PlaybackHistory';
import type { HistoryOptions } from '../../types';

export function installHistory(ctx: HistoryPlayerContext, options: HistoryOptions): PlaybackHistory {
    adoptStyle(ctx.videoEl, 'history', css);
    return new PlaybackHistory(ctx, options);
}

export { PlaybackHistory };
export type { HistoryPlayerContext };
