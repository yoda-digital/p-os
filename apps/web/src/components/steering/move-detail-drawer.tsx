import { useMove, useAttempts } from '../../hooks/use-moves';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { SteeringPanel } from './steering-panel';
import { Spinner } from '../common/spinner';
import {
  X, Play, Pause, Square, GitFork, UserCheck, AlertTriangle,
  Clock, Shield, CheckCircle2, Link2, HelpCircle,
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
  const { data: move, isLoading } = useMove(moveId ?? undefined);
  const { data: attempts } = useAttempts(moveId ?? undefined);
  const qc = useQueryClient();

  if (!open) return null;

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
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Move Detail</h3>
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
              <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">State Vector</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Readiness', value: move.readiness },
                  { label: 'Execution', value: move.execution },
                  { label: 'Verification', value: move.verification },
                  { label: 'Attention', value: move.attention },
                  { label: 'Risk', value: move.risk_level },
                  { label: 'Temporal', value: move.temporal },
                  { label: 'Outcome', value: move.outcome },
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
              <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Actions</h4>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => handleAction('activate')}>
                  <Play className="w-3.5 h-3.5" /> Activate
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleAction('pause')}>
                  <Pause className="w-3.5 h-3.5" /> Pause
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleAction('resume')}>
                  <Play className="w-3.5 h-3.5" /> Resume
                </Button>
                <Button size="sm" variant="danger" onClick={() => handleAction('cancel')}>
                  <Square className="w-3.5 h-3.5" /> Cancel
                </Button>
                <Button size="sm" variant="primary" onClick={() => handleAction('satisfy')}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Satisfy
                </Button>
              </div>
            </div>

            {/* Dependencies */}
            {move.dependencies.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">
                  Dependencies ({move.dependencies.length})
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
                Attempts ({attempts?.length || 0})
              </h4>
              {attempts?.length ? (
                <div className="space-y-2">
                  {attempts.map((att) => (
                    <div key={att.id} className="bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{att.strategy}</span>
                        <Badge variant={(stateColors[att.state] || 'neutral') as any}>{att.state}</Badge>
                      </div>
                      {att.model && <p className="text-xs text-slate-400 mt-1">Model: {att.model}</p>}
                      {att.failure_reason && <p className="text-xs text-red-500 mt-1">{att.failure_reason}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No attempts yet</p>
              )}
            </div>

            {/* Steering */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              <SteeringPanel caseId={caseId} moveId={move.id} />
            </div>

            {/* Metadata */}
            <div className="text-xs text-slate-400 dark:text-slate-500 space-y-1 border-t border-slate-200 dark:border-slate-700 pt-4">
              <p>ID: {move.id}</p>
              <p>Created: {new Date(move.created_at).toLocaleString()}</p>
              <p>Revision: {move.revision}</p>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500">Move not found</div>
        )}
      </div>
    </div>
  );
}
