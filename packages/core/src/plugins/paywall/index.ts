import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { Paywall, type PaywallPlayerContext } from './Paywall';
import type { PaywallOptions } from '../../types';

registerLocaleStrings(strings);

export function installPaywall(ctx: PaywallPlayerContext, options: PaywallOptions): Paywall {
    return new Paywall(ctx, options);
}

export { Paywall };
export type { PaywallPlayerContext };
