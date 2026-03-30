import { en } from './en';
import { es } from './es';
import type { Translations } from './en';

export type Lang = 'en' | 'es';

const translations: Record<Lang, Translations> = { en, es };

export function useTranslations(lang: Lang): Translations {
  return translations[lang] ?? translations.en;
}

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/').filter(Boolean);
  if (lang === 'es') return 'es';
  return 'en';
}

export function getAlternateLang(lang: Lang): Lang {
  return lang === 'en' ? 'es' : 'en';
}

export function localePath(lang: Lang, path: string, base: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}/${lang}${clean}`;
}
