import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Package } from 'lucide-react';

export function AdminPacks() {
  const { t, i18n } = useTranslation('admin');
  const { data: packs, isLoading } = useQuery({ queryKey: ['admin', 'packs'], queryFn: api.listPacks });

  if (isLoading) return <FullPageSpinner />;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('packs.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('packs.subtitle')}</p>
      </div>

      {(!packs || packs.length === 0) ? (
        <EmptyState icon={<Package className="w-12 h-12" />} title={t('packs.empty.title')} description={t('packs.empty.description')} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packs.map((p) => (
            <div key={p.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">{p.name}</h3>
                <Badge variant="info">v{p.version}</Badge>
              </div>
              <Badge variant="neutral">{p.domain}</Badge>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
                {t('packs.created')} {new Date(p.created_at).toLocaleDateString(i18n.language)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
