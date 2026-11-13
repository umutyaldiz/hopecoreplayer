import { tr } from './locales/tr';
import { en } from './locales/en';
import type { CoreLocaleStrings, HopeLocale, HopeLocaleStrings } from './types';

const BUILTIN_LOCALES: Record<string, CoreLocaleStrings> = { tr, en };

/** Eklentilerin kendi metinleri — eklenti yüklenince eklenir, böylece ana pakete girmez. */
type PluginStrings = { tr: Partial<HopeLocaleStrings>; en: Partial<HopeLocaleStrings> };
const pluginStrings: PluginStrings[] = [];
const listeners = new Set<() => void>();

/** Eklenti modülü yüklenince çağrılır; açık player'lar sözlüklerini hemen tamamlar. */
export function registerLocaleStrings(strings: PluginStrings): void {
    if (pluginStrings.includes(strings)) return;
    pluginStrings.push(strings);
    for (const fn of listeners) fn();
}

/** Yeni eklenti metni gelince haber ver (player sözlüğünü yeniler). */
export function onLocaleStrings(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Paylaşılan, mutable dil sözlüğü üretir (bkz. HopePlayerElement.i18n). */
export function createLocaleStrings(locale?: HopeLocale, overrides?: Partial<HopeLocaleStrings>): HopeLocaleStrings {
    const code = locale && BUILTIN_LOCALES[locale] ? locale : 'tr';
    const base = BUILTIN_LOCALES[code]!;
    const extra = Object.assign({}, ...pluginStrings.map((p) => (code === 'en' ? p.en : p.tr))) as Partial<HopeLocaleStrings>;
    // Eklenti metinleri, eklenti yüklenince gelir — o zamana kadar okunmazlar.
    return { ...base, ...extra, ...overrides } as HopeLocaleStrings;
}

/** Var olan (mutable, paylaşılan) bir i18n objesinin alanlarını YERİNDE günceller — referansı korur. */
export function applyLocale(target: HopeLocaleStrings, locale?: HopeLocale, overrides?: Partial<HopeLocaleStrings>): void {
    Object.assign(target, createLocaleStrings(locale, overrides));
}

export { tr, en };
export type { HopeLocale, HopeLocaleStrings };
