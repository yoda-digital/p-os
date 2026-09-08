/**
 * Mobile-Optimized Attention View (SP6 §3.1)
 *
 * Priority-sorted card list with swipe-style actions.
 * Designed for phone screens — action over configuration.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type AttentionItem } from '../../lib/api';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import {
  AlertTriangle, CheckCircle, Clock, ArrowRight,
  Bell, ChevronRight, Shield, Scale, MessageSquare,
} from 'lucide-react';

const priorityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const priorityColors: Record<string, string> = {
  critical: 'border-l-red-500 bg-red-50 dark:bg-red-950/30',
  high: 'border-l-orange-500 bg-orange-50 dark:bg-orange-950/30',
  medium: 'border-l-yellow-500 bg-yellow-50 dark:bg-yellow-950/30',
  low: 'border-l-slate-300 bg-slate-50 dark:bg-slate-900',
};

const priorityBadgeVariant: Record<string, 'danger' | 'warning' | 'neutral'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'neutral',
};

function getActionIcon(action?: string) {
  if (!action) return <ArrowRight className="w-4 h-4" />;
  if (action.toLowerCase().includes('approv')) return <CheckCircle className="w-4 h-4" />;
  if (action.toLowerCase().includes('decid') || action.toLowerCase().includes('decision')) return <Scale className="w-4 h-4" />;
  if (action.toLowerCase().includes('review')) return <Shield className="w-4 h-4" />;
  return <ArrowRight className="w-4 h-4" />;
}

export function MobileAttention() {
  const { t } = useTranslation('attention');
  const { t: tCommon } = useTranslation('common');
  const { caseId } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'critical' | 'high'>('all');

  const { data: items, isLoading } = useQuery({
    queryKey: ['attention', caseId],
    queryFn: () => api.getAttention(caseId!),
    enabled: !!caseId,
    refetchInterval: 10000, // Poll every 10s on mobile
  });

  if (isLoading) return <FullPageSpinner />;

  const sorted = [...(items ?? [])]
    .filter((i) => !i.resolved)
    .sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 3;
      const pb = priorityOrder[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return b.blocking_impact - a.blocking_impact;
    })
    .filter((i) => {
      if (filter === 'all') return true;
      if (filter === 'critical') return i.priority === 'critical';
      if (filter === 'high') return i.priority === 'critical' || i.priority === 'high';
      return true;
    });

  const criticalCount = (items ?? []).filter((i) => !i.resolved && i.priority === 'critical').length;
  const highCount = (items ?? []).filter((i) => !i.resolved && i.priority === 'high').length;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Mobile header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 safe-top">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-emerald-600" />
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              {t('title')}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            {criticalCount > 0 && (
              <Badge variant="danger">{criticalCount}</Badge>
            )}
            {highCount > 0 && (
              <Badge variant="warning">{highCount}</Badge>
            )}
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1 -mx-1 px-1">
          {(['all', 'critical', 'high'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                filter === f
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {f === 'all' ? tCommon('filters.all') : f === 'critical' ? tCommon('filters.critical') : tCommon('filters.high')}
            </button>
          ))}
        </div>
      </div>

      {/* Attention cards */}
      <div className="flex-1 p-4 space-y-3">
        {sorted.length === 0 ? (
          <EmptyState
            icon={<CheckCircle className="w-12 h-12 text-emerald-500" />}
            title={t('empty_mobile')}
            description={t('empty_mobile_description')}
          />
        ) : (
          sorted.map((item) => (
            <MobileAttentionCard
              key={item.id}
              item={item}
              onTap={() => {
                if (item.move_id) {
                  navigate(`/cases/${item.case_id}/kanban`);
                } else if (item.decision_id) {
                  navigate(`/cases/${item.case_id}/decisions`);
                }
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MobileAttentionCard({
  item,
  onTap,
}: {
  item: AttentionItem;
  onTap: () => void;
}) {
  const priority = item.priority ?? 'medium';
  const colorClass = priorityColors[priority] ?? priorityColors.medium;
  const badgeVariant = priorityBadgeVariant[priority] ?? 'neutral';

  return (
    <div
      className={`rounded-xl border-l-4 p-4 shadow-sm cursor-pointer active:scale-[0.98] transition-transform ${colorClass}`}
      onClick={onTap}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={badgeVariant} className="text-[10px] uppercase">
              {priority}
            </Badge>
            {item.deadline && (
              <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {new Date(item.deadline).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-slate-900 dark:text-white leading-snug">
            {item.reason}
          </p>
          {item.action_required && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              {getActionIcon(item.action_required)}
              <span>{item.action_required}</span>
            </div>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-slate-300 flex-shrink-0 mt-1" />
      </div>

      {item.blocking_impact > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
          <span className="text-[10px] text-slate-500">
            <AlertTriangle className="w-3 h-3 inline mr-0.5" />
            Blocking {item.blocking_impact} item{item.blocking_impact > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
