import { useParams, Link } from 'react-router-dom';
import { useAttention } from '../../hooks/use-attention';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Bell, AlertTriangle, Clock, ArrowRight } from 'lucide-react';

const priorityConfig: Record<string, { variant: string; icon: string }> = {
  critical: { variant: 'danger', icon: '🔴' },
  high: { variant: 'orange', icon: '🟠' },
  medium: { variant: 'warning', icon: '🟡' },
  low: { variant: 'neutral', icon: '⚪' },
};

export function AttentionView() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: items, isLoading } = useAttention(caseId);

  if (isLoading) return <FullPageSpinner />;

  const unresolved = items?.filter(i => !i.resolved) || [];
  const byPriority = (p: string) => unresolved.filter(i => i.priority === p);

  const stats = {
    critical: byPriority('critical').length,
    high: byPriority('high').length,
    medium: byPriority('medium').length,
    low: byPriority('low').length,
    total: unresolved.length,
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Bell className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Attention Queue</h2>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {(['critical', 'high', 'medium', 'low'] as const).map((p) => {
          const cfg = priorityConfig[p];
          return (
            <div key={p} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats[p]}</p>
              <p className="text-xs text-slate-500 capitalize">{cfg.icon} {p}</p>
            </div>
          );
        })}
      </div>

      {unresolved.length === 0 ? (
        <EmptyState
          icon={<Bell className="w-12 h-12" />}
          title="All clear"
          description="No attention items require your input"
        />
      ) : (
        <div className="space-y-3">
          {unresolved.map((item) => {
            const cfg = priorityConfig[item.priority] || priorityConfig.low;
            return (
              <div key={item.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={cfg.variant as any} dot>{item.priority}</Badge>
                      {item.deadline && (
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(item.deadline).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{item.reason}</p>
                    {item.action_required && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Action: {item.action_required}</p>
                    )}
                    {item.blocking_impact > 0 && (
                      <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Blocking {item.blocking_impact} move{item.blocking_impact > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  {item.move_id && (
                    <Link
                      to={`/cases/${caseId}/kanban`}
                      className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                    >
                      View <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
