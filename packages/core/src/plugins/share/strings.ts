// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir (bkz. i18n/index.ts).
import type { HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, 'share' | 'shareCopy' | 'shareCopied' | 'shareStartAt' | 'shareMore' | 'shareClose' | 'shareLink' | 'shareEmail'>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        share: 'Paylaş',
        shareCopy: 'Kopyala',
        shareCopied: 'Kopyalandı',
        shareStartAt: (time) => `${time} itibarıyla başlat`,
        shareMore: 'Diğer…',
        shareClose: 'Paylaşımı kapat',
        shareLink: 'Video bağlantısı',
        shareEmail: 'E-posta',
    },
    en: {
        share: 'Share',
        shareCopy: 'Copy',
        shareCopied: 'Copied',
        shareStartAt: (time) => `Start at ${time}`,
        shareMore: 'More…',
        shareClose: 'Close sharing',
        shareLink: 'Video link',
        shareEmail: 'Email',
    },
};
