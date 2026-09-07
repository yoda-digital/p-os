import { useParams } from 'react-router-dom';
import { useMoves } from '../../hooks/use-moves';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Badge } from '../common/badge';
import { useCaseStore } from '../../stores/case-store';
import { AlertTriangle } from 'lucide-react';

const riskLevels = ['critical', 'high', 'medium', 'low', 'none'] as const;
const riskColors: Record<string, string> = {
  critical: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-amber-500', low: 'bg-emerald-500', none: 'bg-slate-300',
};
const riskVariant: Record<string, string> = {
  critical: 'danger', high: 'orange', medium: 'warning', low: 'success', none: 'neutral',
};

export function RiskView() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: moves, isLoading } = useMoves(caseId);
  const { openMoveDetail } = useCaseStore();

  if (isLoading) return <FullPageSpinner />;

  const byRisk = riskLevels.map(level => ({
    level,
    moves: moves?.filter(m => m.risk === level && m.outcome === 'unsatisfied') || [],
  }));

  const totalRisked = byRisk.filter(r => r.level !== 'none').reduce((n, r) => n + r.moves.length, 0);

  if (!moves || moves.length === 0) {
    return <EmptyState icon={<AlertTriangle className="w-12 h-12" />} title="No moves" description="Create moves to see risk assessment" />;
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <AlertTriangle className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Risk Overview</h2>
        {totalRisked > 0 && (
          <Badge variant="danger">{totalRisked} at risk</Badge>
        )}
      </div>

      {/* Risk summary cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {riskLevels.map(level => {
          const count = byRisk.find(r => r.level === level)?.moves.length || 0;
          return (
            <div key={level} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className={`w-4 h-4 rounded-full mx-auto mb-2 ${riskColors[level]}`} />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{count}</p>
              <p className="text-xs text-slate-500 capitalize">{level}</p>
            </div>
          );
        })}
      </div>

      {/* Risk matrix */}
      <div className="space-y-4">
        {byRisk.filter(r => r.moves.length > 0).map(({ level, moves: riskMoves }) => (
          <div key={level}>
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${riskColors[level]}`} />
              {level} Risk ({riskMoves.length})
            </h3>
            <div className="space-y-2">
              {riskMoves.map(m => (
                <button
                  key={m.id}
                  onClick={() => openMoveDetail(m.id)}
                  className="w-full text-left bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 hover:border-emerald-300 dark:hover:border-emerald-600 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{m.title}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={(riskVariant[m.risk] || 'neutral') as any}>{m.risk}</Badge>
                      <Badge variant="neutral">{m.execution}</Badge>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
