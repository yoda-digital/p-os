import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useAttention(caseId: string | undefined) {
  return useQuery({
    queryKey: ['attention', caseId],
    queryFn: () => api.getAttention(caseId!),
    enabled: !!caseId,
  });
}
