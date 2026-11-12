import { Multiview, type HlsLike, type MultiviewPlayerContext } from './Multiview';
import type { MultiviewOptions } from '../../types';

export function installMultiview(ctx: MultiviewPlayerContext, options: MultiviewOptions): Multiview {
    return new Multiview(ctx, options);
}

export { Multiview };
export type { HlsLike, MultiviewPlayerContext };
