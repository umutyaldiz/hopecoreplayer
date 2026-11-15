// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir.
import type { HopeLocaleStrings, PodcastStringKey } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, PodcastStringKey>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        sleepTimer: 'Uyku zamanlayıcısı',
        sleepOff: 'Kapalı',
        sleepMinutes: (m) => `${m} dakika`,
        sleepEndOfEpisode: 'Bölüm sonunda',
        sleepStopped: 'Uyku zamanlayıcısı: oynatma durduruldu',
        skipSilence: 'Sessiz kısımları hızlı geç',
        skipSilenceOn: 'Açık',
        skipSilenceOff: 'Kapalı',
        skipSilenceUnavailable: 'Sessizlik algılanamıyor: tarayıcı desteklemiyor (Safari / iOS) ya da kaynağın CORS izni yok',
    },
    en: {
        sleepTimer: 'Sleep timer',
        sleepOff: 'Off',
        sleepMinutes: (m) => `${m} minutes`,
        sleepEndOfEpisode: 'End of episode',
        sleepStopped: 'Sleep timer: playback stopped',
        skipSilence: 'Skip silences',
        skipSilenceOn: 'On',
        skipSilenceOff: 'Off',
        skipSilenceUnavailable: "Silences can't be detected: unsupported browser (Safari / iOS) or no CORS on the source",
    },
};
