import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '../../shared/i18n';
import { useAppStore } from '../stores/appStore';

type I18nProviderProps = {
  children: ReactNode;
};

export function I18nProvider({ children }: I18nProviderProps) {
  const language = useAppStore((state) => state.language);

  useEffect(() => {
    document.documentElement.lang = language;

    if (i18n.resolvedLanguage !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
