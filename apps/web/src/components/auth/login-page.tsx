import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth-store';
import { Input } from '../common/input';
import { Button } from '../common/button';
import { Hexagon } from 'lucide-react';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      navigate('/');
    } catch {
      // error is set in the store
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Hexagon className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('login.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('login.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
              {error}
            </div>
          )}
          <Input
            label={t('login.email_label')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('login.email_placeholder')}
            required
            autoFocus
          />
          <Input
            label={t('login.password_label')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('login.password_placeholder')}
            required
          />
          <Button type="submit" loading={loading} className="w-full">
            {t('login.submit')}
          </Button>
          <p className="text-sm text-center text-slate-500 dark:text-slate-400">
            {t('login.no_account')}{' '}
            <Link to="/register" className="text-emerald-600 hover:text-emerald-700 font-medium">
              {t('login.sign_up_link')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
