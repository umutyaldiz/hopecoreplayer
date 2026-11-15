// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir.
import type { HopeLocaleStrings, SignLanguageStringKey } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, SignLanguageStringKey>;

export const strings: { tr: Strings; en: Strings } = {
    tr: { signLanguage: 'İşaret dili', signLanguageOn: 'Açık', signLanguageOff: 'Kapalı' },
    en: { signLanguage: 'Sign language', signLanguageOn: 'On', signLanguageOff: 'Off' },
};
