import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Invitation } from '../../lib/api';
import { Button } from '../common/button';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Mail, RotateCcw, Ban } from 'lucide-react';

const statusVariant: Record<string, string> = { pending: 'warning', accepted: 'success', revoked: 'neutral', expired: 'danger' };
const filters = ['all', 'pending', 'accepted', 'revoked', 'expired'] as const;

export function InvitationManagement() {
  const { t, i18n } = useTranslation('settings');
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof filters)[number]>('pending');

  const { data: invitations, isLoading } = useQuery({
    queryKey: ['invitations', filter],
    queryFn: () => api.listInvitations(filter === 'all' ? undefined : filter),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });

  // No dedicated "resend" endpoint exists on the backend — resend is composed
  // client-side as revoke + re-create with the same email/role/team.
  const resend = useMutation({
    mutationFn: async (inv: Invitation) => {
      await api.revokeInvitation(inv.id);
      await api.createInvitation({ email: inv.email, role: inv.role, team_id: inv.team_id, workspace_id: inv.workspace_id, message: inv.message });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });

  if (isLoading) return <FullPageSpinner />;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('invitations.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('invitations.subtitle')}</p>
      </div>

      <div className="flex gap-2 mb-6">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors capitalize ${
              filter === f
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t(`invitations.filters.${f}`)}
          </button>
        ))}
      </div>

      {(!invitations || invitations.length === 0) ? (
        <EmptyState icon={<Mail className="w-12 h-12" />} title={t('invitations.empty.title')} description={t('invitations.empty.description')} />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">{t('invitations.email')}</th>
                <th className="px-4 py-3 font-medium">{t('invitations.role')}</th>
                <th className="px-4 py-3 font-medium">{t('invitations.status')}</th>
                <th className="px-4 py-3 font-medium">{t('invitations.invited_by')}</th>
                <th className="px-4 py-3 font-medium">{t('invitations.expires')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('invitations.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{inv.email}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{inv.role}</td>
                  <td className="px-4 py-3"><Badge variant={statusVariant[inv.status] as any}>{t(`invitations.filters.${inv.status}`, { defaultValue: inv.status })}</Badge></td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{inv.invited_by_name ?? inv.invited_by_email ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 dark:text-slate-500">{new Date(inv.expires_at).toLocaleDateString(i18n.language)}</td>
                  <td className="px-4 py-3">
                    {inv.status === 'pending' && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title={t('invitations.resend')} loading={resend.isPending} onClick={() => resend.mutate(inv)}>
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" title={t('invitations.revoke')} loading={revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                          <Ban className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      </div>
                    )}
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
