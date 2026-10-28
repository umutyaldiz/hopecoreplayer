import { SpriteThumbnails, type SpriteThumbnailsPlayerContext } from './SpriteThumbnails';
import type { SpriteThumbnailsOptions } from '../../types';

export function installSpriteThumbnails(ctx: SpriteThumbnailsPlayerContext, options: SpriteThumbnailsOptions): SpriteThumbnails {
    return new SpriteThumbnails(ctx, options);
}

export { SpriteThumbnails };
export type { SpriteThumbnailsPlayerContext };
