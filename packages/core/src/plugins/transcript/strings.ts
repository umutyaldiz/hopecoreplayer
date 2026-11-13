// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir (bkz. i18n/index.ts).
import type { HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, 'transcript' | 'transcriptSearch' | 'transcriptClose' | 'transcriptTrack' | 'transcriptEmpty' | 'transcriptNoResults' | 'transcriptWaiting'>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        transcript: 'Transkript',
        transcriptSearch: 'Transkriptte ara',
        transcriptClose: 'Transkripti kapat',
        transcriptTrack: 'Transkript dili',
        transcriptEmpty: 'Bu video için altyazı yok.',
        transcriptNoResults: 'Sonuç bulunamadı.',
        transcriptWaiting: 'Altyazılar yükleniyor…',
    },
    en: {
        transcript: 'Transcript',
        transcriptSearch: 'Search transcript',
        transcriptClose: 'Close transcript',
        transcriptTrack: 'Transcript language',
        transcriptEmpty: 'No captions for this video.',
        transcriptNoResults: 'No results.',
        transcriptWaiting: 'Loading captions…',
    },
};
