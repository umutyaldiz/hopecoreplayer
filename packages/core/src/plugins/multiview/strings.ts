// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir (bkz. i18n/index.ts).
import type { HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, 'multiviewLayout' | 'multiviewCameras' | 'multiviewWatching' | 'multiviewSwitch' | 'multiviewNotStarted'>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        multiviewLayout: 'Bölünmüş ekran',
        multiviewCameras: 'Kameralar',
        multiviewWatching: 'İzleniyor',
        multiviewSwitch: (label) => `${label} kamerasına geç`,
        multiviewNotStarted: 'Henüz başlamadı',
    },
    en: {
        multiviewLayout: 'Split view',
        multiviewCameras: 'Cameras',
        multiviewWatching: 'Watching',
        multiviewSwitch: (label) => `Switch to ${label}`,
        multiviewNotStarted: 'Not started yet',
    },
};
