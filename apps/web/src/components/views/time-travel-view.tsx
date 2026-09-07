import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTimeline } from '../../hooks/use-timeline';
import { api, type CaseSnapshot } from '../../lib/api';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { History, Clock, ArrowRight } from 'lucide-react';

export function TimeTravelView() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: timeline, isLoading } = useTimeline(caseId);
  const [snapshot, setSnapshot] = useState<CaseSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  if (isLoading) return <FullPageSpinner />;

  if (!timeline || timeline.length === 0) {
    return <EmptyState icon={<History className="w-12 h-12" />} title="No history" description="Events will appear here as the case evolves" />;
  }

  const handleSelectEvent = async (eventId: string) => {
    if (!caseId) return;
    setSelectedEvent(eventId);
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

  // Slider position
  const sliderIdx = selectedEvent ? timeline.findIndex(e => e.event_id === selectedEvent) : -1;

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <History className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Time Travel</h2>
      </div>

      {/* Timeline slider */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 mb-6">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
          Select event ({timeline.length} total)
        </label>
        <input
          type="range"
          min={0}
          max={timeline.length - 1}
          value={sliderIdx >= 0 ? sliderIdx : 0}
          onChange={(e) => {
            const idx = parseInt(e.target.value);
            const entry = timeline[idx];
            if (entry) handleSelectEvent(entry.event_id);
          }}
          className="w-full accent-emerald-600"
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          <span>{new Date(timeline[0]!.occurred_at).toLocaleString()}</span>
          <span>{new Date(timeline[timeline.length - 1]!.occurred_at).toLocaleString()}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Event list */}
        <div>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Events</h3>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto scrollbar-thin">
            {timeline.map((entry) => (
              <button
                key={entry.event_id}
                onClick={() => handleSelectEvent(entry.event_id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedEvent === entry.event_id
                    ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{entry.type}</Badge>
                    <span className="text-slate-700 dark:text-slate-300 truncate">{entry.summary}</span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">{new Date(entry.occurred_at).toLocaleTimeString()}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Snapshot */}
        <div>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">State Snapshot</h3>
          {loading ? (
            <div className="flex items-center justify-center py-20"><FullPageSpinner /></div>
          ) : snapshot ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
              <div>
                <p className="text-xs text-slate-400 mb-1">Snapshot at event {snapshot.event_id.slice(0, 8)}...</p>
                <p className="text-xs text-slate-400">{new Date(snapshot.timestamp).toLocaleString()}</p>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-500 mb-2">Case</h4>
                <p className="text-sm text-slate-700 dark:text-slate-300">{snapshot.case.title}</p>
                <Badge variant={snapshot.case.lifecycle === 'open' ? 'success' : 'neutral'}>{snapshot.case.lifecycle}</Badge>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-500 mb-2">Moves ({snapshot.moves.length})</h4>
                <div className="space-y-1">
                  {snapshot.moves.map(m => (
                    <div key={m.id} className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800 rounded px-2 py-1">
                      <span className="text-slate-700 dark:text-slate-300 truncate">{m.title}</span>
                      <Badge variant="neutral">{m.execution}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-10">Select an event to view the snapshot</p>
          )}
        </div>
      </div>
    </div>
  );
}
