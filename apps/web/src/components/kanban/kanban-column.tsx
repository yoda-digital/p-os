import { useDroppable } from '@dnd-kit/core';
import { KanbanCard } from './kanban-card';
import { Plus } from 'lucide-react';
import type { KanbanCard as KanbanCardType } from '../../lib/api';

const colorMap: Record<string, { header: string; dot: string; bg: string }> = {
  slate:   { header: 'text-slate-600 dark:text-slate-400', dot: 'bg-slate-400', bg: 'bg-slate-50 dark:bg-slate-900/50' },
  blue:    { header: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500', bg: 'bg-blue-50/50 dark:bg-blue-900/10' },
  emerald: { header: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500', bg: 'bg-emerald-50/50 dark:bg-emerald-900/10' },
  amber:   { header: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500', bg: 'bg-amber-50/50 dark:bg-amber-900/10' },
  orange:  { header: 'text-orange-600 dark:text-orange-400', dot: 'bg-orange-500', bg: 'bg-orange-50/50 dark:bg-orange-900/10' },
  purple:  { header: 'text-purple-600 dark:text-purple-400', dot: 'bg-purple-500', bg: 'bg-purple-50/50 dark:bg-purple-900/10' },
  green:   { header: 'text-green-600 dark:text-green-400', dot: 'bg-green-500', bg: 'bg-green-50/50 dark:bg-green-900/10' },
};

interface KanbanColumnProps {
  id: string;
  label: string;
  color: string;
  cards: KanbanCardType[];
  onCardClick: (moveId: string) => void;
  onAddCard: () => void;
}

export function KanbanColumn({ id, label, color, cards, onCardClick, onAddCard }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const colors = colorMap[color] || colorMap.slate;

  return (
    <div
      ref={setNodeRef}
      className={`w-72 flex flex-col rounded-xl transition-colors ${colors.bg} ${isOver ? 'ring-2 ring-emerald-500/50' : ''}`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
          <span className={`text-sm font-semibold ${colors.header}`}>{label}</span>
          <span className="text-xs text-slate-400 dark:text-slate-500 font-medium bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.5 rounded-full">
            {cards.length}
          </span>
        </div>
        <button
          onClick={onAddCard}
          className="p-1 rounded hover:bg-slate-200/50 dark:hover:bg-slate-700/50 text-slate-400"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Card List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 scrollbar-thin min-h-[200px]">
        {cards.map((card) => (
          <KanbanCard
            key={card.move_id}
            card={card}
            onClick={() => onCardClick(card.move_id)}
          />
        ))}
      </div>
    </div>
  );
}
