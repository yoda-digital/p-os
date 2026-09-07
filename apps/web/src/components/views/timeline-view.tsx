import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTimeline } from '../../hooks/use-timeline';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Badge } from '../common/badge';
import {
  Clock, Plus, Play, Pause, CheckCircle2, XCircle, AlertTriangle,
  FileText, ArrowRight, Eye, MessageSquare, Shield, GitFork,
} from 'lucide-react';
import { useState } from 'react';

const eventIcons: Record<string, typeof Plus> = {
  CaseCreated: Plus, CaseUpdated: FileText, CaseClosed: CheckCircle2,
  MoveCreated: Plus, MoveActivated: Play, MovePaused: Pause,
  MoveResumed: Play, MoveCancelled: XCircle, MoveSatisfied: CheckCircle2,
  AttemptStarted: Play, AttemptSucceeded: CheckCircle2, AttemptFailed: XCircle,
  EvidenceAttached: Shield, DecisionCreated: MessageSquare, DecisionResolved: CheckCircle2,
  SteeringIssued: ArrowRight, RuleEvaluated: Shield,
};

const eventVariant: Record<string, string> = {
  CaseCreated: 'info', MoveCreated: 'info', MoveActivated: 'success',
  MovePaused: 'warning', MoveCancelled: 'danger', MoveSatisfied: 'success',
  AttemptStarted: 'info', AttemptSucceeded: 'success', AttemptFailed: 'danger',
  EvidenceAttached: 'purple', DecisionResolved: 'success', SteeringIssued: 'orange',
};

export function TimelineView() {
  const { t, i18n } = useTranslation('timeline');
  const { caseId } = useParams<{ caseId: string }>();
  const { data: entries, isLoading } = useTimeline(caseId);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (isLoading) return <FullPageSpinner />;

  const allTypes = [...new Set(entries?.map(e => e.type) || [])];
  const filtered = filter === 'all' ? entries : entries?.filter(e => e.type === filter);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 text-xs rounded-full ${filter === 'all' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
        >
          {t('filter.all')}
        </button>
        {allTypes.map(evtType => (
          <button
            key={evtType}
            onClick={() => setFilter(evtType)}
            className={`px-3 py-1 text-xs rounded-full ${filter === evtType ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
          >
            {t(`event_types.${evtType}`, { defaultValue: evtType })}
          </button>
        ))}
      </div>

      {(!filtered || filtered.length === 0) ? (
        <EmptyState icon={<Clock className="w-12 h-12" />} title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700" />
          <div className="space-y-4">
            {filtered.map((entry) => {
              const Icon = eventIcons[entry.type] || FileText;
              const variant = eventVariant[entry.type] || 'neutral';
              const isExpanded = expanded.has(entry.event_id);

              return (
                <div key={entry.event_id} className="relative flex gap-4 pl-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 bg-white dark:bg-slate-900 border-2 ${variant === 'success' ? 'border-emerald-500' : variant === 'danger' ? 'border-red-500' : variant === 'warning' ? 'border-amber-500' : 'border-slate-300 dark:border-slate-600'}`}>
                    <Icon className="w-3 h-3 text-slate-600 dark:text-slate-400" />
                  </div>
                  <div
                    className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-600 transition-colors"
                    onClick={() => toggleExpand(entry.event_id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={variant as any}>{t(`event_types.${entry.type}`, { defaultValue: entry.type })}</Badge>
                        <span className="text-sm text-slate-700 dark:text-slate-300">{entry.summary}</span>
                      </div>
                      <span className="text-xs text-slate-400">{new Date(entry.occurred_at).toLocaleString(i18n.language)}</span>
                    </div>
                    {isExpanded && Object.keys(entry.details).length > 0 && (
                      <pre className="mt-2 text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded p-2 overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
