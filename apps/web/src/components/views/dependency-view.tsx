import { useParams } from 'react-router-dom';
import { useMoves } from '../../hooks/use-moves';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { useCaseStore } from '../../stores/case-store';
import { GitBranch } from 'lucide-react';
import { useMemo } from 'react';
import type { Move } from '../../lib/api';

const statusColors: Record<string, string> = {
  not_started: '#94a3b8',
  running: '#10b981',
  paused: '#f59e0b',
  finished: '#6b7280',
  queued: '#3b82f6',
};

const outcomeColors: Record<string, string> = {
  satisfied: '#10b981',
  failed: '#ef4444',
  cancelled: '#6b7280',
  unsatisfied: '#94a3b8',
};

export function DependencyView() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: moves, isLoading } = useMoves(caseId);
  const { openMoveDetail } = useCaseStore();

  const graph = useMemo(() => {
    if (!moves || moves.length === 0) return null;

    const nodeWidth = 180;
    const nodeHeight = 50;
    const gapX = 60;
    const gapY = 80;

    // Simple layout: topological sort by dependencies
    const moveMap = new Map(moves.map(m => [m.id, m]));
    const layers: Move[][] = [];
    const placed = new Set<string>();

    // Find roots (no dependencies)
    const roots = moves.filter(m => m.dependencies.length === 0 || m.dependencies.every(d => !moveMap.has(d)));
    layers.push(roots);
    roots.forEach(m => placed.add(m.id));

    // Layer by layer
    for (let i = 0; i < 20; i++) {
      const nextLayer = moves.filter(m => !placed.has(m.id) && m.dependencies.every(d => placed.has(d) || !moveMap.has(d)));
      if (nextLayer.length === 0) break;
      layers.push(nextLayer);
      nextLayer.forEach(m => placed.add(m.id));
    }

    // Remaining unplaced
    const remaining = moves.filter(m => !placed.has(m.id));
    if (remaining.length > 0) layers.push(remaining);

    // Compute positions
    const positions = new Map<string, { x: number; y: number }>();
    layers.forEach((layer, li) => {
      const totalWidth = layer.length * nodeWidth + (layer.length - 1) * gapX;
      const startX = (800 - totalWidth) / 2;
      layer.forEach((m, mi) => {
        positions.set(m.id, { x: Math.max(20, startX + mi * (nodeWidth + gapX)), y: 40 + li * (nodeHeight + gapY) });
      });
    });

    const svgHeight = 40 + layers.length * (nodeHeight + gapY) + 40;

    return { moves, positions, layers, svgHeight };
  }, [moves]);

  if (isLoading) return <FullPageSpinner />;

  if (!graph || graph.moves.length === 0) {
    return <EmptyState icon={<GitBranch className="w-12 h-12" />} title="No moves" description="Create moves to see the dependency graph" />;
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Dependency Graph</h2>
      </div>

      <div className="overflow-auto bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <svg width="800" height={graph.svgHeight} className="w-full" viewBox={`0 0 800 ${graph.svgHeight}`}>
          {/* Edges */}
          {graph.moves.map(m =>
            m.dependencies.map(depId => {
              const from = graph.positions.get(depId);
              const to = graph.positions.get(m.id);
              if (!from || !to) return null;
              const blocked = m.readiness === 'not_ready';
              return (
                <line
                  key={`${depId}-${m.id}`}
                  x1={from.x + 90} y1={from.y + 50}
                  x2={to.x + 90} y2={to.y}
                  stroke={blocked ? '#ef4444' : '#94a3b8'}
                  strokeWidth={blocked ? 2 : 1}
                  strokeDasharray={blocked ? '4 4' : undefined}
                  markerEnd="url(#arrow)"
                />
              );
            })
          )}

          {/* Arrow marker */}
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
            </marker>
          </defs>

          {/* Nodes */}
          {graph.moves.map(m => {
            const pos = graph.positions.get(m.id);
            if (!pos) return null;
            const color = outcomeColors[m.outcome] || statusColors[m.execution] || '#94a3b8';
            return (
              <g key={m.id} onClick={() => openMoveDetail(m.id)} className="cursor-pointer">
                <rect
                  x={pos.x} y={pos.y} width={180} height={50}
                  rx={8} fill="white" stroke={color} strokeWidth={2}
                  className="dark:fill-slate-800"
                />
                <text x={pos.x + 90} y={pos.y + 20} textAnchor="middle" className="text-xs fill-slate-900 dark:fill-slate-100 font-medium" fontSize={12}>
                  {m.title.length > 22 ? m.title.slice(0, 22) + '…' : m.title}
                </text>
                <text x={pos.x + 90} y={pos.y + 38} textAnchor="middle" className="text-xs fill-slate-400" fontSize={10}>
                  {m.class} · {m.execution}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
