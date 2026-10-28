import { Segments, type SegmentsPlayerContext } from './Segments';
import type { SegmentItem } from '../../types';

export function installSegments(ctx: SegmentsPlayerContext, items: SegmentItem[]): Segments {
    return new Segments(ctx, items);
}

export { Segments };
export type { SegmentsPlayerContext };
