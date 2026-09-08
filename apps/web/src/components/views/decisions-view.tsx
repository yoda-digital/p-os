import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDecisions, useCreateDecision, useResolveDecision } from '../../hooks/use-decisions';
import { DecisionDetailDialog } from '../decisions/decision-detail-dialog';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { Dialog } from '../common/dialog';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import type { Decision } from '../../lib/api';
import {
  Scale, Plus, CheckCircle2, Clock, AlertTriangle,
  BarChart3, ThumbsUp, Eye, Lightbulb,
} from 'lucide-react';

const stateVariant: Record<string, string> = {
  draft: 'neutral', requested: 'info', in_review: 'warning',
  decided: 'success', deferred: 'neutral', superseded: 'neutral', cancelled: 'neutral',
};

export function DecisionsView() {
  const { t } = useTranslation('decisions');
  const { t: tCommon } = useTranslation('common');
  const { caseId } = useParams<{ caseId: string }>();
  const { data: decisions, isLoading } = useDecisions(caseId);
  const createDecision = useCreateDecision(caseId!);
  const resolveDecision = useResolveDecision(caseId!);
  const [createOpen, setCreateOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [optionInputs, setOptionInputs] = useState<Array<{ label: string; description: string }>>([
    { label: '', description: '' },
    { label: '', description: '' },
  ]);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [detailDecision, setDetailDecision] = useState<Decision | null>(null);

  if (isLoading) return <FullPageSpinner />;

  const pending = decisions?.filter(d => ['draft', 'requested', 'in_review'].includes(d.state)) || [];
  const resolved = decisions?.filter(d => d.state === 'decided') || [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const validOptions = optionInputs.filter(o => o.label.trim());
    await createDecision.mutateAsync({
      question,
      context: context || undefined,
      options: validOptions.length > 0 ? validOptions : undefined,
    });
    setQuestion('');
    setContext('');
    setOptionInputs([{ label: '', description: '' }, { label: '', description: '' }]);
    setCreateOpen(false);
  };

  const handleResolve = async (decisionId: string, option: string) => {
    await resolveDecision.mutateAsync({ id: decisionId, option, rationale });
    setResolveId(null);
    setRationale('');
    setSelectedOption('');
  };

  const addOption = () => {
    setOptionInputs([...optionInputs, { label: '', description: '' }]);
  };

  const updateOption = (idx: number, field: 'label' | 'description', value: string) => {
    const updated = [...optionInputs];
    updated[idx] = { ...updated[idx]!, [field]: value };
    setOptionInputs(updated);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
          {pending.length > 0 && (
            <Badge variant="warning">{pending.length} {t('pending_short', { defaultValue: 'pending' })}</Badge>
          )}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> {t('new_decision')}
        </Button>
      </div>

      {/* Pending */}
      {pending.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            {t('pending', { count: pending.length })}
          </h3>
          <div className="space-y-4">
            {pending.map(d => {
              const confidencePct = d.recommendation_confidence != null
                ? Math.round(d.recommendation_confidence * 100) : null;

              return (
                <div key={d.id} className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-800 p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="text-base font-medium text-slate-900 dark:text-white">{d.question}</h4>
                    <div className="flex items-center gap-2">
                      <Badge variant={stateVariant[d.state] as any}>{t(`state.${d.state}`, { defaultValue: d.state })}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => setDetailDecision(d)}>
                        <Eye className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  {d.context && <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{d.context}</p>}

                  {/* Options with evidence/risks */}
                  {d.options.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {d.options.map((opt, i) => {
                        const isRecommended = d.recommended_option != null &&
                          (d.recommended_option === opt.label || JSON.stringify(d.recommended_option) === JSON.stringify(opt.label));

                        return (
                          <div
                            key={opt.id || i}
                            className={`flex items-center gap-3 rounded-lg p-3 ${
                              isRecommended
                                ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700'
                                : 'bg-slate-50 dark:bg-slate-800'
                            }`}
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{opt.label}</p>
                                {isRecommended && (
                                  <span className="text-xs text-amber-600 flex items-center gap-0.5">
                                    <ThumbsUp className="w-3 h-3" /> {t('detail.recommended', { defaultValue: 'Recommended' })}
                                  </span>
                                )}
                              </div>
                              {opt.description && <p className="text-xs text-slate-400">{opt.description}</p>}
                              <div className="flex items-center gap-3 mt-1">
                                {opt.evidence_refs && opt.evidence_refs.length > 0 && (
                                  <span className="text-xs text-blue-500">{opt.evidence_refs.length} evidence</span>
                                )}
                                {opt.risks && opt.risks.length > 0 && (
                                  <span className="text-xs text-red-500 flex items-center gap-0.5">
                                    <AlertTriangle className="w-3 h-3" /> {opt.risks.length} risks
                                  </span>
                                )}
                                {opt.tradeoffs && opt.tradeoffs.length > 0 && (
                                  <span className="text-xs text-amber-500">{opt.tradeoffs.length} tradeoffs</span>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => { setResolveId(d.id); setSelectedOption(opt.label); }}
                            >
                              {t('select')}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* AI Recommendation bar */}
                  {confidencePct != null && (
                    <div className="mb-3 flex items-center gap-3">
                      <BarChart3 className="w-4 h-4 text-amber-500" />
                      <div className="flex-1 bg-amber-100 dark:bg-amber-900/30 rounded-full h-2">
                        <div
                          className="bg-amber-500 h-2 rounded-full transition-all"
                          style={{ width: `${confidencePct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-amber-600">{confidencePct}%</span>
                      {d.recommendation_rationale && (
                        <span className="text-xs text-slate-400 truncate max-w-[200px]">{d.recommendation_rationale}</span>
                      )}
                    </div>
                  )}

                  {d.blocking_move_ids.length > 0 && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {t('blocking_moves', { count: d.blocking_move_ids.length })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            {t('resolved', { count: resolved.length })}
          </h3>
          <div className="space-y-3">
            {resolved.map(d => (
              <div
                key={d.id}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                onClick={() => setDetailDecision(d)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">{d.question}</h4>
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {String(d.selected_option)} — {d.rationale}
                    </p>
                  </div>
                  <Badge variant="success">{t('state.decided')}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(!decisions || decisions.length === 0) && (
        <EmptyState
          icon={<Scale className="w-12 h-12" />}
          title={t('empty.title')}
          description={t('empty.description')}
          action={{ label: t('empty.action'), onClick: () => setCreateOpen(true) }}
        />
      )}

      {/* Create Dialog — now with options */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('create.title')}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label={t('create.question_label')} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('create.question_placeholder')} required autoFocus />
          <Textarea label={t('create.context_label')} value={context} onChange={(e) => setContext(e.target.value)} placeholder={t('create.context_placeholder')} />

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              <Lightbulb className="w-4 h-4 inline mr-1" />
              {t('create.options_label', { defaultValue: 'Options (optional)' })}
            </label>
            <div className="space-y-2">
              {optionInputs.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder={t('create.option_label_placeholder', { defaultValue: `Option ${i + 1}` })}
                    value={opt.label}
                    onChange={(e) => updateOption(i, 'label', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder={t('create.option_desc_placeholder', { defaultValue: 'Description' })}
                    value={opt.description}
                    onChange={(e) => updateOption(i, 'description', e.target.value)}
                    className="flex-1"
                  />
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" onClick={addOption}>
                <Plus className="w-3 h-3" /> {t('create.add_option', { defaultValue: 'Add option' })}
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>{tCommon('actions.cancel')}</Button>
            <Button type="submit" loading={createDecision.isPending}>{t('create.submit')}</Button>
          </div>
        </form>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={!!resolveId} onClose={() => setResolveId(null)} title={t('resolve.title')}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('resolve.selected')} <strong>{selectedOption}</strong></p>
          <Textarea label={t('resolve.rationale_label')} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder={t('resolve.rationale_placeholder')} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setResolveId(null)}>{tCommon('actions.cancel')}</Button>
            <Button onClick={() => resolveId && handleResolve(resolveId, selectedOption)} loading={resolveDecision.isPending}>
              {t('resolve.submit')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Decision Detail Dialog */}
      <DecisionDetailDialog
        decision={detailDecision}
        caseId={caseId!}
        open={!!detailDecision}
        onClose={() => setDetailDecision(null)}
      />
    </div>
  );
}
