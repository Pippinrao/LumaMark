import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export const defaultLanguage = 'en';
export const supportedLanguages = ['en', 'zh-CN'] as const;

export type AppLanguage = (typeof supportedLanguages)[number];

export const resources = {
  en: {
    translation: en,
  },
  'zh-CN': {
    translation: zhCN,
  },
} as const;

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  fallbackLng: [defaultLanguage],
  interpolation: {
    escapeValue: false,
  },
  lng: defaultLanguage,
  resources,
  returnEmptyString: false,
});
