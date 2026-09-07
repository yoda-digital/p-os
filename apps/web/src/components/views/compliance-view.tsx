import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Shield, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

const statusVariant: Record<string, string> = {
  satisfied: 'success', unsatisfied: 'neutral', unknown: 'neutral',
  violated: 'danger', waived: 'warning', not_applicable: 'neutral', at_risk: 'orange',
};

export function ComplianceView() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: rules, isLoading } = useQuery({
    queryKey: ['rules', caseId],
    queryFn: () => api.listRules(caseId!),
    enabled: !!caseId,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (isLoading) return <FullPageSpinner />;
  if (!rules || rules.length === 0) {
    return <EmptyState icon={<Shield className="w-12 h-12" />} title="No rules defined" description="Rules and constraints will appear here" />;
  }

  // Group by type
  const grouped = rules.reduce<Record<string, typeof rules>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Shield className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Rule Compliance</h2>
      </div>

      <div className="space-y-4">
        {Object.entries(grouped).map(([type, typeRules]) => (
          <div key={type} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 capitalize">{type}</h3>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {typeRules.map(rule => (
                <div key={rule.id}>
                  <button
                    onClick={() => toggle(rule.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      {expanded.has(rule.id) ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                      <span className="text-sm text-slate-700 dark:text-slate-300">{rule.statement}</span>
                    </div>
                    <Badge variant={(statusVariant[rule.evaluation_status] || 'neutral') as any}>
                      {rule.evaluation_status}
                    </Badge>
                  </button>
                  {expanded.has(rule.id) && (
                    <div className="px-4 pb-3 pl-11 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                      <p>Type: {rule.type}</p>
                      <p>ID: {rule.id}</p>
                      <p>Created: {new Date(rule.created_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
