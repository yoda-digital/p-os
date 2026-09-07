import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type AdminUser } from '../../lib/api';
import { Input } from '../common/input';
import { Select } from '../common/select';
import { Button } from '../common/button';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Users, Search, Ban, CheckCircle2, PauseCircle } from 'lucide-react';

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';
const SYSTEM_ROLES = ['', 'superadmin', 'support', 'auditor'] as const;

const statusVariant: Record<string, string> = { active: 'success', suspended: 'warning', disabled: 'danger' };

export function AdminUsers() {
  const { t, i18n } = useTranslation('admin');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', search, status],
    queryFn: () => api.listAdminUsers({ search: search || undefined, status: status || undefined, limit: 100 }),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateAdminUser>[1] }) => api.updateAdminUser(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const systemRole = (u: AdminUser) => u.memberships?.find((m) => m.organization_id === SYSTEM_ORG_ID)?.role ?? '';

  if (isLoading) return <FullPageSpinner />;
  const users = data?.users ?? [];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('users.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('users.subtitle')}</p>
      </div>

      <div className="flex gap-3 mb-4 max-w-lg">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('users.search_placeholder')} className="pl-9" />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: t('users.all_statuses') },
            { value: 'active', label: t('users.status_values.active') },
            { value: 'suspended', label: t('users.status_values.suspended') },
            { value: 'disabled', label: t('users.status_values.disabled') },
          ]}
          className="w-40"
        />
      </div>

      {users.length === 0 ? (
        <EmptyState icon={<Users className="w-12 h-12" />} title={t('users.empty.title')} description={t('users.empty.description')} />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">{t('users.name')}</th>
                <th className="px-4 py-3 font-medium">{t('users.email')}</th>
                <th className="px-4 py-3 font-medium">{t('users.status')}</th>
                <th className="px-4 py-3 font-medium">{t('users.system_role')}</th>
                <th className="px-4 py-3 font-medium">{t('users.last_active')}</th>
                <th className="px-4 py-3 font-medium text-right">{tCommon('actions.edit')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{u.display_name}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{u.email}</td>
                  <td className="px-4 py-3"><Badge variant={statusVariant[u.status] as any}>{t(`users.status_values.${u.status}`, { defaultValue: u.status })}</Badge></td>
                  <td className="px-4 py-3">
                    <Select
                      value={systemRole(u)}
                      onChange={(e) => update.mutate({ id: u.id, data: { roles: e.target.value ? [e.target.value] : [] } })}
                      options={SYSTEM_ROLES.map((r) => ({ value: r, label: r ? t(`users.roles.${r}`) : t('users.roles.none') }))}
                      className="min-w-[9rem]"
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-400 dark:text-slate-500">{u.last_login_at ? new Date(u.last_login_at).toLocaleString(i18n.language) : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {u.status !== 'suspended' && (
                        <Button size="sm" variant="ghost" title={t('users.suspend')} loading={update.isPending} onClick={() => update.mutate({ id: u.id, data: { status: 'suspended' } })}>
                          <PauseCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {u.status !== 'disabled' && (
                        <Button size="sm" variant="ghost" title={t('users.disable')} loading={update.isPending} onClick={() => update.mutate({ id: u.id, data: { status: 'disabled' } })}>
                          <Ban className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {u.status !== 'active' && (
                        <Button size="sm" variant="ghost" title={t('users.reactivate')} loading={update.isPending} onClick={() => update.mutate({ id: u.id, data: { status: 'active' } })}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
