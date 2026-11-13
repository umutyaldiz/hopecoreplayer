// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir (bkz. i18n/index.ts).
import type { HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, 'interactivePoll' | 'interactiveQuiz' | 'interactiveCorrect' | 'interactiveWrong' | 'interactiveBuy' | 'interactiveGo' | 'interactiveSponsored' | 'interactiveClose' | 'interactiveVotes'>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        interactivePoll: 'Anket',
        interactiveQuiz: 'Soru',
        interactiveCorrect: 'Doğru!',
        interactiveWrong: 'Yanlış',
        interactiveBuy: 'Satın al',
        interactiveGo: 'Git',
        interactiveSponsored: 'Sponsorlu',
        interactiveClose: 'Kapat',
        interactiveVotes: (percent) => `%${percent}`,
    },
    en: {
        interactivePoll: 'Poll',
        interactiveQuiz: 'Quiz',
        interactiveCorrect: 'Correct!',
        interactiveWrong: 'Wrong',
        interactiveBuy: 'Buy now',
        interactiveGo: 'Open',
        interactiveSponsored: 'Sponsored',
        interactiveClose: 'Close',
        interactiveVotes: (percent) => `${percent}%`,
    },
};
