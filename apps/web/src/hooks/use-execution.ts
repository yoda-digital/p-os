// React Query hooks for execution (SP3)

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ExecutionStatus, type ExecutionTriggerResult, type AttemptLogs } from '../lib/api';

/** Fetch current execution status for a move. */
export function useExecutionStatus(moveId: string | undefined) {
  return useQuery<ExecutionStatus>({
    queryKey: ['execution', moveId],
    queryFn: () => api.getExecutionStatus(moveId!),
    enabled: !!moveId,
    refetchInterval: 5000, // Poll every 5s while viewing
  });
}

/** Trigger execution for a move. */
export function useExecuteMove(caseId: string) {
  const qc = useQueryClient();

  return useMutation<ExecutionTriggerResult, Error, string>({
    mutationFn: (moveId: string) => api.executeMove(moveId),
    onSuccess: (_data, moveId) => {
      qc.invalidateQueries({ queryKey: ['execution', moveId] });
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
      qc.invalidateQueries({ queryKey: ['move', moveId] });
    },
  });
}

/** Stop execution for a move. */
export function useStopMove(caseId: string) {
  const qc = useQueryClient();

  return useMutation<{ status: string; attempt_id: string }, Error, string>({
    mutationFn: (moveId: string) => api.stopExecution(moveId),
    onSuccess: (_data, moveId) => {
      qc.invalidateQueries({ queryKey: ['execution', moveId] });
      qc.invalidateQueries({ queryKey: ['moves', caseId] });
      qc.invalidateQueries({ queryKey: ['kanban', caseId] });
      qc.invalidateQueries({ queryKey: ['move', moveId] });
    },
  });
}

/** Fetch logs for an attempt. */
export function useAttemptLogs(attemptId: string | undefined) {
  return useQuery<AttemptLogs>({
    queryKey: ['attempt-logs', attemptId],
    queryFn: () => api.getAttemptLogs(attemptId!),
    enabled: !!attemptId,
  });
}
