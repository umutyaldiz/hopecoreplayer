// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir (bkz. i18n/index.ts).
import type { HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, 'redirectSuggestions' | 'redirectReplay' | 'redirectCloseSuggestions'>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        redirectSuggestions: 'Önerilen videolar',
        redirectReplay: 'Tekrar izle',
        redirectCloseSuggestions: 'Önerileri kapat',
    },
    en: {
        redirectSuggestions: 'Recommended videos',
        redirectReplay: 'Watch again',
        redirectCloseSuggestions: 'Close suggestions',
    },
};
