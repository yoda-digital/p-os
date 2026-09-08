import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Shield, AlertTriangle, Clock, User, FileText } from 'lucide-react';

const overrideTypeVariant: Record<string, string> = {
  policy: 'warning',
  ai_recommendation: 'info',
  autonomy: 'orange',
  budget: 'danger',
};

export function AdminGovernance() {
  const { t } = useTranslation('admin');
  const [tab, setTab] = useState<'overrides' | 'authority'>('overrides');

  const { data: overrides, isLoading } = useQuery({
    queryKey: ['governance-overrides'],
    queryFn: () => api.listGovernanceOverrides({ limit: 50 }),
  });

  if (isLoading) return <FullPageSpinner />;

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Shield className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t('governance.title', { defaultValue: 'Governance' })}
        </h2>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 mb-6">
        {(['overrides', 'authority'] as const).map((t_) => (
          <button
            key={t_}
            onClick={() => setTab(t_)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              tab === t_
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-300 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t_ === 'overrides'
              ? t('governance.overrides', { defaultValue: 'Override Audit Trail' })
              : t('governance.authority_matrix', { defaultValue: 'Authority Matrix' })}
          </button>
        ))}
      </div>

      {tab === 'overrides' && (
        <div>
          {(!overrides || overrides.length === 0) ? (
            <EmptyState
              icon={<Shield className="w-12 h-12" />}
              title={t('governance.no_overrides', { defaultValue: 'No Governance Overrides' })}
              description={t('governance.no_overrides_desc', { defaultValue: 'No human overrides of AI recommendations or policies have been recorded.' })}
            />
          ) : (
            <div className="space-y-3">
              {overrides.map((o) => (
                <div key={o.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={overrideTypeVariant[o.override_type] as any ?? 'neutral'}>
                        {o.override_type}
                      </Badge>
                      <span className="text-sm font-medium text-slate-900 dark:text-white">{o.action}</span>
                    </div>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(o.created_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-3">
                    {o.original_recommendation && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {t('governance.original', { defaultValue: 'Original Recommendation' })}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">{o.original_recommendation}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {t('governance.actual', { defaultValue: 'Actual Decision' })}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{o.actual_decision}</p>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-xs text-slate-500">
                      <User className="w-3 h-3 inline mr-1" />
                      {o.actor_name ?? o.actor_id}: {o.justification}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'authority' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('governance.action', { defaultValue: 'Action' })}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('governance.required_roles', { defaultValue: 'Required Roles' })}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('governance.risk', { defaultValue: 'Risk' })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {[
                { action: 'move.activate', roles: 'case_contributor, case_owner, org_admin', risk: 'low' },
                { action: 'move.activate (high risk)', roles: 'case_owner, org_admin', risk: 'high' },
                { action: 'decision.resolve', roles: 'listed authority role', risk: 'medium' },
                { action: 'evidence.invalidate', roles: 'case_contributor + justification', risk: 'medium' },
                { action: 'steering.hard_stop', roles: 'case_owner, org_admin', risk: 'high' },
                { action: 'budget.exceed_threshold', roles: 'org_billing, org_owner', risk: 'high' },
                { action: 'case.close', roles: 'case_owner, org_admin', risk: 'low' },
                { action: 'governance.override', roles: 'org_admin', risk: 'critical' },
              ].map((row) => (
                <tr key={row.action} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{row.action}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.roles}</td>
                  <td className="px-4 py-3">
                    <Badge variant={row.risk === 'critical' ? 'danger' : row.risk === 'high' ? 'orange' : row.risk === 'medium' ? 'warning' : 'neutral'}>
                      {row.risk}
                    </Badge>
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
