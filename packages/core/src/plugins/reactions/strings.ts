// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir.
import type { HopeLocaleStrings, ReactionsStringKey } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, ReactionsStringKey>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        reactions: 'Tepki ver',
        reactionsComment: 'Yorum yaz…',
        reactionsSend: 'Gönder',
        reactionsShowComments: 'Yorumlar',
        reactionsOn: 'Açık',
        reactionsOff: 'Kapalı',
    },
    en: {
        reactions: 'React',
        reactionsComment: 'Write a comment…',
        reactionsSend: 'Send',
        reactionsShowComments: 'Comments',
        reactionsOn: 'On',
        reactionsOff: 'Off',
    },
};
