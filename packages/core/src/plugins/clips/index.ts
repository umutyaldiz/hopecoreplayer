import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { Clips, parseClipParam, type ClipPlayerContext } from './Clips';
import type { ClipOptions } from '../../types';

registerLocaleStrings(strings);

export function installClips(ctx: ClipPlayerContext, options: ClipOptions): Clips {
    return new Clips(ctx, options);
}

export { Clips, parseClipParam };
export type { ClipPlayerContext };
