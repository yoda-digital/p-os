import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth-store';
import { Input } from '../common/input';
import { Button } from '../common/button';
import { Hexagon } from 'lucide-react';

export function RegisterPage() {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const register = useAuthStore((s) => s.register);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setLocalError(t('register.password_mismatch'));
      return;
    }
    setLocalError('');
    try {
      await register(email, password, displayName);
      navigate('/');
    } catch {
      // error handled in store
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Hexagon className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('register.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('register.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          {displayError && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
              {displayError}
            </div>
          )}
          <Input
            label={t('register.display_name_label')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('register.display_name_placeholder')}
            required
            autoFocus
          />
          <Input
            label={t('register.email_label')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('register.email_placeholder')}
            required
          />
          <Input
            label={t('register.password_label')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('register.password_placeholder')}
            required
            minLength={8}
          />
          <Input
            label={t('register.confirm_password_label')}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('register.confirm_password_placeholder')}
            required
          />
          <Button type="submit" loading={loading} className="w-full">
            {t('register.submit')}
          </Button>
          <p className="text-sm text-center text-slate-500 dark:text-slate-400">
            {t('register.have_account')}{' '}
            <Link to="/login" className="text-emerald-600 hover:text-emerald-700 font-medium">
              {t('register.sign_in_link')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
