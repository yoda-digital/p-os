import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Button } from '../common/button';
import { Input } from '../common/input';
import { Dialog } from '../common/dialog';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Building2, Plus, Ban, CheckCircle2, Search } from 'lucide-react';

export function AdminOrganizations() {
  const { t, i18n } = useTranslation('admin');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const { data: orgs, isLoading } = useQuery({ queryKey: ['admin', 'organizations'], queryFn: api.listAdminOrgs });

  const createOrg = useMutation({
    mutationFn: () => api.createAdminOrg({ name, slug: slug || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      setCreateOpen(false);
      setName('');
      setSlug('');
    },
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.updateAdminOrg(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'organizations'] }),
  });

  if (isLoading) return <FullPageSpinner />;

  const filtered = (orgs ?? []).filter((o) =>
    !search || o.name.toLowerCase().includes(search.toLowerCase()) || o.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('organizations.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('organizations.subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> {t('organizations.new')}
        </Button>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('organizations.search_placeholder')} className="pl-9" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Building2 className="w-12 h-12" />} title={t('organizations.empty.title')} description={t('organizations.empty.description')} action={{ label: t('organizations.new'), onClick: () => setCreateOpen(true) }} />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">{t('organizations.name')}</th>
                <th className="px-4 py-3 font-medium">{t('organizations.slug')}</th>
                <th className="px-4 py-3 font-medium">{t('organizations.status')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('organizations.users')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('organizations.cases')}</th>
                <th className="px-4 py-3 font-medium">{t('organizations.created')}</th>
                <th className="px-4 py-3 font-medium text-right">{tCommon('actions.edit')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {o.name} {o.is_system && <Badge variant="purple" className="ml-1">{t('organizations.system')}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{o.slug}</td>
                  <td className="px-4 py-3"><Badge variant={o.status === 'active' ? 'success' : 'danger'}>{o.status}</Badge></td>
                  <td className="px-4 py-3 text-right">{o.user_count}</td>
                  <td className="px-4 py-3 text-right">{o.case_count}</td>
                  <td className="px-4 py-3 text-slate-400 dark:text-slate-500">{new Date(o.created_at).toLocaleDateString(i18n.language)}</td>
                  <td className="px-4 py-3 text-right">
                    {!o.is_system && (
                      o.status === 'active' ? (
                        <Button size="sm" variant="ghost" loading={toggleStatus.isPending} onClick={() => toggleStatus.mutate({ id: o.id, status: 'disabled' })}>
                          <Ban className="w-3.5 h-3.5" /> {t('organizations.disable')}
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" loading={toggleStatus.isPending} onClick={() => toggleStatus.mutate({ id: o.id, status: 'active' })}>
                          <CheckCircle2 className="w-3.5 h-3.5" /> {t('organizations.enable')}
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('organizations.new')}>
        <form onSubmit={(e) => { e.preventDefault(); createOrg.mutate(); }} className="space-y-4">
          <Input label={t('organizations.name')} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <Input label={t('organizations.slug')} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={t('organizations.slug_placeholder')} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>{tCommon('actions.cancel')}</Button>
            <Button type="submit" loading={createOrg.isPending}>{tCommon('actions.create')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
