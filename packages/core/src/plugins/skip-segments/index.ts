import { SkipSegments, type SkipSegmentsPlayerContext } from './SkipSegments';
import type { SkipSegment } from '../../types';

export function installSkipSegments(ctx: SkipSegmentsPlayerContext, segments: SkipSegment[]): SkipSegments {
    return new SkipSegments(ctx, segments);
}

export { SkipSegments };
export type { SkipSegmentsPlayerContext };
