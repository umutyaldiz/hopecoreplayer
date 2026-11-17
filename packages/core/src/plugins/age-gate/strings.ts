// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir.
import type { AgeGateStringKey, HopeLocaleStrings } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, AgeGateStringKey>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        ageGateTitle: (age) => `Bu içerik ${age} yaş ve üzeri içindir`,
        ageGateText: 'Devam etmek için doğum tarihinizi girin.',
        ageGateDay: 'Gün',
        ageGateMonth: 'Ay',
        ageGateYear: 'Yıl',
        ageGateFormat: 'GG/AA/YYYY',
        ageGateSubmit: 'Onayla',
        ageGateInvalid: 'Lütfen geçerli bir tarih girin.',
        ageGateDeniedTitle: 'Erişim kısıtlı',
        ageGateDenied: (age) => `Üzgünüz, bu içeriği izlemek için en az ${age} yaşında olmalısınız.`,
        ageGateRetry: 'Tarihi düzelt',
        ageGatePassed: 'Teşekkürler, iyi seyirler!',
    },
    en: {
        ageGateTitle: (age) => `This content is for viewers ${age}+`,
        ageGateText: 'Enter your date of birth to continue.',
        ageGateDay: 'Day',
        ageGateMonth: 'Month',
        ageGateYear: 'Year',
        ageGateFormat: 'DD/MM/YYYY',
        ageGateSubmit: 'Confirm',
        ageGateInvalid: 'Please enter a valid date.',
        ageGateDeniedTitle: 'Access restricted',
        ageGateDenied: (age) => `Sorry, you must be at least ${age} to watch this content.`,
        ageGateRetry: 'Fix the date',
        ageGatePassed: 'Thanks, enjoy the show!',
    },
};
