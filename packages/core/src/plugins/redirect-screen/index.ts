import { RedirectScreen, type RedirectScreenPlayerContext } from './RedirectScreen';
import type { RedirectScreenOptions } from '../../types';

export function installRedirectScreen(ctx: RedirectScreenPlayerContext, options: RedirectScreenOptions): RedirectScreen {
    return new RedirectScreen(ctx, options);
}

export { RedirectScreen };
export type { RedirectScreenPlayerContext };
