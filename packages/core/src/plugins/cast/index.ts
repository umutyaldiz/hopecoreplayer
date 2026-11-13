import { adoptStyle } from '../../utils/plugin-style';
import css from './cast.css?inline';
import { CastController, type CastMedia, type CastPlayerContext } from './CastController';
import type { CastOptions } from '../../types';

/** TV'ye yayını kurar (Google Cast / AirPlay / Remote Playback — her biri seçenekle açılır). */
export function installCast(ctx: CastPlayerContext, options: CastOptions): CastController {
    adoptStyle(ctx.videoEl, 'cast', css);
    return new CastController(ctx, options);
}

export { CastController };
export type { CastMedia, CastPlayerContext };
