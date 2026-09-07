import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth-store';
import { api } from '../../lib/api';
import { SUPPORTED_LANGUAGES } from '../../i18n/config';
import { Input } from '../common/input';
import { Select } from '../common/select';
import { Button } from '../common/button';
import { UserCircle2, Check } from 'lucide-react';

export function ProfileSettings() {
  const { t, i18n } = useTranslation('settings');
  const user = useAuthStore((s) => s.user);
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [language, setLanguage] = useState(user?.preferred_language ?? i18n.language);
  const [timezone, setTimezone] = useState(user?.timezone ?? 'Europe/Chisinau');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? '');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name);
      setLanguage(user.preferred_language ?? i18n.language);
      setTimezone(user.timezone ?? 'Europe/Chisinau');
      setAvatarUrl(user.avatar_url ?? '');
    }
  }, [user, i18n.language]);

  const save = useMutation({
    mutationFn: () => api.updateProfile({ display_name: displayName, preferred_language: language, timezone, avatar_url: avatarUrl || undefined }),
    onSuccess: (updated) => {
      useAuthStore.setState((state) => ({ user: state.user ? { ...state.user, ...updated } : state.user }));
      if (updated.preferred_language) i18n.changeLanguage(updated.preferred_language);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div className="p-6 max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('profile.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('profile.subtitle')}</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
            {avatarUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img src={avatarUrl} className="w-full h-full object-cover" />
            ) : (
              <UserCircle2 className="w-10 h-10 text-slate-400" />
            )}
          </div>
          <div className="flex-1">
            <Input label={t('profile.avatar_url')} value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>

        <Input label={t('profile.display_name')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <Input label={t('profile.email')} value={user?.email ?? ''} disabled />

        <div className="grid grid-cols-2 gap-4">
          <Select
            label={t('profile.language')}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            options={SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: `${l.flag} ${l.label}` }))}
          />
          <Input label={t('profile.timezone')} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Chisinau" />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={save.isPending}>{t('profile.save')}</Button>
          {saved && <span className="text-sm text-emerald-600 flex items-center gap-1"><Check className="w-4 h-4" /> {t('profile.saved')}</span>}
        </div>
      </form>
    </div>
  );
}
