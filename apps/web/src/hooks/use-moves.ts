import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CreateMoveInput } from '../lib/api';

export function useMoves(caseId: string | undefined) {
  return useQuery({
    queryKey: ['moves', caseId],
    queryFn: () => api.listMoves(caseId!),
    enabled: !!caseId,
  });
}

export function useMove(id: string | undefined) {
  return useQuery({
    queryKey: ['move', id],
    queryFn: () => api.getMove(id!),
    enabled: !!id,
  });
}

export function useCreateMove(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMoveInput) => api.createMove(caseId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
    },
  });
}

export function useActivateMove(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.activateMove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
    },
  });
}

export function usePauseMove(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.pauseMove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
    },
  });
}

export function useResumeMove(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.resumeMove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
    },
  });
}

export function useCancelMove(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelMove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
    },
  });
}

export function useSatisfyMove(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.satisfyMove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
    },
  });
}

export function useAttempts(moveId: string | undefined) {
  return useQuery({
    queryKey: ['attempts', moveId],
    queryFn: () => api.listAttempts(moveId!),
    enabled: !!moveId,
  });
}
