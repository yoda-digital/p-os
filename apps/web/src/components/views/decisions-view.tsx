import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDecisions, useCreateDecision, useResolveDecision } from '../../hooks/use-decisions';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { Dialog } from '../common/dialog';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Scale, Plus, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

const stateVariant: Record<string, string> = {
  draft: 'neutral', requested: 'info', in_review: 'warning',
  decided: 'success', deferred: 'neutral', superseded: 'neutral', cancelled: 'neutral',
};

export function DecisionsView() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: decisions, isLoading } = useDecisions(caseId);
  const createDecision = useCreateDecision(caseId!);
  const resolveDecision = useResolveDecision(caseId!);
  const [createOpen, setCreateOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [selectedOption, setSelectedOption] = useState('');

  if (isLoading) return <FullPageSpinner />;

  const pending = decisions?.filter(d => ['draft', 'requested', 'in_review'].includes(d.state)) || [];
  const resolved = decisions?.filter(d => d.state === 'decided') || [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createDecision.mutateAsync({ question, context: context || undefined });
    setQuestion('');
    setContext('');
    setCreateOpen(false);
  };

  const handleResolve = async (decisionId: string, option: string) => {
    await resolveDecision.mutateAsync({ id: decisionId, option, rationale });
    setResolveId(null);
    setRationale('');
    setSelectedOption('');
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Decisions</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New Decision
        </Button>
      </div>

      {/* Pending */}
      {pending.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Pending ({pending.length})
          </h3>
          <div className="space-y-4">
            {pending.map(d => (
              <div key={d.id} className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-800 p-5">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-base font-medium text-slate-900 dark:text-white">{d.question}</h4>
                  <Badge variant={stateVariant[d.state] as any}>{d.state.replace(/_/g, ' ')}</Badge>
                </div>
                {d.context && <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{d.context}</p>}

                {d.options.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {d.options.map((opt, i) => (
                      <div key={opt.id || i} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{opt.label}</p>
                          {opt.description && <p className="text-xs text-slate-400">{opt.description}</p>}
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => { setResolveId(d.id); setSelectedOption(opt.label); }}
                        >
                          Select
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {d.recommendation_confidence != null && (
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    AI confidence: {(d.recommendation_confidence * 100).toFixed(0)}%
                    {d.recommendation_rationale && ` — ${d.recommendation_rationale}`}
                  </p>
                )}

                {d.blocking_move_ids.length > 0 && (
                  <p className="text-xs text-amber-600 mt-1">Blocking {d.blocking_move_ids.length} move(s)</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Resolved ({resolved.length})
          </h3>
          <div className="space-y-3">
            {resolved.map(d => (
              <div key={d.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">{d.question}</h4>
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {String(d.selected_option)} — {d.rationale}
                    </p>
                  </div>
                  <Badge variant="success">Decided</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(!decisions || decisions.length === 0) && (
        <EmptyState
          icon={<Scale className="w-12 h-12" />}
          title="No decisions"
          description="Decisions will appear when the process requires human judgment"
          action={{ label: 'Create Decision', onClick: () => setCreateOpen(true) }}
        />
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create Decision">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What needs to be decided?" required autoFocus />
          <Textarea label="Context" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Relevant background..." />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" loading={createDecision.isPending}>Create</Button>
          </div>
        </form>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={!!resolveId} onClose={() => setResolveId(null)} title="Resolve Decision">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">Selected: <strong>{selectedOption}</strong></p>
          <Textarea label="Rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this option?" />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setResolveId(null)}>Cancel</Button>
            <Button onClick={() => resolveId && handleResolve(resolveId, selectedOption)} loading={resolveDecision.isPending}>
              Resolve
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
