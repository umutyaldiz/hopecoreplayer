import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { Multiview, type HlsLike, type MultiviewPlayerContext } from './Multiview';
import type { MultiviewOptions } from '../../types';

registerLocaleStrings(strings);

export function installMultiview(ctx: MultiviewPlayerContext, options: MultiviewOptions): Multiview {
    return new Multiview(ctx, options);
}

export { Multiview };
export type { HlsLike, MultiviewPlayerContext };
