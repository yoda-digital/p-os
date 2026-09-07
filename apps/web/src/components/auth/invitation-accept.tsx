import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth-store';
import { api, ApiError } from '../../lib/api';
import { Button } from '../common/button';
import { Hexagon, Mail, CheckCircle2 } from 'lucide-react';

export function InvitationAccept() {
  const { t } = useTranslation('auth');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => !!s.token);
  const [accepted, setAccepted] = useState(false);

  const accept = useMutation({
    mutationFn: () => api.acceptInvitation(token!),
    onSuccess: () => setAccepted(true),
  });

  const errorMessage = accept.error
    ? (accept.error instanceof ApiError ? accept.error.message : t('invite.generic_error'))
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Hexagon className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('invite.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('invite.subtitle')}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 space-y-4 text-center">
          {accepted ? (
            <>
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <p className="text-sm text-slate-700 dark:text-slate-300">{t('invite.success')}</p>
              <Button className="w-full" onClick={() => navigate('/cases')}>{t('invite.go_to_app')}</Button>
            </>
          ) : !isAuthenticated ? (
            <>
              <Mail className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('invite.sign_in_required')}</p>
              <div className="flex flex-col gap-2">
                <Button className="w-full" onClick={() => navigate('/login')}>{t('invite.sign_in')}</Button>
                <Button variant="secondary" className="w-full" onClick={() => navigate('/register')}>{t('invite.create_account')}</Button>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500">{t('invite.return_hint')}</p>
            </>
          ) : (
            <>
              <Mail className="w-10 h-10 text-emerald-600 mx-auto" />
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('invite.prompt')}</p>
              {errorMessage && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">{errorMessage}</div>
              )}
              <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>{t('invite.accept')}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
