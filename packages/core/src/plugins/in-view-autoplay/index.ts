import { InViewAutoplay, type InViewAutoplayPlayerContext } from './InViewAutoplay';
import type { InViewAutoplayOptions } from '../../types';

export function installInViewAutoplay(ctx: InViewAutoplayPlayerContext, options: InViewAutoplayOptions): InViewAutoplay {
    return new InViewAutoplay(ctx, options);
}

export { InViewAutoplay };
export type { InViewAutoplayPlayerContext };
