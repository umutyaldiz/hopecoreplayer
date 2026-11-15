import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { Reactions, type ReactionsPlayerContext } from './Reactions';
import type { ReactionsOptions } from '../../types';

registerLocaleStrings(strings);

export function installReactions(ctx: ReactionsPlayerContext, options: ReactionsOptions): Reactions {
    return new Reactions(ctx, options);
}

export { Reactions };
export type { ReactionsPlayerContext };
