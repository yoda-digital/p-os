import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { FullPageSpinner } from '../common/spinner';
import { Zap, Users2, ScrollText, Database, RefreshCw } from 'lucide-react';

export function AdminHealth() {
  const { t, i18n } = useTranslation('admin');
  const { data: health, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'health', 'live'],
    queryFn: api.getAdminHealth,
    refetchInterval: 15_000,
  });

  if (isLoading) return <FullPageSpinner />;

  const cards = [
    { key: 'total_events', value: health?.events.total_events ?? 0, icon: Zap },
    { key: 'active_sessions', value: health?.users.daily_active ?? 0, icon: Users2 },
    { key: 'audit_24h', value: health?.audit.audit_entries_24h ?? 0, icon: ScrollText },
    { key: 'audit_total', value: health?.audit.total_audit_entries ?? 0, icon: Database },
  ] as const;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('health.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t('health.last_updated')} {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString(i18n.language) : '—'}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
          title={t('health.refresh')}
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(({ key, value, icon: Icon }) => (
          <div key={key} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30">
              <Icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{Number(value).toLocaleString(i18n.language)}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t(`health.cards.${key}`)}</p>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('health.db_stats')}</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase text-slate-500 dark:text-slate-400">
              <th className="px-4 py-3 font-medium">{t('health.table_name')}</th>
              <th className="px-4 py-3 font-medium text-right">{t('health.row_count')}</th>
              <th className="px-4 py-3 font-medium text-right">{t('health.total_size')}</th>
            </tr>
          </thead>
          <tbody>
            {(health?.tables ?? []).map((row) => (
              <tr key={row.table_name} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.table_name}</td>
                <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">{Number(row.row_count).toLocaleString(i18n.language)}</td>
                <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">{row.total_size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
