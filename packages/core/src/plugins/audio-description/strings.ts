// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir (bkz. i18n/index.ts).
import type { HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, 'audioDescription' | 'audioDescriptionOn' | 'audioDescriptionOff'>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        audioDescription: 'Sesli betimleme',
        audioDescriptionOn: 'Açık',
        audioDescriptionOff: 'Kapalı',
    },
    en: {
        audioDescription: 'Audio description',
        audioDescriptionOn: 'On',
        audioDescriptionOff: 'Off',
    },
};
