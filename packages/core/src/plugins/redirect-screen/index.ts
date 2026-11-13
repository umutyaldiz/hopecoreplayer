import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { RedirectScreen, type RedirectScreenPlayerContext } from './RedirectScreen';
import type { RedirectScreenOptions } from '../../types';

registerLocaleStrings(strings);

export function installRedirectScreen(ctx: RedirectScreenPlayerContext, options: RedirectScreenOptions): RedirectScreen {
    return new RedirectScreen(ctx, options);
}

export { RedirectScreen };
export type { RedirectScreenPlayerContext };
