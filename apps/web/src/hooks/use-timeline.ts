import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useTimeline(caseId: string | undefined) {
  return useQuery({
    queryKey: ['timeline', caseId],
    queryFn: () => api.getTimeline(caseId!),
    enabled: !!caseId,
  });
}

export function useWhy(caseId: string | undefined) {
  return {
    explain: (question: string) => api.explainWhy(caseId!, question),
  };
}

export function useMetrics(caseId: string | undefined) {
  return useQuery({
    queryKey: ['metrics', caseId],
    queryFn: () => api.getMetrics(caseId!),
    enabled: !!caseId,
  });
}

export function useDrift(caseId: string | undefined) {
  return useQuery({
    queryKey: ['drift', caseId],
    queryFn: () => api.getDriftReport(caseId!),
    enabled: !!caseId,
  });
}

export function useSimulations(caseId: string | undefined) {
  return useQuery({
    queryKey: ['simulations', caseId],
    queryFn: () => api.listSimulations(caseId!),
    enabled: !!caseId,
  });
}
