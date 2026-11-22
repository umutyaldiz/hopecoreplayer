import { adoptStyle } from '../../utils/plugin-style';
import { registerLocaleStrings } from '../../i18n';
import css from './ambient.css?inline';
import { Ambient, type AmbientContext } from './Ambient';
import type { AmbientOptions } from '../../types';

registerLocaleStrings({ tr: { ambient: 'Ortam ışığı' }, en: { ambient: 'Ambient light' } });

/** Ortam ışığını kurar (options.ambient). */
export function installAmbient(ctx: AmbientContext, options: AmbientOptions): Ambient {
    adoptStyle(ctx.videoEl, 'ambient', css);
    return new Ambient(ctx, options);
}

export { Ambient };
export type { AmbientContext };
