import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CreateDecisionInput } from '../lib/api';

export function useDecisions(caseId: string | undefined) {
  return useQuery({
    queryKey: ['decisions', caseId],
    queryFn: () => api.listDecisions(caseId!),
    enabled: !!caseId,
  });
}

export function useCreateDecision(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDecisionInput) => api.createDecision(caseId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions', caseId] }),
  });
}

export function useResolveDecision(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, option, rationale }: { id: string; option: unknown; rationale: string }) =>
      api.resolveDecision(id, option, rationale),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decisions', caseId] });
      qc.invalidateQueries({ queryKey: ['attention', caseId] });
    },
  });
}
