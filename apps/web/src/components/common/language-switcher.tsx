import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n/config';
import { api } from '../../lib/api';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0]!;

  const handleChange = async (lang: SupportedLanguage) => {
    await i18n.changeLanguage(lang);
    try {
      localStorage.setItem('pos_language', lang);
    } catch {
      // localStorage unavailable
    }
    try {
      await api.updateProfile({ preferred_language: lang });
    } catch {
      /* offline ok */
    }
  };

  return (
    <div className="relative group">
      <button className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-sm">
        <span>{current.flag}</span>
        <span className="hidden sm:inline">{current.label}</span>
      </button>
      <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg hidden group-hover:block z-50 min-w-[140px]">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handleChange(lang.code)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 ${
              lang.code === i18n.language ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : ''
            }`}
          >
            <span>{lang.flag}</span> {lang.label}
          </button>
        ))}
      </div>
    </div>
  );
}
