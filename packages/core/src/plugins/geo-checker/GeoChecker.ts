import type { GeoCheckerOptions } from '../../types';
import type { GatePlayerContext } from '../shared/GatePlayerContext';

const EU_COUNTRIES = [
    'EU', 'AD', 'AL', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CS', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FO', 'FR', 'FX', 'GB', 'GI',
    'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI',
    'SJ', 'SK', 'SM', 'UA', 'VA',
];
const MENA_COUNTRIES = [
    'DZ', 'BH', 'EG', 'IR', 'IQ', 'JO', 'KW', 'LB', 'LY', 'MA', 'OM', 'QA', 'SA', 'PS', 'SD', 'SY', 'TN', 'AE', 'YE',
    'IL', 'DJ', 'TD', 'SO', 'MR', 'NL',
];

/** Ücretsiz, API anahtarı gerektirmeyen, CORS'a açık IP-coğrafya servisi. */
const DEFAULT_API_URL = 'https://get.geojs.io/v1/ip/geo.json';
/** geojs'te ülke KODU (`"TR"`) — `country` alanı ülke ADI (`"Türkiye"`). */
const DEFAULT_PARAMETER = 'country_code';

/**
 * IP-coğrafyasına göre erişim kontrolü. API'ye ulaşılamazsa erişime izin verir (fail-open) —
 * güvenlik değil, lisans/yayın bölgesi uyumluluğu.
 */
export class GeoChecker {
    private readonly loadingEl: HTMLElement;
    private destroyed = false;

    constructor(
        private readonly ctx: GatePlayerContext,
        private readonly options: GeoCheckerOptions
    ) {
        ctx.blockChrome();
        ctx.videoEl.addEventListener('play', this.onPlayWhileBlocked);

        this.loadingEl = document.createElement('div');
        this.loadingEl.setAttribute('part', 'geo-loading');
        this.loadingEl.className = 'hp:absolute hp:inset-0 hp:z-40 hp:flex hp:items-center hp:justify-center hp:bg-surface';
        this.loadingEl.innerHTML =
            '<div class="hp:w-8 hp:h-8 hp:rounded-full hp:border-2 hp:border-on-surface/30 hp:border-t-accent hp:animate-spin"></div>';
        ctx.overlayContainerEl.appendChild(this.loadingEl);

        void this.check();
    }

    /** Uyarı ekranı bir kez (kalıcı olarak) render ediliyor — burada tazelenecek reaktif bir etiket yok, diğer gate plugin'leriyle TUTARLI bir çağrı yüzeyi için var. */
    refreshLabels(): void {
        /* no-op */
    }

    destroy(): void {
        this.destroyed = true;
        this.ctx.videoEl.removeEventListener('play', this.onPlayWhileBlocked);
        this.loadingEl.remove();
    }

    private readonly onPlayWhileBlocked = (): void => {
        this.ctx.videoEl.pause();
    };

    /** Varsayılan geojs: ülke kodu country_code'da (country alanı ülke adı). */
    private async resolveCountry(): Promise<string> {
        if (this.options.getCountry) return String((await this.options.getCountry()) ?? '');

        const response = await fetch(this.options.apiUrl || DEFAULT_API_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: unknown = await response.json();
        const value = (this.options.parameter || DEFAULT_PARAMETER)
            .split('.')
            .reduce<unknown>((obj, key) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined), data);
        return typeof value === 'string' ? value : '';
    }

    private async check(): Promise<void> {
        let allowed = true;
        let userCountry = '';

        try {
            userCountry = (await this.resolveCountry()).trim().toUpperCase();

            let allowList = this.options.allowedCountries || [];
            if (this.options.region === 'EU') allowList = EU_COUNTRIES;
            else if (this.options.region === 'MENA') allowList = MENA_COUNTRIES;

            allowed = allowList.some((code) => code.trim().toUpperCase() === userCountry);
        } catch (err) {
            console.warn('[HopePlayer geo-checker] IP sorgusu başarısız, erişime izin veriliyor:', err);
            allowed = true;
        }

        if (this.destroyed) return;
        this.loadingEl.remove();

        if (allowed) {
            this.ctx.videoEl.removeEventListener('play', this.onPlayWhileBlocked);
            this.ctx.unblockChrome();
            return;
        }

        this.showWarning(userCountry);
    }

    private showWarning(country: string): void {
        const el = document.createElement('div');
        el.setAttribute('part', 'geo-warning');
        el.className = 'hp:absolute hp:inset-0 hp:z-40 hp:flex hp:flex-col hp:items-center hp:justify-center hp:gap-2 hp:bg-surface hp:text-on-surface hp:text-center hp:p-4';

        const messages = this.options.warningMessages?.length ? this.options.warningMessages : [this.ctx.i18n.geoDefaultWarning];
        for (const msg of messages) {
            const p = document.createElement('p');
            p.className = 'hp:text-sm hp:m-0';
            p.textContent = msg;
            el.appendChild(p);
        }

        const countryEl = document.createElement('span');
        countryEl.className = 'hp:text-xs hp:opacity-60';
        countryEl.textContent = country || this.ctx.i18n.geoUnknownCountry;
        el.appendChild(countryEl);

        this.ctx.overlayContainerEl.appendChild(el);
        // Erişim kalıcı olarak kapalı — unblockChrome() ÇAĞRILMIYOR.
    }
}
