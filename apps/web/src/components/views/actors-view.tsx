import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Users, Bot, User, Building2, Shield, Server, Webhook } from 'lucide-react';

const classIcons: Record<string, typeof User> = {
  human: User, ai_agent: Bot, team: Users, organization: Building2,
  external_authority: Shield, software_service: Server, executor_runtime: Webhook,
};

const classVariant: Record<string, string> = {
  human: 'info', ai_agent: 'purple', team: 'success', organization: 'neutral',
  external_authority: 'warning', software_service: 'neutral', executor_runtime: 'orange',
};

export function ActorsView() {
  const { t } = useTranslation('actors');
  const { data: actors, isLoading } = useQuery({
    queryKey: ['actors'],
    queryFn: () => api.listActors(),
  });

  if (isLoading) return <FullPageSpinner />;
  if (!actors || actors.length === 0) {
    return <EmptyState icon={<Users className="w-12 h-12" />} title={t('empty.title')} description={t('empty.description')} />;
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Users className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {actors.map(actor => {
          const Icon = classIcons[actor.class] || User;
          return (
            <div key={actor.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-slate-500" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-slate-900 dark:text-white">{actor.display_name}</h4>
                  <Badge variant={(classVariant[actor.class] || 'neutral') as any}>{t(`class.${actor.class}`, { defaultValue: actor.class.replace(/_/g, ' ') })}</Badge>
                </div>
              </div>
              {Array.isArray(actor.roles) && actor.roles.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {(actor.roles as string[]).map((role, i) => (
                    <Badge key={i} variant="neutral">{String(role)}</Badge>
                  ))}
                </div>
              )}
              {Array.isArray(actor.capabilities) && actor.capabilities.length > 0 && (
                <p className="text-xs text-slate-400">{(actor.capabilities as string[]).join(', ')}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
