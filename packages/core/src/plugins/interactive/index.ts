import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { Interactive, type InteractivePlayerContext } from './Interactive';
import type { InteractiveOptions } from '../../types';

registerLocaleStrings(strings);

export function installInteractive(ctx: InteractivePlayerContext, options: InteractiveOptions): Interactive {
    return new Interactive(ctx, options);
}

export { Interactive };
export type { InteractivePlayerContext };
