import { useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { DndContext, DragOverlay, closestCorners, type DragStartEvent, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useKanban, useMoveCard } from '../../hooks/use-kanban';
import { KanbanColumn } from './kanban-column';
import { KanbanCard } from './kanban-card';
import { CreateMoveDialog } from './create-move-dialog';
import { MoveDetailDrawer } from '../steering/move-detail-drawer';
import { useCaseStore } from '../../stores/case-store';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Kanban, Plus } from 'lucide-react';
import { Button } from '../common/button';
import type { KanbanCard as KanbanCardType, KanbanColumnData } from '../../lib/api';

const COLUMNS = [
  { id: 'BACKLOG', label: 'Backlog', color: 'slate' },
  { id: 'READY', label: 'Ready', color: 'blue' },
  { id: 'ACTIVE', label: 'Active', color: 'emerald' },
  { id: 'WAITING', label: 'Waiting', color: 'amber' },
  { id: 'NEEDS_INPUT', label: 'Needs Input', color: 'orange' },
  { id: 'VERIFY', label: 'Verify', color: 'purple' },
  { id: 'DONE', label: 'Done', color: 'green' },
] as const;

const DRAG_COMMAND_MAP: Record<string, Record<string, string>> = {
  BACKLOG: { READY: 'RequestReadiness' },
  READY: { ACTIVE: 'RequestActivation', BACKLOG: 'Move.Edit' },
  ACTIVE: { WAITING: 'Move.Pause', VERIFY: 'RequestVerification', NEEDS_INPUT: 'RequestInput' },
  WAITING: { ACTIVE: 'Move.Resume' },
  NEEDS_INPUT: { ACTIVE: 'Move.Resume' },
  VERIFY: { DONE: 'RequestSatisfaction', ACTIVE: 'RequestActivation' },
};

export function KanbanBoard() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: kanban, isLoading } = useKanban(caseId);
  const moveCard = useMoveCard(caseId!);
  const [activeCard, setActiveCard] = useState<KanbanCardType | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { moveDetailOpen, selectedMoveId, openMoveDetail, closeMoveDetail } = useCaseStore();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // API returns columns as an array of {id, label, cards} — convert to Record for lookup
  const columns = useMemo(() => {
    const map: Record<string, KanbanCardType[]> = {};
    if (Array.isArray(kanban?.columns)) {
      for (const col of kanban.columns as KanbanColumnData[]) {
        map[col.id] = col.cards ?? [];
      }
    } else if (kanban?.columns) {
      Object.assign(map, kanban.columns);
    }
    return map;
  }, [kanban]);

  const hasCards = Object.values(columns).some(arr => arr.length > 0);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const card = findCard(kanban?.columns, active.id as string);
    setActiveCard(card || null);
  }, [kanban]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);
    if (!over || !caseId) return;

    const moveId = active.id as string;
    const toColumn = over.id as string;

    // Find which column the card came from
    const fromColumn = activeCard?.column_id
      ?? Object.entries(columns).find(([, cards]) => cards.some(c => c.move_id === moveId))?.[0]
      ?? 'BACKLOG';

    if (COLUMNS.some(c => c.id === toColumn) && fromColumn !== toColumn) {
      moveCard.mutate({ moveId, fromColumn, toColumn, position: 0 });
    }
  }, [caseId, moveCard, activeCard, columns]);

  if (isLoading) return <FullPageSpinner />;

  return (
    <div className="h-full flex flex-col">
      {/* Board Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <Kanban className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Kanban Board</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New Move
        </Button>
      </div>

      {!hasCards && !isLoading ? (
        <EmptyState
          icon={<Kanban className="w-12 h-12" />}
          title="No moves yet"
          description="Create your first move to get started"
          action={{ label: 'Create Move', onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-x-auto p-4">
            <div className="flex gap-4 h-full min-w-max">
              {COLUMNS.map((col) => (
                <KanbanColumn
                  key={col.id}
                  id={col.id}
                  label={col.label}
                  color={col.color}
                  cards={columns[col.id] || []}
                  onCardClick={openMoveDetail}
                  onAddCard={() => setCreateOpen(true)}
                />
              ))}
            </div>
          </div>
          <DragOverlay>
            {activeCard && <KanbanCard card={activeCard} isDragging />}
          </DragOverlay>
        </DndContext>
      )}

      <CreateMoveDialog open={createOpen} onClose={() => setCreateOpen(false)} caseId={caseId!} />
      <MoveDetailDrawer open={moveDetailOpen} onClose={closeMoveDetail} moveId={selectedMoveId} caseId={caseId!} />
    </div>
  );
}

function findCard(columns: KanbanColumnData[] | Record<string, KanbanCardType[]> | undefined, moveId: string): KanbanCardType | undefined {
  if (!columns) return undefined;
  const items = Array.isArray(columns)
    ? columns.flatMap((col: KanbanColumnData) => col.cards ?? [])
    : Object.values(columns).flat();
  return items.find((c: KanbanCardType) => c.move_id === moveId);
}
