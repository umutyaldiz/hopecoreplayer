// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir.
import type { ClipStringKey, HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, ClipStringKey>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        clip: 'Klip oluştur',
        clipTitle: 'Klip oluştur',
        clipStart: 'Başlangıç',
        clipEnd: 'Bitiş',
        clipLength: (time) => `Uzunluk ${time}`,
        clipPreview: 'Önizle',
        clipCopy: 'Kopyala',
        clipCopied: 'Kopyalandı',
        clipClose: 'Klibi kapat',
        clipMore: 'Diğer…',
        clipBadge: (time) => `Klip · ${time}`,
        clipWatchAll: 'Tüm videoyu izle',
    },
    en: {
        clip: 'Create clip',
        clipTitle: 'Create a clip',
        clipStart: 'Start',
        clipEnd: 'End',
        clipLength: (time) => `Length ${time}`,
        clipPreview: 'Preview',
        clipCopy: 'Copy',
        clipCopied: 'Copied',
        clipClose: 'Close clip',
        clipMore: 'More…',
        clipBadge: (time) => `Clip · ${time}`,
        clipWatchAll: 'Watch full video',
    },
};
