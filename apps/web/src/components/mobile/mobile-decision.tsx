/**
 * Mobile-Optimized Decision Approval (SP6 §3.1)
 *
 * Full decision card with approve/reject actions.
 * Designed for one-tap approval with confirmation.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Decision } from '../../lib/api';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { Textarea } from '../common/textarea';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import {
  Scale, CheckCircle, XCircle, ChevronLeft,
  FileCheck, AlertTriangle, Clock, ThumbsUp, ThumbsDown,
} from 'lucide-react';

export function MobileDecision() {
  const { t } = useTranslation('decisions');
  const { caseId } = useParams();
  const navigate = useNavigate();

  const { data: decisions, isLoading } = useQuery({
    queryKey: ['decisions', caseId],
    queryFn: () => api.listDecisions(caseId!),
    enabled: !!caseId,
    refetchInterval: 15000,
  });

  if (isLoading) return <FullPageSpinner />;

  const pending = (decisions ?? []).filter((d) => d.state === 'open' || d.state === 'recommended');

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 safe-top">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-slate-400">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <Scale className="w-5 h-5 text-emerald-600" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            {t('title')}
          </h1>
          {pending.length > 0 && (
            <Badge variant="warning">{pending.length}</Badge>
          )}
        </div>
      </div>

      {/* Decision cards */}
      <div className="flex-1 p-4 space-y-4">
        {pending.length === 0 ? (
          <EmptyState
            icon={<CheckCircle className="w-12 h-12 text-emerald-500" />}
            title={t('no_pending_mobile')}
            description={t('no_pending_mobile_description')}
          />
        ) : (
          pending.map((decision) => (
            <MobileDecisionCard key={decision.id} decision={decision} caseId={caseId!} />
          ))
        )}
      </div>
    </div>
  );
}

function MobileDecisionCard({ decision, caseId }: { decision: Decision; caseId: string }) {
  const { t } = useTranslation('decisions');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);

  const resolve = useMutation({
    mutationFn: ({ option, rationale }: { option: unknown; rationale: string }) =>
      api.resolveDecision(decision.id, option, rationale),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decisions', caseId] });
      setConfirming(null);
      setRationale('');
    },
  });

  const hasRecommendation = decision.state === 'recommended' && decision.recommended_option;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
      {/* Question */}
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3">
          <Scale className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
              {decision.question}
            </p>
            {decision.context && (
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                {decision.context}
              </p>
            )}
          </div>
        </div>

        {hasRecommendation && (
          <div className="mt-3 p-2 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg">
            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              <ThumbsUp className="w-3 h-3 inline mr-1" />
              {t('recommended')}: {(decision.recommended_option as { label?: string })?.label ?? String(decision.recommended_option)}
            </p>
            {decision.recommendation_confidence && (
              <p className="text-[10px] text-emerald-600/60 mt-0.5">
                {Math.round(decision.recommendation_confidence * 100)}% confidence
              </p>
            )}
          </div>
        )}
      </div>

      {/* Options (expanded) */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-3">
          {decision.options.map((option) => (
            <button
              key={option.id}
              onClick={() => setSelectedOption(option.id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selectedOption === option.id
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
              }`}
            >
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {option.label}
              </p>
              {option.description && (
                <p className="text-xs text-slate-500 mt-1">{option.description}</p>
              )}
              {option.risks && option.risks.length > 0 && (
                <div className="flex items-center gap-1 mt-1">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  <span className="text-[10px] text-amber-600">{option.risks.join(', ')}</span>
                </div>
              )}
            </button>
          ))}

          {/* Confirmation */}
          {confirming ? (
            <div className="space-y-3 pt-2">
              <Textarea
                label={t('rationale')}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder={t('rationale_placeholder')}
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(null)}
                  className="flex-1"
                >
                  {tCommon('actions.cancel')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const option = selectedOption
                      ? decision.options.find((o) => o.id === selectedOption)
                      : decision.recommended_option;
                    resolve.mutate({ option, rationale });
                  }}
                  loading={resolve.isPending}
                  className="flex-1"
                >
                  {confirming === 'approve' ? (
                    <><CheckCircle className="w-4 h-4" /> {t('confirm_approve')}</>
                  ) : (
                    <><XCircle className="w-4 h-4" /> {t('confirm_reject')}</>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfirming('reject');
                }}
                className="flex-1 text-red-600"
              >
                <ThumbsDown className="w-4 h-4" />
                {t('reject')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!selectedOption && !hasRecommendation) return;
                  setConfirming('approve');
                }}
                disabled={!selectedOption && !hasRecommendation}
                className="flex-1"
              >
                <ThumbsUp className="w-4 h-4" />
                {t('approve')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
