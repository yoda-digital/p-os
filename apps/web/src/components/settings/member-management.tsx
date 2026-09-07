import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Button } from '../common/button';
import { Input } from '../common/input';
import { Select } from '../common/select';
import { Dialog } from '../common/dialog';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Users, UserPlus, UserMinus } from 'lucide-react';

const ORG_ROLES = ['org_owner', 'org_admin', 'org_manager', 'org_member', 'org_viewer', 'org_billing'];

export function MemberManagement() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();
  const { data: members, isLoading } = useQuery({ queryKey: ['members'], queryFn: api.listMembers });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('org_member');

  const invite = useMutation({
    mutationFn: () => api.createInvitation({ email, role }),
    onSuccess: () => { setInviteOpen(false); setEmail(''); setRole('org_member'); qc.invalidateQueries({ queryKey: ['invitations'] }); },
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.updateMember(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removeMember(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });

  if (isLoading) return <FullPageSpinner />;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('members.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('members.subtitle')}</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}><UserPlus className="w-4 h-4" /> {t('members.invite')}</Button>
      </div>

      {(!members || members.length === 0) ? (
        <EmptyState icon={<Users className="w-12 h-12" />} title={t('members.empty.title')} description={t('members.empty.description')} action={{ label: t('members.invite'), onClick: () => setInviteOpen(true) }} />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">{t('members.name')}</th>
                <th className="px-4 py-3 font-medium">{t('members.email')}</th>
                <th className="px-4 py-3 font-medium">{t('members.status')}</th>
                <th className="px-4 py-3 font-medium">{t('members.teams')}</th>
                <th className="px-4 py-3 font-medium">{t('members.role')}</th>
                <th className="px-4 py-3 font-medium text-right">{tCommon('actions.delete')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{m.display_name}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{m.email}</td>
                  <td className="px-4 py-3"><Badge variant={m.status === 'active' ? 'success' : 'neutral'}>{m.status}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(m.teams ?? []).map((team) => <Badge key={team.team_id} variant="neutral">{team.team_name}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={m.role}
                      onChange={(e) => updateRole.mutate({ id: m.id, role: e.target.value })}
                      options={ORG_ROLES.map((r) => ({ value: r, label: r }))}
                      className="min-w-[10rem]"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(m.id)}>
                      <UserMinus className="w-3.5 h-3.5 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} title={t('members.invite')}>
        <form onSubmit={(e) => { e.preventDefault(); invite.mutate(); }} className="space-y-4">
          <Input label={t('members.invite_email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <Select label={t('members.role')} value={role} onChange={(e) => setRole(e.target.value)} options={ORG_ROLES.map((r) => ({ value: r, label: r }))} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>{tCommon('actions.cancel')}</Button>
            <Button type="submit" loading={invite.isPending}>{t('members.send_invite')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
