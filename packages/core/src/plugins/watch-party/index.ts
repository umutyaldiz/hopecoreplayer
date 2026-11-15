import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { WatchParty, type WatchPartyPlayerContext } from './WatchParty';
import type { WatchPartyOptions } from '../../types';

registerLocaleStrings(strings);

export function installWatchParty(ctx: WatchPartyPlayerContext, options: WatchPartyOptions): WatchParty {
    return new WatchParty(ctx, options);
}

export { WatchParty };
export type { WatchPartyPlayerContext };
