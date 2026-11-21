// Reklam bildirimlerinin metinleri — ana pakete girmez, reklam eklentisi yüklenince sözlüğe eklenir.
import type { AdNoticeStringKey, HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, AdNoticeStringKey>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        adNoticeLoading: 'Reklam yükleniyor…',
        adNoticeEmpty: (preroll) => (preroll ? 'Reklam yok, video başlıyor' : 'Reklam yok, keyifli seyirler'),
        adNoticeCountdown: (s) => `Reklama ${s} saniye kaldı`,
    },
    en: {
        adNoticeLoading: 'Loading ad…',
        adNoticeEmpty: (preroll) => (preroll ? 'No ad, starting the video' : 'No ad, enjoy the video'),
        adNoticeCountdown: (s) => `Ad starts in ${s}`,
    },
};
