// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir (bkz. i18n/index.ts).
import type { HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, 'pipPlaying' | 'pipBack'>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        pipPlaying: 'Resim içinde resim penceresinde oynatılıyor',
        pipBack: 'Buraya geri al',
    },
    en: {
        pipPlaying: 'Playing in picture-in-picture',
        pipBack: 'Bring it back',
    },
};
