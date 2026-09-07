import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CreateEvidenceInput } from '../lib/api';

export function useEvidence(caseId: string | undefined) {
  return useQuery({
    queryKey: ['evidence', caseId],
    queryFn: () => api.listEvidence(caseId!),
    enabled: !!caseId,
  });
}

export function useAttachEvidence(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateEvidenceInput) => api.attachEvidence(caseId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evidence', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
    },
  });
}
