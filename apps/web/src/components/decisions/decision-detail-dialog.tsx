import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Decision } from '../../lib/api';
import { Dialog } from '../common/dialog';
import { Button } from '../common/button';
import { Badge } from '../common/badge';
import { Textarea } from '../common/textarea';
import {
  Scale, CheckCircle2, AlertTriangle, FileText, Lightbulb,
  ThumbsUp, ArrowRight, BarChart3,
} from 'lucide-react';

interface DecisionDetailDialogProps {
  decision: Decision | null;
  caseId: string;
  open: boolean;
  onClose: () => void;
}

const stateVariant: Record<string, string> = {
  draft: 'neutral', requested: 'info', in_review: 'warning',
  decided: 'success', deferred: 'neutral', superseded: 'neutral', cancelled: 'neutral',
};

export function DecisionDetailDialog({ decision, caseId, open, onClose }: DecisionDetailDialogProps) {
  const { t } = useTranslation('decisions');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');

  const resolveDecision = useMutation({
    mutationFn: ({ id, option, rationale: r }: { id: string; option: string; rationale: string }) =>
      api.resolveDecision(id, option, r),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decisions', caseId] });
      qc.invalidateQueries({ queryKey: ['attention', caseId] });
      setSelectedOption(null);
      setRationale('');
      onClose();
    },
  });

  const requestRecommendation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/v1/decisions/${id}/recommend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('pos_token') ?? ''}`,
        },
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decisions', caseId] });
    },
  });

  if (!decision) return null;

  const isResolved = decision.state === 'decided';
  const hasOptions = decision.options.length > 0;
  const confidencePct = decision.recommendation_confidence != null
    ? Math.round(decision.recommendation_confidence * 100) : null;

  return (
    <Dialog open={open} onClose={onClose} title={t('detail.title', { defaultValue: 'Decision Detail' })} size="lg">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{decision.question}</h3>
            {decision.context && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{decision.context}</p>
            )}
          </div>
          <Badge variant={stateVariant[decision.state] as any}>
            {t(`state.${decision.state}`, { defaultValue: decision.state })}
          </Badge>
        </div>

        {/* Options */}
        {hasOptions && (
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              {t('detail.options', { defaultValue: 'Options' })} ({decision.options.length})
            </h4>
            <div className="space-y-3">
              {decision.options.map((opt, i) => {
                const isRecommended = decision.recommended_option != null &&
                  (decision.recommended_option === opt.label ||
                   JSON.stringify(decision.recommended_option) === JSON.stringify(opt.label));
                const isSelected = isResolved && (
                  decision.selected_option === opt.label ||
                  JSON.stringify(decision.selected_option) === JSON.stringify(opt.label)
                );
                const isUserSelected = selectedOption === opt.label;

                return (
                  <div
                    key={opt.id || i}
                    className={`rounded-lg border p-4 transition-all ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                        : isUserSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : isRecommended
                        ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/10'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">{opt.label}</p>
                          {isRecommended && (
                            <Badge variant="warning">
                              <ThumbsUp className="w-3 h-3 mr-1" />
                              {t('detail.recommended', { defaultValue: 'AI Recommended' })}
                            </Badge>
                          )}
                          {isSelected && (
                            <Badge variant="success">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              {t('detail.selected', { defaultValue: 'Selected' })}
                            </Badge>
                          )}
                        </div>
                        {opt.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{opt.description}</p>
                        )}

                        {/* Evidence */}
                        {opt.evidence_refs && opt.evidence_refs.length > 0 && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-blue-600">
                            <FileText className="w-3 h-3" />
                            {opt.evidence_refs.length} {t('detail.evidence_items', { defaultValue: 'evidence items' })}
                          </div>
                        )}

                        {/* Risks */}
                        {opt.risks && opt.risks.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-red-600 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {t('detail.risks', { defaultValue: 'Risks' })}:
                            </p>
                            <ul className="ml-4 mt-1 space-y-0.5">
                              {opt.risks.map((risk, ri) => (
                                <li key={ri} className="text-xs text-red-500">{risk}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Tradeoffs */}
                        {opt.tradeoffs && opt.tradeoffs.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-amber-600 flex items-center gap-1">
                              <Scale className="w-3 h-3" />
                              {t('detail.tradeoffs', { defaultValue: 'Tradeoffs' })}:
                            </p>
                            <ul className="ml-4 mt-1 space-y-0.5">
                              {opt.tradeoffs.map((to, ti) => (
                                <li key={ti} className="text-xs text-amber-500">{to}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Select button */}
                      {!isResolved && (
                        <Button
                          size="sm"
                          variant={isUserSelected ? 'primary' : 'secondary'}
                          onClick={() => setSelectedOption(opt.label)}
                        >
                          {isUserSelected ? (
                            <><CheckCircle2 className="w-3 h-3" /> {t('detail.chosen', { defaultValue: 'Chosen' })}</>
                          ) : (
                            t('select')
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI Recommendation */}
        {confidencePct != null && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-amber-600" />
              <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {t('detail.ai_recommendation', { defaultValue: 'AI Recommendation' })}
              </h4>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-1 bg-amber-200 dark:bg-amber-800 rounded-full h-2">
                <div
                  className="bg-amber-500 h-2 rounded-full transition-all"
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
              <span className="text-sm font-mono text-amber-700 dark:text-amber-300">{confidencePct}%</span>
            </div>
            {decision.recommendation_rationale && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{decision.recommendation_rationale}</p>
            )}
          </div>
        )}

        {/* Resolution (if decided) */}
        {isResolved && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                {t('detail.resolution', { defaultValue: 'Resolution' })}
              </h4>
            </div>
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {t('detail.decided_option', { defaultValue: 'Decided' })}: <strong>{String(decision.selected_option)}</strong>
            </p>
            {decision.rationale && (
              <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">{decision.rationale}</p>
            )}
          </div>
        )}

        {/* Resolution form */}
        {!isResolved && selectedOption && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
              <ArrowRight className="w-4 h-4" />
              {t('resolve.title', { defaultValue: 'Resolve Decision' })}
            </h4>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
              {t('resolve.selected', { defaultValue: 'Selected' })}: <strong>{selectedOption}</strong>
            </p>
            <Textarea
              label={t('resolve.rationale_label', { defaultValue: 'Rationale (required)' })}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder={t('resolve.rationale_placeholder', { defaultValue: 'Why did you choose this option?' })}
              rows={3}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
          <div>
            {!isResolved && hasOptions && confidencePct == null && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => requestRecommendation.mutate(decision.id)}
                loading={requestRecommendation.isPending}
              >
                <Lightbulb className="w-4 h-4" />
                {t('detail.get_recommendation', { defaultValue: 'Get AI Recommendation' })}
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose}>{tCommon('actions.close', { defaultValue: 'Close' })}</Button>
            {!isResolved && selectedOption && (
              <Button
                onClick={() => resolveDecision.mutate({
                  id: decision.id,
                  option: selectedOption,
                  rationale,
                })}
                loading={resolveDecision.isPending}
                disabled={!rationale.trim()}
              >
                <CheckCircle2 className="w-4 h-4" />
                {t('resolve.submit', { defaultValue: 'Resolve Decision' })}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
