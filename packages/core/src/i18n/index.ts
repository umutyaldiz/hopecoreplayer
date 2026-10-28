import { tr } from './locales/tr';
import { en } from './locales/en';
import type { HopeLocale, HopeLocaleStrings } from './types';

const BUILTIN_LOCALES: Record<string, HopeLocaleStrings> = { tr, en };

/** Paylaşılan, mutable dil sözlüğü üretir (bkz. HopePlayerElement.i18n). */
export function createLocaleStrings(locale?: HopeLocale, overrides?: Partial<HopeLocaleStrings>): HopeLocaleStrings {
    const base = BUILTIN_LOCALES[locale ?? 'tr'] ?? tr;
    return { ...base, ...overrides };
}

/** Var olan (mutable, paylaşılan) bir i18n objesinin alanlarını YERİNDE günceller — referansı korur. */
export function applyLocale(target: HopeLocaleStrings, locale?: HopeLocale, overrides?: Partial<HopeLocaleStrings>): void {
    Object.assign(target, createLocaleStrings(locale, overrides));
}

export { tr, en };
export type { HopeLocale, HopeLocaleStrings };
