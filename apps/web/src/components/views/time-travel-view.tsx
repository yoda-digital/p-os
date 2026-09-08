import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTimeline } from '../../hooks/use-timeline';
import { api, type CaseSnapshot } from '../../lib/api';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { Textarea } from '../common/textarea';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { History, Clock, ArrowRight, ArrowLeftRight, HelpCircle, Plus, Minus, PenLine } from 'lucide-react';

interface DiffChange {
  type: 'added' | 'removed' | 'modified';
  entity_type: string;
  entity_id: string;
  field?: string;
  before: unknown;
  after: unknown;
}

interface DiffResponse {
  case_id: string;
  from_sequence: number;
  to_sequence: number;
  events_between: number;
  changes: DiffChange[];
  events: Array<{ id: string; type: string; sequence: number; occurred_at: string; actor_id?: string; summary: string }>;
}

interface HistoricalWhyResult {
  historical: boolean;
  at_sequence?: number;
  at_time?: string;
  event_count: number;
  why_result: {
    question: string;
    question_type?: string;
    explanation: string;
    causal_chain: Array<{ id: string; type: string; description: string; timestamp: string }>;
    deterministic: boolean;
  };
}

export function TimeTravelView() {
  const { t, i18n } = useTranslation('time-travel');
  const { t: tTimeline } = useTranslation('timeline');
  const { t: tCommon } = useTranslation('common');
  const { caseId } = useParams<{ caseId: string }>();
  const { data: timeline, isLoading } = useTimeline(caseId);
  const [snapshot, setSnapshot] = useState<CaseSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [selectedSequence, setSelectedSequence] = useState<number | null>(null);

  // Diff state
  const [diffMode, setDiffMode] = useState(false);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [diffTo, setDiffTo] = useState<number | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Historical WHY state
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyQuestion, setWhyQuestion] = useState('');
  const [whyResult, setWhyResult] = useState<HistoricalWhyResult | null>(null);
  const [whyLoading, setWhyLoading] = useState(false);

  if (isLoading) return <FullPageSpinner />;

  if (!timeline || timeline.length === 0) {
    return <EmptyState icon={<History className="w-12 h-12" />} title={t('empty.title')} description={t('empty.description')} />;
  }

  const handleSelectEvent = async (eventId: string, idx: number) => {
    if (!caseId) return;

    if (diffMode) {
      // In diff mode, select from/to
      const seq = idx + 1; // sequence is 1-based
      if (diffFrom === null) {
        setDiffFrom(seq);
      } else if (diffTo === null) {
        setDiffTo(seq);
        // Trigger diff
        const fromSeq = Math.min(diffFrom, seq);
        const toSeq = Math.max(diffFrom, seq);
        setDiffLoading(true);
        try {
          const res = await api.getTimeTravelDiff(caseId, fromSeq, toSeq);
          setDiffResult(res as unknown as DiffResponse);
        } catch {
          setDiffResult(null);
        } finally {
          setDiffLoading(false);
        }
      } else {
        // Reset
        setDiffFrom(seq);
        setDiffTo(null);
        setDiffResult(null);
      }
      return;
    }

    setSelectedEvent(eventId);
    setSelectedSequence(idx + 1);
    setLoading(true);
    try {
      const snap = await api.getCaseAtEvent(caseId, eventId);
      setSnapshot(snap);
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  };

  const handleHistoricalWhy = async () => {
    if (!caseId || !whyQuestion.trim() || selectedSequence === null) return;
    setWhyLoading(true);
    try {
      const res = await api.historicalWhy(caseId, whyQuestion, selectedSequence);
      setWhyResult(res as unknown as HistoricalWhyResult);
    } catch {
      setWhyResult(null);
    } finally {
      setWhyLoading(false);
    }
  };

  const sliderIdx = selectedEvent ? timeline.findIndex(e => e.event_id === selectedEvent) : -1;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={diffMode ? 'primary' : 'secondary'}
            onClick={() => { setDiffMode(!diffMode); setDiffFrom(null); setDiffTo(null); setDiffResult(null); }}
          >
            <ArrowLeftRight className="w-4 h-4" /> {t('diff.toggle')}
          </Button>
        </div>
      </div>

      {/* Diff mode instructions */}
      {diffMode && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 mb-4 text-sm text-blue-700 dark:text-blue-400">
          {diffFrom === null
            ? t('diff.select_from')
            : diffTo === null
              ? t('diff.select_to', { from: diffFrom })
              : t('diff.comparing', { from: Math.min(diffFrom, diffTo), to: Math.max(diffFrom, diffTo) })}
        </div>
      )}

      {/* Timeline slider */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 mb-6">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
          {t('slider.label', { count: timeline.length })}
        </label>
        <input
          type="range"
          min={0}
          max={timeline.length - 1}
          value={sliderIdx >= 0 ? sliderIdx : 0}
          onChange={(e) => {
            const idx = parseInt(e.target.value);
            const entry = timeline[idx];
            if (entry) handleSelectEvent(entry.event_id, idx);
          }}
          className="w-full accent-emerald-600"
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          <span>{new Date(timeline[0]!.occurred_at).toLocaleString(i18n.language)}</span>
          <span>{new Date(timeline[timeline.length - 1]!.occurred_at).toLocaleString(i18n.language)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Event list */}
        <div>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{t('events.title')}</h3>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto scrollbar-thin">
            {timeline.map((entry, idx) => {
              const seq = idx + 1;
              const isDiffSelected = diffMode && (diffFrom === seq || diffTo === seq);
              return (
                <button
                  key={entry.event_id}
                  onClick={() => handleSelectEvent(entry.event_id, idx)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    isDiffSelected
                      ? 'bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-700'
                      : selectedEvent === entry.event_id
                        ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-mono">#{seq}</span>
                      <Badge variant="neutral">{tTimeline(`event_types.${entry.type}`, { defaultValue: entry.type })}</Badge>
                      <span className="text-slate-700 dark:text-slate-300 truncate">{entry.summary}</span>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{new Date(entry.occurred_at).toLocaleTimeString(i18n.language)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right panel: snapshot or diff */}
        <div>
          {/* Diff Results */}
          {diffMode && diffResult && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                {t('diff.title', { from: diffResult.from_sequence, to: diffResult.to_sequence, count: diffResult.changes.length })}
              </h3>
              <div className="space-y-2">
                {diffResult.changes.map((change, i) => (
                  <div key={i} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      {change.type === 'added' && <Plus className="w-4 h-4 text-emerald-500" />}
                      {change.type === 'removed' && <Minus className="w-4 h-4 text-red-500" />}
                      {change.type === 'modified' && <PenLine className="w-4 h-4 text-amber-500" />}
                      <Badge variant={change.type === 'added' ? 'success' : change.type === 'removed' ? 'danger' : 'warning'}>
                        {change.type}
                      </Badge>
                      <span className="text-xs text-slate-500">{change.entity_type}</span>
                      <span className="text-xs text-slate-400 font-mono">{change.entity_id.slice(0, 8)}...</span>
                      {change.field && <span className="text-xs text-slate-500">.{change.field}</span>}
                    </div>
                    {change.type === 'modified' && (
                      <div className="flex items-center gap-2 text-xs mt-1">
                        <span className="text-red-500 line-through">{String(change.before)}</span>
                        <ArrowRight className="w-3 h-3 text-slate-400" />
                        <span className="text-emerald-600">{String(change.after)}</span>
                      </div>
                    )}
                  </div>
                ))}
                {diffResult.changes.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">{t('diff.no_changes')}</p>
                )}
              </div>
            </div>
          )}

          {/* Snapshot */}
          {!diffMode && (
            <>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{t('snapshot.title')}</h3>
              {loading ? (
                <div className="flex items-center justify-center py-20"><FullPageSpinner /></div>
              ) : snapshot ? (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                  <div>
                    <p className="text-xs text-slate-400 mb-1">{t('snapshot.at_event', { id: snapshot.event_id.slice(0, 8) })}</p>
                    <p className="text-xs text-slate-400">{new Date(snapshot.timestamp).toLocaleString(i18n.language)}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-2">{t('snapshot.case')}</h4>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{snapshot.case.title}</p>
                    <Badge variant={snapshot.case.lifecycle === 'open' ? 'success' : 'neutral'}>{tCommon(`status.${snapshot.case.lifecycle}`, { defaultValue: snapshot.case.lifecycle })}</Badge>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-2">{t('snapshot.moves', { count: snapshot.moves.length })}</h4>
                    <div className="space-y-1">
                      {snapshot.moves.map(m => (
                        <div key={m.id} className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800 rounded px-2 py-1">
                          <span className="text-slate-700 dark:text-slate-300 truncate">{m.title}</span>
                          <Badge variant="neutral">{tCommon(`status.${m.execution}`, { defaultValue: m.execution })}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Historical WHY */}
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                    <button
                      onClick={() => setWhyOpen(!whyOpen)}
                      className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      <HelpCircle className="w-4 h-4" />
                      {t('historical_why.title')}
                    </button>
                    {whyOpen && (
                      <div className="mt-3 space-y-3">
                        <Textarea
                          value={whyQuestion}
                          onChange={(e) => setWhyQuestion(e.target.value)}
                          placeholder={t('historical_why.placeholder')}
                          className="min-h-[40px]"
                        />
                        <Button size="sm" onClick={handleHistoricalWhy} loading={whyLoading} disabled={!whyQuestion.trim()}>
                          {t('historical_why.ask')}
                        </Button>
                        {whyResult && (
                          <div className="bg-emerald-50 dark:bg-emerald-900/10 rounded-lg p-3">
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">{whyResult.why_result.question}</p>
                            <p className="text-sm text-slate-700 dark:text-slate-300">{whyResult.why_result.explanation}</p>
                            {whyResult.why_result.causal_chain.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {whyResult.why_result.causal_chain.map((node, i) => (
                                  <div key={i} className="text-xs text-slate-500 flex items-center gap-1">
                                    <span className="text-emerald-500">&#9679;</span>
                                    <Badge variant="neutral">{node.type}</Badge>
                                    <span>{node.description}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-10">{t('snapshot.select_prompt')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
