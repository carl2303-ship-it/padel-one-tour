import React, { createContext, useContext, useState } from 'react';
import { translations, Language, TranslationKey } from './translations';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKey;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const STORAGE_KEY = 'padel_tournament_language';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in translations) {
      return stored as Language;
    }
    const browserLang = navigator.language.split('-')[0];
    if (browserLang in translations) {
      return browserLang as Language;
    }
    return 'en';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  };

  const value: I18nContextType = {
    language,
    setLanguage,
    t: translations[language],
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
