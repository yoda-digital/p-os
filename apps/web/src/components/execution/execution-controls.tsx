// Execution Controls — Execute/Stop buttons, strategy display, progress
// SP3 §3.3: Execution Status Widget

import { useTranslation } from 'react-i18next';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { Spinner } from '../common/spinner';
import { useExecutionStatus, useExecuteMove, useStopMove } from '../../hooks/use-execution';
import {
  Play, Square, Cpu, Zap, Brain, Users, Clock,
  AlertTriangle, HelpCircle, Terminal, ExternalLink,
} from 'lucide-react';

// ── Strategy display config ──────────────────────────────────────────

const strategyConfig: Record<string, { icon: typeof Play; variant: string; label: string }> = {
  current_session: { icon: Terminal, variant: 'info', label: 'Current Session' },
  fresh_session: { icon: Zap, variant: 'info', label: 'Fresh Session' },
  background_session: { icon: Cpu, variant: 'purple', label: 'Background' },
  subagent: { icon: Brain, variant: 'orange', label: 'Subagent' },
  agent_team: { icon: Users, variant: 'purple', label: 'Agent Team' },
  dynamic_workflow: { icon: Users, variant: 'info', label: 'Workflow' },
  human: { icon: HelpCircle, variant: 'warning', label: 'Human' },
  wait: { icon: Clock, variant: 'neutral', label: 'Wait' },
};

const modelLabels: Record<string, string> = {
  'fast': 'Fast',
  'standard': 'Standard',
  'capable': 'Capable',
  'auto': 'Auto',
};

const effortLabels: Record<string, string> = {
  'low': 'Low',
  'medium': 'Medium',
  'high': 'High',
};

// ── Strategy Badge (for kanban card) ─────────────────────────────────

interface StrategyBadgeProps {
  strategy: string;
  compact?: boolean;
}

export function StrategyBadge({ strategy, compact }: StrategyBadgeProps) {
  const { t } = useTranslation('execution');
  const config = strategyConfig[strategy];
  if (!config) return null;

  const Icon = config.icon;

  if (compact) {
    return (
      <span title={t(`strategy.${strategy}`, { defaultValue: config.label })} className="inline-flex">
        <Icon className="w-3 h-3 text-slate-400" />
      </span>
    );
  }

  return (
    <Badge variant={config.variant as any}>
      <Icon className="w-3 h-3" />
      {t(`strategy.${strategy}`, { defaultValue: config.label })}
    </Badge>
  );
}

// ── Full Execution Controls (for move detail drawer) ─────────────────

interface ExecutionControlsProps {
  moveId: string;
  caseId: string;
  moveClass?: string;
  execution?: string;
}

export function ExecutionControls({ moveId, caseId, moveClass, execution }: ExecutionControlsProps) {
  const { t } = useTranslation('execution');
  const { data: status, isLoading: statusLoading } = useExecutionStatus(moveId);
  const executeMutation = useExecuteMove(caseId);
  const stopMutation = useStopMove(caseId);

  const isExecuting = status?.current_attempt?.state === 'running' || status?.current_attempt?.state === 'starting';
  const isQueued = status?.current_attempt?.state === 'queued';
  const canExecute = !isExecuting && !isQueued && execution !== 'finished';

  const handleExecute = () => {
    executeMutation.mutate(moveId);
  };

  const handleStop = () => {
    stopMutation.mutate(moveId);
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider flex items-center gap-1.5">
        <Cpu className="w-3.5 h-3.5" />
        {t('controls.title', { defaultValue: 'Execution' })}
      </h4>

      {/* Current status */}
      {statusLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner size="sm" /> {t('controls.loading', { defaultValue: 'Loading...' })}
        </div>
      ) : status?.current_attempt ? (
        <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 space-y-2">
          {/* Strategy + state */}
          <div className="flex items-center justify-between">
            <StrategyBadge strategy={status.current_attempt.strategy} />
            <Badge variant={
              status.current_attempt.state === 'running' ? 'success'
              : status.current_attempt.state === 'starting' ? 'info'
              : status.current_attempt.state === 'queued' ? 'warning'
              : 'neutral'
            }>
              {status.current_attempt.state}
            </Badge>
          </div>

          {/* Model + effort */}
          {status.current_attempt.model && (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Brain className="w-3 h-3" />
              <span>{t('controls.model', { defaultValue: 'Model: {{value}}', value: status.current_attempt.model })}</span>
              {status.current_attempt.effort && (
                <span className="text-slate-300 dark:text-slate-600">|</span>
              )}
              {status.current_attempt.effort && (
                <span>{t('controls.effort', { defaultValue: 'Effort: {{value}}', value: effortLabels[status.current_attempt.effort] ?? status.current_attempt.effort })}</span>
              )}
            </div>
          )}

          {/* WHY explanation */}
          {status.current_attempt.why && (
            <div className="text-xs text-slate-400 dark:text-slate-500 italic border-l-2 border-slate-200 dark:border-slate-700 pl-2">
              {status.current_attempt.why}
            </div>
          )}

          {/* Started at */}
          {status.current_attempt.started_at && (
            <div className="text-[10px] text-slate-400">
              {t('controls.started', { defaultValue: 'Started {{value}}', value: new Date(status.current_attempt.started_at).toLocaleString() })}
            </div>
          )}
        </div>
      ) : null}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {canExecute && (
          <Button
            size="sm"
            variant="primary"
            onClick={handleExecute}
            disabled={executeMutation.isPending}
          >
            {executeMutation.isPending ? (
              <><Spinner size="sm" /> {t('controls.executing', { defaultValue: 'Executing...' })}</>
            ) : (
              <><Play className="w-3.5 h-3.5" /> {t('controls.execute', { defaultValue: 'Execute' })}</>
            )}
          </Button>
        )}

        {(isExecuting || isQueued) && (
          <Button
            size="sm"
            variant="danger"
            onClick={handleStop}
            disabled={stopMutation.isPending}
          >
            {stopMutation.isPending ? (
              <><Spinner size="sm" /> {t('controls.stopping', { defaultValue: 'Stopping...' })}</>
            ) : (
              <><Square className="w-3.5 h-3.5" /> {t('controls.stop', { defaultValue: 'Stop' })}</>
            )}
          </Button>
        )}
      </div>

      {/* Error display */}
      {executeMutation.isError && (
        <div className="text-xs text-red-500 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          {executeMutation.error?.message ?? t('controls.execute_error', { defaultValue: 'Failed to trigger execution' })}
        </div>
      )}
      {stopMutation.isError && (
        <div className="text-xs text-red-500 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          {stopMutation.error?.message ?? t('controls.stop_error', { defaultValue: 'Failed to stop execution' })}
        </div>
      )}

      {/* Attempt history summary */}
      {status && status.total_attempts > 0 && (
        <div className="text-xs text-slate-400 dark:text-slate-500">
          {t('controls.total_attempts', { defaultValue: '{{count}} attempt(s) total', count: status.total_attempts })}
        </div>
      )}
    </div>
  );
}
