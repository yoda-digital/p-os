import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMetrics, useDrift } from '../../hooks/use-timeline';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { BarChart3, TrendingUp, AlertTriangle, Clock, RefreshCw, Target, Gauge, Users } from 'lucide-react';

export function IntelligenceView() {
  const { t } = useTranslation('intelligence');
  const { caseId } = useParams<{ caseId: string }>();
  const { data: metrics, isLoading: metricsLoading } = useMetrics(caseId);
  const { data: drift, isLoading: driftLoading } = useDrift(caseId);

  if (metricsLoading || driftLoading) return <FullPageSpinner />;

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <BarChart3 className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
      </div>

      {/* Metrics Grid */}
      {metrics ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard icon={<Clock className="w-5 h-5" />} label={t('metrics.cycle_time')} value={metrics.cycle_time || '—'} />
          <MetricCard icon={<Clock className="w-5 h-5" />} label={t('metrics.waiting_time')} value={metrics.waiting_time || '—'} />
          <MetricCard icon={<RefreshCw className="w-5 h-5" />} label={t('metrics.rework_count')} value={String(metrics.rework_count)} variant={metrics.rework_count > 3 ? 'danger' : 'neutral'} />
          <MetricCard icon={<AlertTriangle className="w-5 h-5" />} label={t('metrics.failed_attempts')} value={String(metrics.failed_attempts)} variant={metrics.failed_attempts > 0 ? 'warning' : 'success'} />
          <MetricCard icon={<Users className="w-5 h-5" />} label={t('metrics.human_attention_time')} value={metrics.human_attention_time || '—'} />
          <MetricCard icon={<Target className="w-5 h-5" />} label={t('metrics.evidence_gaps')} value={String(metrics.evidence_gaps)} variant={metrics.evidence_gaps > 0 ? 'warning' : 'success'} />
          <MetricCard icon={<Gauge className="w-5 h-5" />} label={t('metrics.completion_reliability')} value={metrics.completion_reliability != null ? `${(metrics.completion_reliability * 100).toFixed(0)}%` : '—'} />
          <MetricCard icon={<TrendingUp className="w-5 h-5" />} label={t('metrics.context_rotations')} value={String(metrics.context_rotations)} />
          <MetricCard icon={<BarChart3 className="w-5 h-5" />} label={t('metrics.steering_frequency')} value={String(metrics.steering_frequency)} />
        </div>
      ) : (
        <EmptyState icon={<BarChart3 className="w-12 h-12" />} title={t('empty.title')} description={t('empty.description')} />
      )}

      {/* Drift Detection */}
      {drift && drift.deviations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            {t('drift.title', { count: drift.deviations.length })}
          </h3>
          <div className="space-y-3">
            {drift.deviations.map((dev, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-900 dark:text-white">{dev.description}</span>
                  <Badge variant={dev.severity === 'high' ? 'danger' : dev.severity === 'medium' ? 'warning' : 'neutral'}>
                    {t(`severity.${dev.severity}`, { defaultValue: dev.severity })}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('drift.type', { value: dev.type })}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Process Architect suggestions */}
      <div className="mt-8 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-200 dark:border-emerald-800 p-5">
        <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-2">{t('architect.title')}</h3>
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {t('architect.description')}
        </p>
      </div>

      {/* Guardian */}
      <div className="mt-4 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-800 p-5">
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">{t('guardian.title')}</h3>
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {t('guardian.description')}
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
