import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Button } from '../common/button';
import { Input } from '../common/input';
import { Dialog } from '../common/dialog';
import { Badge } from '../common/badge';
import { Select } from '../common/select';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import {
  Plug, Plus, Github, Mail, Calendar, MessageSquare,
  Webhook, Settings, Trash2, Power, PowerOff, Activity,
  CheckCircle, AlertCircle, Clock,
} from 'lucide-react';
import { GitHubIntegration } from './github-integration';

interface Integration {
  id: string;
  type: string;
  name: string;
  active: boolean;
  settings: Record<string, unknown>;
  last_sync_at?: string;
  created_at: string;
}

const INTEGRATION_TYPES = [
  { value: 'github', label: 'GitHub', icon: Github, description: 'PR, issue, commit sync' },
  { value: 'slack', label: 'Slack', icon: MessageSquare, description: 'Notifications & approvals' },
  { value: 'email', label: 'Email', icon: Mail, description: 'Inbound & outbound email' },
  { value: 'calendar', label: 'Calendar', icon: Calendar, description: 'Deadline sync & availability' },
  { value: 'webhook', label: 'Webhook', icon: Webhook, description: 'Generic HTTP webhooks' },
] as const;

function getIcon(type: string) {
  const found = INTEGRATION_TYPES.find((t) => t.value === type);
  return found?.icon ?? Plug;
}

export function IntegrationsHub() {
  const { t } = useTranslation('integrations');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();

  const { data: integrations, isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.listIntegrations(),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newType, setNewType] = useState('github');
  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => api.createIntegration({ type: newType, name: newName || INTEGRATION_TYPES.find((t) => t.value === newType)?.label || newType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      setCreateOpen(false);
      setNewName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteIntegration(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      setSelectedId(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.updateIntegration(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  if (isLoading) return <FullPageSpinner />;

  // If a specific integration is selected, show its detail view
  const selected = integrations?.find((i: Integration) => i.id === selectedId);
  if (selected?.type === 'github') {
    return (
      <div>
        <div className="px-6 pt-4">
          <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
            {tCommon('actions.back')}
          </Button>
        </div>
        <GitHubIntegration />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('hub.title')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t('hub.subtitle')}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> {t('hub.add_integration')}
        </Button>
      </div>

      {/* Active integrations */}
      {(!integrations || integrations.length === 0) ? (
        <EmptyState
          icon={<Plug className="w-12 h-12" />}
          title={t('hub.empty.title')}
          description={t('hub.empty.description')}
          action={{ label: t('hub.add_integration'), onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {integrations.map((integration: Integration) => {
            const Icon = getIcon(integration.type);
            return (
              <div
                key={integration.id}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors cursor-pointer"
                onClick={() => setSelectedId(integration.id)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
                      <Icon className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                    </div>
                    <div>
                      <h3 className="font-medium text-slate-900 dark:text-white text-sm">
                        {integration.name}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {INTEGRATION_TYPES.find((t) => t.value === integration.type)?.description}
                      </p>
                    </div>
                  </div>
                  <Badge variant={integration.active ? 'success' : 'neutral'}>
                    {integration.active ? (
                      <><CheckCircle className="w-3 h-3 mr-1" /> {t('hub.active')}</>
                    ) : (
                      <><PowerOff className="w-3 h-3 mr-1" /> {t('hub.inactive')}</>
                    )}
                  </Badge>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock className="w-3 h-3" />
                    {integration.last_sync_at
                      ? new Date(integration.last_sync_at).toLocaleDateString()
                      : t('hub.never_synced')}
                  </div>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="p-1 text-slate-400 hover:text-emerald-600 transition-colors"
                      onClick={() => toggleMutation.mutate({
                        id: integration.id,
                        active: !integration.active,
                      })}
                      title={integration.active ? t('hub.deactivate') : t('hub.activate')}
                    >
                      {integration.active ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                      onClick={() => {
                        if (confirm(t('hub.confirm_delete'))) {
                          deleteMutation.mutate(integration.id);
                        }
                      }}
                      title={tCommon('actions.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Available integration types */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
          {t('hub.available_types')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATION_TYPES.map(({ value, label, icon: Icon, description }) => {
            const exists = integrations?.some((i: Integration) => i.type === value);
            return (
              <div
                key={value}
                className={`p-3 rounded-lg border ${
                  exists
                    ? 'border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 opacity-50'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-300 dark:hover:border-emerald-700 cursor-pointer'
                } transition-colors`}
                onClick={() => {
                  if (!exists) {
                    setNewType(value);
                    setNewName(label);
                    setCreateOpen(true);
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-slate-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
                    <p className="text-xs text-slate-400">{description}</p>
                  </div>
                  {exists && <Badge variant="neutral" className="ml-auto">{t('hub.configured')}</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('hub.add_integration')}>
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-4">
          <Select
            label={t('hub.type')}
            value={newType}
            onChange={(e) => {
              setNewType(e.target.value);
              const found = INTEGRATION_TYPES.find((t) => t.value === e.target.value);
              if (found && !newName) setNewName(found.label);
            }}
            options={INTEGRATION_TYPES.map((t) => ({ value: t.value, label: `${t.label} — ${t.description}` }))}
          />
          <Input
            label={t('hub.name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('hub.name_placeholder')}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              {tCommon('actions.cancel')}
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              {tCommon('actions.create')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
