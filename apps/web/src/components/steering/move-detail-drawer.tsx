import { useTranslation } from 'react-i18next';
import { useMove, useAttempts } from '../../hooks/use-moves';
import { useInstructionVersions } from '../../hooks/use-steering';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { SteeringComposer } from './steering-composer';
import { ExecutionControls } from '../execution/execution-controls';
import { Spinner } from '../common/spinner';
import {
  X, Play, Pause, Square, GitFork, UserCheck, AlertTriangle,
  Clock, Shield, CheckCircle2, Link2, HelpCircle, History,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';

const stateColors: Record<string, string> = {
  not_ready: 'neutral', ready: 'info', conditional: 'warning',
  not_started: 'neutral', queued: 'info', starting: 'info', running: 'success',
  pausing: 'warning', paused: 'warning', suspended: 'neutral', finishing: 'info', finished: 'neutral',
  not_required: 'neutral', pending: 'warning', passed: 'success', failed: 'danger', waived: 'neutral', stale: 'orange',
  autonomous: 'neutral', watch: 'info', human_input: 'warning', human_decision: 'orange', human_approval: 'orange', critical_intervention: 'danger',
  critical: 'danger', high: 'orange', medium: 'warning', low: 'success', none: 'neutral',
  ahead: 'success', on_track: 'success', at_risk: 'warning', overdue: 'danger', expired: 'danger',
  unsatisfied: 'neutral', partially_satisfied: 'warning', satisfied: 'success', cancelled: 'neutral', superseded: 'neutral', abandoned: 'neutral', not_applicable: 'neutral',
};

interface MoveDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  moveId: string | null;
  caseId: string;
}

export function MoveDetailDrawer({ open, onClose, moveId, caseId }: MoveDetailDrawerProps) {
  const { t, i18n } = useTranslation('steering');
  const { data: move, isLoading } = useMove(moveId ?? undefined);
  const { data: attempts } = useAttempts(moveId ?? undefined);
  const qc = useQueryClient();

  if (!open) return null;

  // The attempt steering targets: prefer a running attempt, else the most recent one
  // (attempts are returned newest-first — see GET /v1/moves/:id/attempts).
  const currentAttempt = attempts?.find((a) => a.state === 'running') ?? attempts?.[0];

  const handleAction = async (action: string) => {
    if (!moveId) return;
    try {
      switch (action) {
        case 'activate': await api.activateMove(moveId); break;
        case 'pause': await api.pauseMove(moveId); break;
        case 'resume': await api.resumeMove(moveId); break;
        case 'cancel': await api.cancelMove(moveId); break;
        case 'satisfy': await api.satisfyMove(moveId); break;
      }
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
      qc.invalidateQueries({ queryKey: ['move', moveId] });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('drawer.title')}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20"><Spinner /></div>
        ) : move ? (
          <div className="px-6 py-4 space-y-6">
            {/* Title */}
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{move.title}</h2>
              {move.objective && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{move.objective}</p>}
            </div>

            {/* State Vector */}
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">{t('drawer.state_vector')}</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: t('drawer.readiness'), value: move.readiness },
                  { label: t('drawer.execution'), value: move.execution },
                  { label: t('drawer.verification'), value: move.verification },
                  { label: t('drawer.attention'), value: move.attention },
                  { label: t('drawer.risk'), value: move.risk_level },
                  { label: t('drawer.temporal'), value: move.temporal },
                  { label: t('drawer.outcome'), value: move.outcome },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
                    <Badge variant={(stateColors[value] || 'neutral') as any}>{value.replace(/_/g, ' ')}</Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">{t('drawer.actions')}</h4>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => handleAction('activate')}>
                  <Play className="w-3.5 h-3.5" /> {t('drawer.action_activate')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleAction('pause')}>
                  <Pause className="w-3.5 h-3.5" /> {t('drawer.action_pause')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleAction('resume')}>
                  <Play className="w-3.5 h-3.5" /> {t('drawer.action_resume')}
                </Button>
                <Button size="sm" variant="danger" onClick={() => handleAction('cancel')}>
                  <Square className="w-3.5 h-3.5" /> {t('drawer.action_cancel')}
                </Button>
                <Button size="sm" variant="primary" onClick={() => handleAction('satisfy')}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> {t('drawer.action_satisfy')}
                </Button>
              </div>
            </div>

            {/* Execution Controls (SP3) */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              <ExecutionControls
                moveId={move.id}
                caseId={caseId}
                moveClass={move.class}
                execution={move.execution}
              />
            </div>

            {/* Dependencies */}
            {move.dependencies.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">
                  {t('drawer.dependencies', { count: move.dependencies.length })}
                </h4>
                <div className="space-y-1">
                  {move.dependencies.map((depId) => (
                    <div key={depId} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <Link2 className="w-3.5 h-3.5" />
                      <span className="font-mono text-xs">{depId.slice(0, 8)}...</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attempts */}
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">
                {t('drawer.attempts', { count: attempts?.length || 0 })}
              </h4>
              {attempts?.length ? (
                <div className="space-y-2">
                  {attempts.map((att) => (
                    <div key={att.id} className="bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{att.strategy}</span>
                        <Badge variant={(stateColors[att.state] || 'neutral') as any}>{att.state}</Badge>
                      </div>
                      {att.model && <p className="text-xs text-slate-400 mt-1">{t('drawer.model', { value: att.model })}</p>}
                      {att.failure_reason && <p className="text-xs text-red-500 mt-1">{att.failure_reason}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">{t('drawer.no_attempts')}</p>
              )}
            </div>

            {/* Instruction Version History (spec §1.4) */}
            {currentAttempt && (
              <InstructionVersionHistory attemptId={currentAttempt.id} />
            )}

            {/* Steering */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              <SteeringComposer caseId={caseId} moveId={move.id} attemptId={currentAttempt?.id} />
            </div>

            {/* Metadata */}
            <div className="text-xs text-slate-400 dark:text-slate-500 space-y-1 border-t border-slate-200 dark:border-slate-700 pt-4">
              <p>{t('drawer.id', { value: move.id })}</p>
              <p>{t('drawer.created', { value: new Date(move.created_at).toLocaleString(i18n.language) })}</p>
              <p>{t('drawer.revision', { value: move.revision })}</p>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500">{t('drawer.not_found')}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instruction Version History component
// ---------------------------------------------------------------------------

function InstructionVersionHistory({ attemptId }: { attemptId: string }) {
  const { t, i18n } = useTranslation('steering');
  const { data: versions, isLoading } = useInstructionVersions(attemptId);

  if (isLoading || !versions || versions.length === 0) return null;

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
      <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2 flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" />
        {t('drawer.instruction_versions', { defaultValue: 'Instruction Versions', count: versions.length })}
      </h4>
      <div className="space-y-2">
        {versions.map((v) => (
          <div key={v.id} className="bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('drawer.version_label', { defaultValue: 'v{{version}}', version: v.version })}
              </span>
              <span className="text-[10px] text-slate-400">
                {new Date(v.created_at).toLocaleString(i18n.language)}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3">
              {v.instructions}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
