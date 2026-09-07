import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Input } from '../common/input';
import { Button } from '../common/button';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 50;

export function AdminAudit() {
  const { t, i18n } = useTranslation('admin');
  const { t: tCommon } = useTranslation('common');
  const [filters, setFilters] = useState({ action: '', resource_type: '', actor_id: '', from: '', to: '' });
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit', filters, offset],
    queryFn: () => api.listAudit({
      action: filters.action || undefined,
      resource_type: filters.resource_type || undefined,
      actor_id: filters.actor_id || undefined,
      from: filters.from ? new Date(filters.from).toISOString() : undefined,
      to: filters.to ? new Date(filters.to).toISOString() : undefined,
      limit: PAGE_SIZE,
      offset,
    }),
  });

  const setFilter = (key: keyof typeof filters, value: string) => {
    setOffset(0);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const entries = data?.entries ?? [];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('audit.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('audit.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <Input label={t('audit.action')} value={filters.action} onChange={(e) => setFilter('action', e.target.value)} placeholder={t('audit.action_placeholder')} />
        <Input label={t('audit.resource_type')} value={filters.resource_type} onChange={(e) => setFilter('resource_type', e.target.value)} placeholder={t('audit.resource_type_placeholder')} />
        <Input label={t('audit.actor_id')} value={filters.actor_id} onChange={(e) => setFilter('actor_id', e.target.value)} placeholder={t('audit.actor_id_placeholder')} />
        <Input label={t('audit.from')} type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
        <Input label={t('audit.to')} type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
      </div>

      {isLoading ? (
        <FullPageSpinner />
      ) : entries.length === 0 ? (
        <EmptyState icon={<ScrollText className="w-12 h-12" />} title={t('audit.empty.title')} description={t('audit.empty.description')} />
      ) : (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">{t('audit.timestamp')}</th>
                  <th className="px-4 py-3 font-medium">{t('audit.actor')}</th>
                  <th className="px-4 py-3 font-medium">{t('audit.action')}</th>
                  <th className="px-4 py-3 font-medium">{t('audit.resource')}</th>
                  <th className="px-4 py-3 font-medium">{t('audit.details')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0 align-top">
                    <td className="px-4 py-3 text-slate-400 dark:text-slate-500 whitespace-nowrap">{new Date(e.created_at).toLocaleString(i18n.language)}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {e.actor_email}
                      {e.impersonated_by && <Badge variant="warning" className="ml-1">{t('audit.impersonated')}</Badge>}
                    </td>
                    <td className="px-4 py-3"><Badge variant="info">{e.action}</Badge></td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{e.resource_type}{e.resource_id ? ` · ${e.resource_id.slice(0, 8)}` : ''}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500 max-w-xs truncate" title={JSON.stringify(e.details)}>
                      {JSON.stringify(e.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-slate-400 dark:text-slate-500">{t('audit.showing', { count: entries.length, offset })}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                <ChevronLeft className="w-4 h-4" /> {tCommon('actions.previous')}
              </Button>
              <Button size="sm" variant="secondary" disabled={entries.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>
                {tCommon('actions.next')} <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
