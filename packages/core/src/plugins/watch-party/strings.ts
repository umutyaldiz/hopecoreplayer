// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir.
import type { HopeLocaleStrings, PartyStringKey } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, PartyStringKey>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        partyPlayed: (name) => `${name} oynattı`,
        partyPaused: (name) => `${name} durdurdu`,
        partySeeked: (name, time) => `${name} ${time} noktasına geçti`,
        partySomeone: 'Biri',
    },
    en: {
        partyPlayed: (name) => `${name} pressed play`,
        partyPaused: (name) => `${name} paused`,
        partySeeked: (name, time) => `${name} jumped to ${time}`,
        partySomeone: 'Someone',
    },
};
