import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { FullPageSpinner } from '../common/spinner';
import { Badge } from '../common/badge';
import { Building2, Users, FolderOpen, Zap, Clock } from 'lucide-react';

export function AdminDashboard() {
  const { t, i18n } = useTranslation('admin');
  const { data: health, isLoading } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: api.getAdminHealth,
    refetchInterval: 30_000,
  });
  const { data: recent } = useQuery({
    queryKey: ['admin', 'audit', 'recent'],
    queryFn: () => api.listAudit({ limit: 8 }),
  });

  if (isLoading) return <FullPageSpinner />;

  const cards = [
    { key: 'organizations', value: health?.organizations.total_organizations ?? 0, icon: Building2, color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' },
    { key: 'users', value: health?.users.total_users ?? 0, icon: Users, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30' },
    { key: 'cases', value: health?.cases.total_cases ?? 0, icon: FolderOpen, color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/30' },
    { key: 'events', value: health?.events.total_events ?? 0, icon: Zap, color: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30' },
  ] as const;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('dashboard.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('dashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(({ key, value, icon: Icon, color }) => (
          <div key={key} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{Number(value).toLocaleString(i18n.language)}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t(`dashboard.cards.${key}`)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">{t('dashboard.active_users')}</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">{t('dashboard.daily_active')}</span><span className="font-medium text-slate-900 dark:text-white">{health?.users.daily_active ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">{t('dashboard.weekly_active')}</span><span className="font-medium text-slate-900 dark:text-white">{health?.users.weekly_active ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">{t('dashboard.monthly_active')}</span><span className="font-medium text-slate-900 dark:text-white">{health?.users.monthly_active ?? 0}</span></div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">{t('dashboard.audit_activity')}</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">{t('dashboard.total_entries')}</span><span className="font-medium text-slate-900 dark:text-white">{health?.audit.total_audit_entries ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">{t('dashboard.entries_24h')}</span><span className="font-medium text-slate-900 dark:text-white">{health?.audit.audit_entries_24h ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">{t('dashboard.active_cases')}</span><span className="font-medium text-slate-900 dark:text-white">{health?.cases.active_cases ?? 0}</span></div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">{t('dashboard.recent_activity')}</h3>
        {(!recent || recent.entries.length === 0) ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">{t('audit.empty.title')}</p>
        ) : (
          <ul className="space-y-2">
            {recent.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm border-b border-slate-100 dark:border-slate-800 last:border-0 pb-2 last:pb-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="neutral">{e.action}</Badge>
                  <span className="text-slate-500 dark:text-slate-400 truncate">{e.actor_email}</span>
                </div>
                <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500 shrink-0">
                  <Clock className="w-3 h-3" />
                  {new Date(e.created_at).toLocaleString(i18n.language)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
