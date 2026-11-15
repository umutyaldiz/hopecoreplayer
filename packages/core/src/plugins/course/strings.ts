// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir.
import type { CourseStringKey, HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, CourseStringKey>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        courseNotes: 'Notlar',
        courseAddNote: 'Not ekle',
        courseNotePlaceholder: 'Bu ana not ekleyin…',
        courseNoNotes: 'Henüz not yok. Yazdığınız not videonun o anına eklenir.',
        courseDeleteNote: 'Notu sil',
        courseBlocked: 'Henüz izlemediğiniz kısma geçemezsiniz',
        courseCompleted: 'Ders tamamlandı',
        courseProgress: (percent) => `%${percent} izlendi`,
    },
    en: {
        courseNotes: 'Notes',
        courseAddNote: 'Add note',
        courseNotePlaceholder: 'Add a note at this moment…',
        courseNoNotes: 'No notes yet. A note is pinned to the current moment of the video.',
        courseDeleteNote: 'Delete note',
        courseBlocked: "You can't skip ahead to a part you haven't watched yet",
        courseCompleted: 'Lesson completed',
        courseProgress: (percent) => `${percent}% watched`,
    },
};
