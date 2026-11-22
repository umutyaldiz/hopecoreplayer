import { adoptStyle } from '../../utils/plugin-style';
import css from './ambient.css?inline';
import { Ambient, type AmbientContext } from './Ambient';
import type { AmbientOptions } from '../../types';

/** Ortam ışığını kurar (options.ambient). */
export function installAmbient(ctx: AmbientContext, options: AmbientOptions): Ambient {
    adoptStyle(ctx.videoEl, 'ambient', css);
    return new Ambient(ctx, options);
}

export { Ambient };
export type { AmbientContext };
