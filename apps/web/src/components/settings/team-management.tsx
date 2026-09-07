import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Team } from '../../lib/api';
import { useCases } from '../../hooks/use-case';
import { Button } from '../common/button';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { Select } from '../common/select';
import { Dialog } from '../common/dialog';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Users, Plus, UserMinus, FolderPlus, ChevronDown, ChevronUp } from 'lucide-react';

const CASE_ROLES = ['case_owner', 'case_contributor', 'case_reviewer', 'case_viewer'];

export function TeamManagement() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();

  const { data: teams, isLoading } = useQuery({ queryKey: ['teams'], queryFn: api.listTeams });
  const { data: members } = useQuery({ queryKey: ['members'], queryFn: api.listMembers });
  const { data: cases } = useCases();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultRole, setDefaultRole] = useState('case_contributor');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addMemberId, setAddMemberId] = useState('');
  const [assignCaseId, setAssignCaseId] = useState('');
  const [assignRole, setAssignRole] = useState('case_contributor');

  const createTeam = useMutation({
    mutationFn: () => api.createTeam({ name, description: description || undefined, default_case_role: defaultRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      setCreateOpen(false);
      setName(''); setDescription(''); setDefaultRole('case_contributor');
    },
  });

  const addMember = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => api.addTeamMember(teamId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); qc.invalidateQueries({ queryKey: ['teams'] }); setAddMemberId(''); },
  });

  const removeMember = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => api.removeTeamMember(teamId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); qc.invalidateQueries({ queryKey: ['teams'] }); },
  });

  const assignToCase = useMutation({
    mutationFn: ({ teamId, caseId, role }: { teamId: string; caseId: string; role: string }) => api.assignTeamToCase(caseId, teamId, role),
    onSuccess: () => setAssignCaseId(''),
  });

  if (isLoading) return <FullPageSpinner />;

  const teamMembers = (team: Team) => (members ?? []).filter((m) => m.teams?.some((mt) => mt.team_id === team.id));
  const nonMembers = (team: Team) => (members ?? []).filter((m) => !m.teams?.some((mt) => mt.team_id === team.id));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('teams.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('teams.subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> {t('teams.new')}</Button>
      </div>

      {(!teams || teams.length === 0) ? (
        <EmptyState icon={<Users className="w-12 h-12" />} title={t('teams.empty.title')} description={t('teams.empty.description')} action={{ label: t('teams.new'), onClick: () => setCreateOpen(true) }} />
      ) : (
        <div className="space-y-3">
          {teams.map((team) => {
            const isOpen = expanded === team.id;
            return (
              <div key={team.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                <button onClick={() => setExpanded(isOpen ? null : team.id)} className="w-full flex items-center justify-between p-4 text-left">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{team.name}</h3>
                      <Badge variant={team.status === 'active' ? 'success' : 'neutral'}>{team.status}</Badge>
                      <Badge variant="neutral">{t('teams.member_count', { count: team.member_count })}</Badge>
                    </div>
                    {team.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{team.description}</p>}
                  </div>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>

                {isOpen && (
                  <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-2">{t('teams.members')}</h4>
                      <div className="space-y-1 mb-3">
                        {teamMembers(team).map((m) => (
                          <div key={m.id} className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                            <span className="text-slate-700 dark:text-slate-300">{m.display_name} <span className="text-slate-400">({m.email})</span></span>
                            <button onClick={() => removeMember.mutate({ teamId: team.id, userId: m.id })} className="text-slate-400 hover:text-red-500">
                              <UserMinus className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        {teamMembers(team).length === 0 && <p className="text-xs text-slate-400">{tCommon('actions.no_results')}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Select
                          value={addMemberId}
                          onChange={(e) => setAddMemberId(e.target.value)}
                          options={[{ value: '', label: t('teams.select_member') }, ...nonMembers(team).map((m) => ({ value: m.id, label: `${m.display_name} (${m.email})` }))]}
                          className="flex-1"
                        />
                        <Button
                          size="sm"
                          disabled={!addMemberId}
                          loading={addMember.isPending}
                          onClick={() => addMemberId && addMember.mutate({ teamId: team.id, userId: addMemberId })}
                        >
                          <Plus className="w-3.5 h-3.5" /> {tCommon('actions.create')}
                        </Button>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-2">{t('teams.assign_case')}</h4>
                      <div className="flex gap-2">
                        <Select
                          value={assignCaseId}
                          onChange={(e) => setAssignCaseId(e.target.value)}
                          options={[{ value: '', label: t('teams.select_case') }, ...(cases ?? []).map((c) => ({ value: c.id, label: c.title }))]}
                          className="flex-1"
                        />
                        <Select
                          value={assignRole}
                          onChange={(e) => setAssignRole(e.target.value)}
                          options={CASE_ROLES.map((r) => ({ value: r, label: r }))}
                          className="w-44"
                        />
                        <Button
                          size="sm"
                          disabled={!assignCaseId}
                          loading={assignToCase.isPending}
                          onClick={() => assignCaseId && assignToCase.mutate({ teamId: team.id, caseId: assignCaseId, role: assignRole })}
                        >
                          <FolderPlus className="w-3.5 h-3.5" /> {t('teams.assign')}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('teams.new')}>
        <form onSubmit={(e) => { e.preventDefault(); createTeam.mutate(); }} className="space-y-4">
          <Input label={t('teams.name')} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <Textarea label={t('teams.description')} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Select label={t('teams.default_case_role')} value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)} options={CASE_ROLES.map((r) => ({ value: r, label: r }))} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>{tCommon('actions.cancel')}</Button>
            <Button type="submit" loading={createTeam.isPending}>{tCommon('actions.create')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
