import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import enTranslations from "./locales/en.json";
import frTranslations from "./locales/fr.json";

const LANGUAGE_STORAGE_KEY = "uiLanguage";

const translations = {
  en: enTranslations || {},
  fr: frTranslations || {},
};

const getInitialLanguage = () => {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "fr" || stored === "en") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "en";
};

const interpolate = (template, vars) => {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
};

const translate = (language, key, vars) => {
  const map = translations[language] || {};
  const template = map[key] || key;
  return interpolate(template, vars);
};

const I18nContext = createContext({
  language: "en",
  setLanguage: () => {},
  t: (key, vars) => translate("en", key, vars),
  locale: "en-US",
});

export const I18nProvider = ({ children }) => {
  const [language, setLanguage] = useState(getInitialLanguage);

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  const locale = language === "fr" ? "fr-FR" : "en-US";

  const t = useCallback(
    (key, vars) => translate(language, key, vars),
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      locale,
    }),
    [language, t, locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
