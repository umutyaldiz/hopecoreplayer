import { TapGestures, DEFAULT_TAP_GESTURES, type TapGesturesPlayerContext, type TapPointerType } from './TapGestures';
import type { TapGesture } from '../../types';

export function installTapGestures(ctx: TapGesturesPlayerContext, gestures: TapGesture[]): TapGestures {
    return new TapGestures(ctx, gestures);
}

export { TapGestures, DEFAULT_TAP_GESTURES };
export type { TapGesturesPlayerContext, TapPointerType };
