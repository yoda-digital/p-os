import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMetrics, useDrift } from '../../hooks/use-timeline';
import { api } from '../../lib/api';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import {
  BarChart3, TrendingUp, AlertTriangle, Clock, RefreshCw, Target,
  Gauge, Users, DollarSign, Cpu, Zap, Shield, Eye, Lightbulb,
} from 'lucide-react';

interface ArchitectInsight {
  type: string;
  recommendation: string;
  confidence: number;
  affected_move_ids: string[];
  estimated_impact: string;
}

interface GuardianAlert {
  type: string;
  severity: string;
  description: string;
  affected_move_ids: string[];
  recommended_action: string;
}

export function IntelligenceView() {
  const { t } = useTranslation('intelligence');
  const { caseId } = useParams<{ caseId: string }>();
  const { data: metrics, isLoading: metricsLoading } = useMetrics(caseId);
  const { data: drift, isLoading: driftLoading } = useDrift(caseId);

  const [insights, setInsights] = useState<ArchitectInsight[]>([]);
  const [guardianAlerts, setGuardianAlerts] = useState<GuardianAlert[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [checking, setChecking] = useState(false);

  if (metricsLoading || driftLoading) return <FullPageSpinner />;

  const handleAnalyze = async () => {
    if (!caseId) return;
    setAnalyzing(true);
    try {
      const res = await api.analyzeProcess(caseId);
      setInsights((res as any).insights ?? []);
    } catch {
      setInsights([]);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGuardianCheck = async () => {
    if (!caseId) return;
    setChecking(true);
    try {
      const res = await api.runGuardianCheck(caseId);
      setGuardianAlerts((res as any).alerts ?? []);
    } catch {
      setGuardianAlerts([]);
    } finally {
      setChecking(false);
    }
  };

  const formatDuration = (seconds: number | null | undefined): string => {
    if (seconds == null) return '—';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
    return `${(seconds / 86400).toFixed(1)}d`;
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <BarChart3 className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
      </div>

      {/* 11 Metrics Grid */}
      {metrics ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard icon={<Clock className="w-5 h-5" />} label={t('metrics.cycle_time')} value={formatDuration(metrics.cycle_time_seconds)} />
          <MetricCard icon={<Clock className="w-5 h-5" />} label={t('metrics.waiting_time')} value={formatDuration(metrics.waiting_time_seconds)} />
          <MetricCard icon={<RefreshCw className="w-5 h-5" />} label={t('metrics.rework_count')} value={String(metrics.rework_count)} variant={metrics.rework_count > 3 ? 'danger' : 'neutral'} />
          <MetricCard icon={<AlertTriangle className="w-5 h-5" />} label={t('metrics.failed_attempts')} value={String(metrics.failed_attempts)} variant={metrics.failed_attempts > 0 ? 'warning' : 'success'} />
          <MetricCard icon={<Users className="w-5 h-5" />} label={t('metrics.human_attention_time')} value={formatDuration(metrics.human_attention_time_seconds)} />
          <MetricCard icon={<Target className="w-5 h-5" />} label={t('metrics.evidence_gaps')} value={String(metrics.evidence_gaps)} variant={metrics.evidence_gaps > 0 ? 'warning' : 'success'} />
          <MetricCard icon={<Gauge className="w-5 h-5" />} label={t('metrics.completion_reliability')} value={metrics.completion_reliability != null ? `${(metrics.completion_reliability * 100).toFixed(0)}%` : '—'} />
          <MetricCard icon={<DollarSign className="w-5 h-5" />} label={t('metrics.cost')} value={metrics.cost_usd != null ? `$${Number(metrics.cost_usd).toFixed(2)}` : '—'} />
          <MetricCard icon={<Cpu className="w-5 h-5" />} label={t('metrics.executor_performance')} value={`${Object.keys(metrics.executor_performance ?? {}).length} executors`} />
          <MetricCard icon={<TrendingUp className="w-5 h-5" />} label={t('metrics.context_rotations')} value={String(metrics.context_rotations)} />
          <MetricCard icon={<Zap className="w-5 h-5" />} label={t('metrics.steering_frequency')} value={String(metrics.steering_frequency)} />
        </div>
      ) : (
        <EmptyState icon={<BarChart3 className="w-12 h-12" />} title={t('empty.title')} description={t('empty.description')} />
      )}

      {/* Drift Detection */}
      {drift && drift.anomalies && drift.anomalies.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            {t('drift.title', { count: drift.anomalies.length })}
          </h3>
          <div className="space-y-3">
            {drift.anomalies.map((dev: any, i: number) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-900 dark:text-white">{dev.description}</span>
                  <Badge variant={dev.severity === 'high' ? 'danger' : dev.severity === 'medium' ? 'warning' : 'neutral'}>
                    {t(`severity.${dev.severity}`, { defaultValue: dev.severity })}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('drift.type', { value: dev.type })}</p>
                {dev.recommendation && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{dev.recommendation}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Process Architect */}
      <div className="mb-6 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-200 dark:border-emerald-800 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{t('architect.title')}</h3>
          </div>
          <Button size="sm" onClick={handleAnalyze} loading={analyzing}>
            {t('architect.analyze')}
          </Button>
        </div>
        {insights.length > 0 ? (
          <div className="space-y-3 mt-3">
            {insights.map((insight, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 dark:border-emerald-800 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="success">{insight.type}</Badge>
                  <span className="text-xs text-slate-400">{t('architect.confidence', { value: (insight.confidence * 100).toFixed(0) })}</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300">{insight.recommendation}</p>
                {insight.estimated_impact && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{insight.estimated_impact}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{t('architect.description')}</p>
        )}
      </div>

      {/* AI Process Guardian */}
      <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-800 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t('guardian.title')}</h3>
          </div>
          <Button size="sm" variant="secondary" onClick={handleGuardianCheck} loading={checking}>
            {t('guardian.check')}
          </Button>
        </div>
        {guardianAlerts.length > 0 ? (
          <div className="space-y-3 mt-3">
            {guardianAlerts.map((alert, i) => (
              <div key={i} className={`bg-white dark:bg-slate-900 rounded-lg border p-3 ${
                alert.severity === 'critical' ? 'border-red-300 dark:border-red-700'
                  : alert.severity === 'high' ? 'border-amber-300 dark:border-amber-700'
                    : 'border-slate-200 dark:border-slate-800'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <Eye className="w-4 h-4 text-amber-500" />
                  <Badge variant={alert.severity === 'critical' ? 'danger' : alert.severity === 'high' ? 'warning' : 'neutral'}>
                    {alert.severity}
                  </Badge>
                  <Badge variant="neutral">{alert.type}</Badge>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300">{alert.description}</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{alert.recommended_action}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-amber-700 dark:text-amber-400">{t('guardian.description')}</p>
        )}
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
