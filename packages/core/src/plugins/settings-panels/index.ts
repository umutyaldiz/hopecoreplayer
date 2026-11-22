// Ayarlar menüsünün az açılan panelleri (hız, altyazı görünümü) — ana pakete girmez.
import type { SettingsMenu } from '../../controls/SettingsMenu';
import { registerLocaleStrings } from '../../i18n';
import { adoptStyle } from '../../utils/plugin-style';
import css from './settings-panels.css?inline';

registerLocaleStrings({
    tr: { speedDown: 'Yavaşlat', speedUp: 'Hızlandır' },
    en: { speedDown: 'Slower', speedUp: 'Faster' },
});

/** İnce ayar adımı. */
const STEP = 0.05;

const checkIcon = (): HTMLElement => {
    const i = document.createElement('i');
    i.className = 'hp-icon hp-icon-check';
    return i;
};

/** Ayarlar menüsü bu parçada çizilen panele geçer. */
export function renderPanel(menu: SettingsMenu, id: string): void {
    if (id === 'speed') speed(menu);
    else if (id === 'captions-settings') captionSettings(menu);
    else if (id === 'captions-size') captionsSize(menu);
    else if (id === 'captions-bg' || id === 'captions-text') captionColors(menu, id === 'captions-bg' ? 'bg' : 'text');
}

/** Çalma hızı: büyük değer, −/+ ve kaydırıcı (0.05 adım), hazır hızlar. Menü açık kalır. */
function speed(menu: SettingsMenu): void {
    const { panel, video, labels } = menu;
    const rates = menu.playbackRates;
    adoptStyle(panel, 'settings-panels', css);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    // WebKit duraklatılmışken ratechange'i geciktirir — panel hemen güncellenir.
    const set = (r: number): void => {
        video.playbackRate = Number(Math.min(max, Math.max(min, Math.round(r / STEP) * STEP)).toFixed(2));
        sync();
    };

    const wrap = document.createElement('div');
    wrap.className = 'hp-speed';
    const value = document.createElement('div');
    value.className = 'hp-speed-value';
    value.setAttribute('aria-live', 'polite');

    const step = (dir: -1 | 1): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hp-speed-step';
        b.textContent = dir < 0 ? '−' : '+';
        b.setAttribute('aria-label', dir < 0 ? labels.speedDown : labels.speedUp);
        b.addEventListener('click', () => set(video.playbackRate + dir * STEP));
        return b;
    };
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'hp-speed-range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(STEP);
    range.setAttribute('aria-label', labels.playbackSpeed);
    range.addEventListener('input', () => set(Number(range.value)));
    const down = step(-1);
    const up = step(1);
    const row = document.createElement('div');
    row.className = 'hp-speed-row';
    row.append(down, range, up);

    const chips = document.createElement('div');
    chips.className = 'hp-speed-chips';
    const chipEls = rates.map((r) => {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'hp-speed-chip';
        c.textContent = r === 1 ? labels.normal : String(r);
        c.addEventListener('click', () => set(r));
        chips.appendChild(c);
        return c;
    });

    const sync = (): void => {
        // Panel başka bir panelle değişince dinleyici kendini kaldırır.
        if (!wrap.isConnected) return video.removeEventListener('ratechange', sync);
        const r = video.playbackRate;
        value.textContent = `${r.toFixed(2)}x`;
        range.value = String(r);
        range.style.setProperty('--hp-speed-fill', `${((r - min) / (max - min || 1)) * 100}%`);
        down.disabled = r <= min + 1e-6;
        up.disabled = r >= max - 1e-6;
        chipEls.forEach((c, i) => c.toggleAttribute('data-active', Math.abs(rates[i]! - r) < 1e-6));
    };

    wrap.append(value, row, chips);
    panel.innerHTML = '';
    panel.append(menu.backRow(labels.playbackSpeed, () => menu.renderMain()), wrap);
    video.addEventListener('ratechange', sync);
    sync();
}

const go = (menu: SettingsMenu, id: 'captions-settings' | 'captions-size' | 'captions-bg' | 'captions-text'): void => {
    menu.currentPanel = id;
    renderPanel(menu, id);
};

/** Altyazı → Altyazı ayarları: boyut, arka plan / yazı rengi, konumu sıfırla — her satırda o anki değer. */
function captionSettings(menu: SettingsMenu): void {
    const { panel, labels } = menu;
    panel.innerHTML = '';
    panel.appendChild(
        menu.backRow(labels.captionSettings, () => {
            menu.currentPanel = 'captions';
            menu.renderCaptions();
        })
    );
    const appearance = menu.captionAppearance;
    if (!appearance) return;
    const dot = (color: string | undefined): string | Node => {
        if (!color) return '';
        const el = document.createElement('span');
        el.className = 'hp:inline-block hp:w-3 hp:h-3 hp:rounded-full hp:border hp:border-on-surface/30';
        el.style.background = color;
        return el;
    };
    panel.appendChild(menu.row(appearance.sizeLabel, appearance.getSizeOptions().find((o) => o.active)?.label ?? '', () => go(menu, 'captions-size')));
    panel.appendChild(menu.row(appearance.bgColorLabel, dot(appearance.getBgColorOptions().find((o) => o.active)?.value), () => go(menu, 'captions-bg')));
    panel.appendChild(menu.row(appearance.textColorLabel, dot(appearance.getTextColorOptions().find((o) => o.active)?.value), () => go(menu, 'captions-text')));
    panel.appendChild(
        menu.row(appearance.resetPositionLabel, '', () => {
            appearance.onResetPosition();
            menu.close();
        })
    );
}

function captionsSize(menu: SettingsMenu): void {
    const { panel } = menu;
    const appearance = menu.captionAppearance;
    panel.innerHTML = '';
    panel.appendChild(menu.backRow(appearance?.sizeLabel ?? menu.labels.captionSize, () => go(menu, 'captions-settings')));
    if (!appearance) return;
    for (const item of appearance.getSizeOptions()) {
        panel.appendChild(
            menu.row(item.label, item.active ? checkIcon() : '', () => {
                item.onSelect();
                menu.close();
            })
        );
    }
}

/** "Arka Plan Rengi" / "Yazı Rengi" — renkli swatch ızgarası. */
function captionColors(menu: SettingsMenu, kind: 'bg' | 'text'): void {
    const { panel, labels } = menu;
    const appearance = menu.captionAppearance;
    panel.innerHTML = '';
    const title = kind === 'bg' ? (appearance?.bgColorLabel ?? labels.captionBgColor) : (appearance?.textColorLabel ?? labels.captionTextColor);
    panel.appendChild(menu.backRow(title, () => go(menu, 'captions-settings')));
    if (!appearance) return;

    const grid = document.createElement('div');
    grid.className = 'hp:flex hp:flex-wrap hp:gap-2 hp:px-3 hp:py-2';
    for (const opt of kind === 'bg' ? appearance.getBgColorOptions() : appearance.getTextColorOptions()) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.setAttribute('aria-label', opt.ariaLabel);
        swatch.className = 'hp:w-7 hp:h-7 hp:rounded-full hp:cursor-pointer hp:flex-shrink-0 hp:border hp:border-on-surface/20';
        swatch.style.background = opt.value;
        swatch.style.outline = opt.active ? '2px solid currentColor' : '2px solid transparent';
        swatch.style.outlineOffset = '2px';
        swatch.addEventListener('click', () => {
            opt.onSelect();
            captionColors(menu, kind);
        });
        grid.appendChild(swatch);
    }
    panel.appendChild(grid);
}
