import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Package, Gauge } from 'lucide-react';
import { Badge } from '../common/badge';

export function ResourcesView() {
  const { t } = useTranslation('resources');
  const { caseId } = useParams<{ caseId: string }>();
  const { data: resources, isLoading } = useQuery({
    queryKey: ['resources', caseId],
    queryFn: () => api.listResources(caseId!),
    enabled: !!caseId,
  });

  if (isLoading) return <FullPageSpinner />;
  if (!resources || resources.length === 0) {
    return <EmptyState icon={<Package className="w-12 h-12" />} title={t('empty.title')} description={t('empty.description')} />;
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Package className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('table.name')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('table.type')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('table.capacity')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('table.available')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('table.utilization')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('table.cost')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {resources.map(r => {
              const cap = typeof r.capacity === 'number' ? r.capacity : null;
              const avail = typeof r.available === 'number' ? r.available : null;
              const utilization = cap && avail != null ? ((cap - avail) / cap) * 100 : null;
              return (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{r.name}</td>
                  <td className="px-4 py-3 text-slate-500">
                    <Badge variant="neutral">{r.type}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{cap ?? JSON.stringify(r.capacity)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{avail ?? JSON.stringify(r.available)}</td>
                  <td className="px-4 py-3">
                    {utilization != null ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden max-w-[100px]">
                          <div
                            className={`h-full rounded-full ${utilization > 80 ? 'bg-red-500' : utilization > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${utilization}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">{utilization.toFixed(0)}%</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.cost_per_unit ? JSON.stringify(r.cost_per_unit) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
