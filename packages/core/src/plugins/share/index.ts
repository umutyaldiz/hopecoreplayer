import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { Share, parseTimeParam, type SharePlayerContext } from './Share';
import type { ShareOptions } from '../../types';

registerLocaleStrings(strings);

export function installShare(ctx: SharePlayerContext, options: ShareOptions): Share {
    return new Share(ctx, options);
}

export { Share, parseTimeParam };
export type { SharePlayerContext };
