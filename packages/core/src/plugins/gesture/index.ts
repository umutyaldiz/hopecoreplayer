import { GestureControls, type GesturePlayerContext } from './GestureControls';
import type { GestureOptions } from '../../types';

export function installGesture(ctx: GesturePlayerContext, options: GestureOptions): GestureControls {
    return new GestureControls(ctx, options);
}

export { GestureControls };
export type { GesturePlayerContext };
