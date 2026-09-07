import { useParams } from 'react-router-dom';
import { useMetrics, useDrift } from '../../hooks/use-timeline';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { BarChart3, TrendingUp, AlertTriangle, Clock, RefreshCw, Target, Gauge, Users } from 'lucide-react';

export function IntelligenceView() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: metrics, isLoading: metricsLoading } = useMetrics(caseId);
  const { data: drift, isLoading: driftLoading } = useDrift(caseId);

  if (metricsLoading || driftLoading) return <FullPageSpinner />;

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <BarChart3 className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Process Intelligence</h2>
      </div>

      {/* Metrics Grid */}
      {metrics ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard icon={<Clock className="w-5 h-5" />} label="Cycle Time" value={metrics.cycle_time || '—'} />
          <MetricCard icon={<Clock className="w-5 h-5" />} label="Waiting Time" value={metrics.waiting_time || '—'} />
          <MetricCard icon={<RefreshCw className="w-5 h-5" />} label="Rework Count" value={String(metrics.rework_count)} variant={metrics.rework_count > 3 ? 'danger' : 'neutral'} />
          <MetricCard icon={<AlertTriangle className="w-5 h-5" />} label="Failed Attempts" value={String(metrics.failed_attempts)} variant={metrics.failed_attempts > 0 ? 'warning' : 'success'} />
          <MetricCard icon={<Users className="w-5 h-5" />} label="Human Attention" value={metrics.human_attention_time || '—'} />
          <MetricCard icon={<Target className="w-5 h-5" />} label="Evidence Gaps" value={String(metrics.evidence_gaps)} variant={metrics.evidence_gaps > 0 ? 'warning' : 'success'} />
          <MetricCard icon={<Gauge className="w-5 h-5" />} label="Completion Reliability" value={metrics.completion_reliability != null ? `${(metrics.completion_reliability * 100).toFixed(0)}%` : '—'} />
          <MetricCard icon={<TrendingUp className="w-5 h-5" />} label="Context Rotations" value={String(metrics.context_rotations)} />
          <MetricCard icon={<BarChart3 className="w-5 h-5" />} label="Steering Frequency" value={String(metrics.steering_frequency)} />
        </div>
      ) : (
        <EmptyState icon={<BarChart3 className="w-12 h-12" />} title="No metrics" description="Metrics will appear once the case has activity" />
      )}

      {/* Drift Detection */}
      {drift && drift.deviations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Process Drift ({drift.deviations.length} deviations)
          </h3>
          <div className="space-y-3">
            {drift.deviations.map((dev, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-900 dark:text-white">{dev.description}</span>
                  <Badge variant={dev.severity === 'high' ? 'danger' : dev.severity === 'medium' ? 'warning' : 'neutral'}>
                    {dev.severity}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Type: {dev.type}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Process Architect suggestions */}
      <div className="mt-8 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-200 dark:border-emerald-800 p-5">
        <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-2">AI Process Architect</h3>
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Process analysis active. Suggestions will appear when patterns are detected in execution history.
        </p>
      </div>

      {/* Guardian */}
      <div className="mt-4 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-800 p-5">
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">Process Guardian</h3>
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Monitoring for scope drift, policy breaches, stale evidence, deadline risk, and unauthorized work.
        </p>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, variant = 'neutral' }: { icon: React.ReactNode; label: string; value: string; variant?: string }) {
  const borderColor = variant === 'danger' ? 'border-red-200 dark:border-red-800' : variant === 'warning' ? 'border-amber-200 dark:border-amber-800' : variant === 'success' ? 'border-emerald-200 dark:border-emerald-800' : 'border-slate-200 dark:border-slate-800';
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl border ${borderColor} p-4`}>
      <div className="flex items-center gap-2 text-slate-400 mb-2">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
