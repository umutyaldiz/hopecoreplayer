import { AdTriggers, normalizeAdTriggers, type AdTriggersContext } from './AdTriggers';
import type { AdTriggersOptions } from '../../types';

/** Reklam tetikleyicisini kurar (kuralları `endpoint`'ten ya da `config`'ten alır). */
export function installAdTriggers(ctx: AdTriggersContext, options: AdTriggersOptions): AdTriggers {
    return new AdTriggers(ctx, options);
}

export { AdTriggers, normalizeAdTriggers };
export type { AdTriggersContext };
