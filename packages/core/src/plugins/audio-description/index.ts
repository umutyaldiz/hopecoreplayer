import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { AudioDescription, type AudioDescriptionContext } from './AudioDescription';
import type { AudioDescriptionOptions } from '../../types';

registerLocaleStrings(strings);

export function installAudioDescription(ctx: AudioDescriptionContext, options: AudioDescriptionOptions): AudioDescription {
    return new AudioDescription(ctx, options);
}

export { AudioDescription };
export type { AudioDescriptionContext };
