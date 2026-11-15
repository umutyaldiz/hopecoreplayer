import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { SignLanguage, type SignLanguagePlayerContext } from './SignLanguage';
import type { SignLanguageOptions } from '../../types';

registerLocaleStrings(strings);

export function installSignLanguage(ctx: SignLanguagePlayerContext, options: SignLanguageOptions): SignLanguage {
    return new SignLanguage(ctx, options);
}

export { SignLanguage };
export type { SignLanguagePlayerContext };
