import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Hexagon, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Input } from '../common/input';
import { Button } from '../common/button';

const CODE_LENGTH = 6;

/**
 * Device pairing page (spec section 8) — `<control_plane_url>/pair`.
 *
 * An already-authenticated user lands here (directly, or after opening the
 * URL a paired-but-unconfirmed plugin printed), enters the 6-character
 * pairing code shown by the plugin, and confirms it. The device polling for
 * that confirmation (`plugin/claude-code/src/pairing/flow.ts`) then stores
 * its device identity locally.
 */
export function PairingPage() {
  const { t } = useTranslation('auth');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const normalizedCode = code.trim().toUpperCase();
  const canSubmit = normalizedCode.length === CODE_LENGTH && status !== 'loading';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus('loading');
    setError(null);
    try {
      await api.confirmPairing(normalizedCode);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : t('pairing.error_generic'));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Hexagon className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('pairing.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('pairing.subtitle')}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
          {status === 'success' ? (
            <div className="text-center space-y-3 py-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <p className="text-sm font-medium text-slate-900 dark:text-white">{t('pairing.success_title')}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('pairing.success_message')}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {status === 'error' && error && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
                  {error}
                </div>
              )}
              <Input
                label={t('pairing.code_label')}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, CODE_LENGTH))}
                placeholder={t('pairing.code_placeholder')}
                maxLength={CODE_LENGTH}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="text-center text-lg tracking-[0.5em] font-mono uppercase"
                required
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('pairing.hint')}</p>
              <Button type="submit" loading={status === 'loading'} disabled={!canSubmit} className="w-full">
                {t('pairing.submit')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
