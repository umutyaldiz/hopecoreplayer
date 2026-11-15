// Bu eklentinin metinleri — ana pakete girmez, eklenti yüklenince sözlüğe eklenir.
import type { HopeLocaleStrings, PaywallStringKey } from '../../i18n/types';

type Strings = Pick<HopeLocaleStrings, PaywallStringKey>;

export const strings: { tr: Strings; en: Strings } = {
    tr: {
        paywallTitle: 'Devamını izlemek için abone olun',
        paywallText: 'Ücretsiz önizleme sona erdi. Abone olarak videonun tamamını ve tüm arşivi izleyebilirsiniz.',
        paywallSubscribe: 'Abone ol',
        paywallLogin: 'Giriş yap',
        paywallPreview: (time) => `Önizleme · ${time}`,
    },
    en: {
        paywallTitle: 'Subscribe to keep watching',
        paywallText: 'The free preview has ended. Subscribe to watch the full video and the whole archive.',
        paywallSubscribe: 'Subscribe',
        paywallLogin: 'Sign in',
        paywallPreview: (time) => `Preview · ${time}`,
    },
};
