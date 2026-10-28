import { MarkProgress, type MarkersPlayerContext } from './MarkProgress';
import type { MarkersOptions } from '../../types';

export function installMarkers(ctx: MarkersPlayerContext, options: MarkersOptions): MarkProgress {
    return new MarkProgress(ctx, options);
}

export { MarkProgress };
export type { MarkersPlayerContext };
