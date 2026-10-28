import { Dubbing, type DubbingPlayerContext } from './Dubbing';
import type { DubbingOptions } from '../../types';

export function installDubbing(ctx: DubbingPlayerContext, options: DubbingOptions): Dubbing {
    return new Dubbing(ctx, options);
}

export { Dubbing };
export type { DubbingPlayerContext };
