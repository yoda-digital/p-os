import { create } from 'zustand';
import type { Case, Move, KanbanProjection, AttentionItem } from '../lib/api';

interface CaseState {
  currentCase: Case | null;
  moves: Move[];
  kanban: KanbanProjection | null;
  attentionItems: AttentionItem[];
  selectedMoveId: string | null;
  moveDetailOpen: boolean;

  setCurrentCase: (c: Case | null) => void;
  setMoves: (moves: Move[]) => void;
  setKanban: (k: KanbanProjection) => void;
  setAttentionItems: (items: AttentionItem[]) => void;
  openMoveDetail: (moveId: string) => void;
  closeMoveDetail: () => void;
}

export const useCaseStore = create<CaseState>((set) => ({
  currentCase: null,
  moves: [],
  kanban: null,
  attentionItems: [],
  selectedMoveId: null,
  moveDetailOpen: false,

  setCurrentCase: (c) => set({ currentCase: c }),
  setMoves: (moves) => set({ moves }),
  setKanban: (kanban) => set({ kanban }),
  setAttentionItems: (items) => set({ attentionItems: items }),
  openMoveDetail: (moveId) => set({ selectedMoveId: moveId, moveDetailOpen: true }),
  closeMoveDetail: () => set({ moveDetailOpen: false, selectedMoveId: null }),
}));
