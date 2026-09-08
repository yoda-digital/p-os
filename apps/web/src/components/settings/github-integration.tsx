import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Button } from '../common/button';
import { Input } from '../common/input';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Github, Link, Unlink, RefreshCw, CheckCircle, AlertCircle, Copy } from 'lucide-react';

interface Integration {
  id: string;
  type: string;
  name: string;
  active: boolean;
  settings: Record<string, unknown>;
  last_sync_at?: string;
  webhook_endpoints?: Array<{ id: string; active: boolean; last_received_at?: string }>;
}

export function GitHubIntegration() {
  const { t } = useTranslation('integrations');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();

  const { data: integrations, isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.listIntegrations(),
  });

  const githubIntegration = integrations?.find((i: Integration) => i.type === 'github');

  const createGithub = useMutation({
    mutationFn: () => api.createIntegration({ type: 'github', name: 'GitHub' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const testConnection = useMutation({
    mutationFn: (id: string) => api.testIntegration(id),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.updateIntegration(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const [copiedWebhook, setCopiedWebhook] = useState(false);

  if (isLoading) return <FullPageSpinner />;

  if (!githubIntegration) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Github className="w-12 h-12" />}
          title={t('github.empty.title')}
          description={t('github.empty.description')}
          action={{
            label: t('github.connect'),
            onClick: () => createGithub.mutate(),
          }}
        />
      </div>
    );
  }

  const settings = githubIntegration.settings as Record<string, unknown>;
  const isConnected = settings.oauth_connected === true;
  const webhookEndpoint = githubIntegration.webhook_endpoints?.[0];
  const webhookUrl = webhookEndpoint
    ? `${window.location.origin}/api/v1/webhooks/${webhookEndpoint.id}`
    : null;

  const copyWebhookUrl = () => {
    if (webhookUrl) {
      navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-slate-900 dark:bg-white">
            <Github className="w-6 h-6 text-white dark:text-slate-900" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              {t('github.title')}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('github.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Badge variant="success">
              <CheckCircle className="w-3 h-3 mr-1" />
              {t('github.status.connected')}
            </Badge>
          ) : (
            <Badge variant="warning">
              <AlertCircle className="w-3 h-3 mr-1" />
              {t('github.status.disconnected')}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleActive.mutate({
              id: githubIntegration.id,
              active: !githubIntegration.active,
            })}
          >
            {githubIntegration.active ? <Unlink className="w-4 h-4" /> : <Link className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Connection section */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
        <h3 className="font-medium text-slate-900 dark:text-white">
          {t('github.connection.title')}
        </h3>

        {!isConnected ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('github.connection.instructions')}
            </p>
            <Button onClick={() => {
              // In production: redirect to GitHub OAuth URL
              window.open(
                `/api/v1/integrations/${githubIntegration.id}/github/authorize`,
                '_blank',
              );
            }}>
              <Github className="w-4 h-4" />
              {t('github.connect')}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Badge variant="success">{t('github.connection.oauth_active')}</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => testConnection.mutate(githubIntegration.id)}
              loading={testConnection.isPending}
            >
              <RefreshCw className="w-4 h-4" />
              {t('github.connection.test')}
            </Button>
          </div>
        )}

        {testConnection.data && (
          <div className={`text-sm p-2 rounded ${
            (testConnection.data as { success: boolean }).success
              ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
          }`}>
            {(testConnection.data as { message: string }).message}
          </div>
        )}
      </div>

      {/* Webhook URL section */}
      {webhookUrl && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <h3 className="font-medium text-slate-900 dark:text-white">
            {t('github.webhook.title')}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('github.webhook.instructions')}
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={webhookUrl}
              readOnly
              className="font-mono text-xs"
            />
            <Button variant="ghost" size="sm" onClick={copyWebhookUrl}>
              <Copy className="w-4 h-4" />
              {copiedWebhook ? tCommon('actions.copied') : tCommon('actions.copy')}
            </Button>
          </div>
          {webhookEndpoint?.last_received_at && (
            <p className="text-xs text-slate-400">
              {t('github.webhook.last_received')}: {new Date(webhookEndpoint.last_received_at).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Sync status section */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h3 className="font-medium text-slate-900 dark:text-white">
          {t('github.sync.title')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SyncStat label={t('github.sync.prs')} value="--" />
          <SyncStat label={t('github.sync.commits')} value="--" />
          <SyncStat label={t('github.sync.reviews')} value="--" />
          <SyncStat label={t('github.sync.issues')} value="--" />
        </div>
        {githubIntegration.last_sync_at && (
          <p className="text-xs text-slate-400">
            {t('github.sync.last_sync')}: {new Date(githubIntegration.last_sync_at).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

function SyncStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-800">
      <p className="text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
