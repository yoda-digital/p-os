import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useKanban(caseId: string | undefined) {
  return useQuery({
    queryKey: ['kanban', caseId],
    queryFn: () => api.getKanban(caseId!),
    enabled: !!caseId,
  });
}

export function useMoveCard(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ moveId, fromColumn, toColumn, position }: { moveId: string; fromColumn: string; toColumn: string; position: number }) =>
      api.moveCard(moveId, fromColumn, toColumn, position),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
    },
  });
}
