import { CountdownScreen } from './CountdownScreen';
import type { GatePlayerContext } from '../shared/GatePlayerContext';
import type { CountdownScreenOptions } from '../../types';

export function installCountdownScreen(ctx: GatePlayerContext, options: CountdownScreenOptions): CountdownScreen {
    return new CountdownScreen(ctx, options);
}

export { CountdownScreen };
export type { GatePlayerContext };
