import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreateSteeringInput, type SteeringCommand } from '../lib/api';

/** States that still have work left to do before the Composer can stop polling for updates. */
const IN_FLIGHT_STATES = new Set(['issued', 'delivered_to_edge', 'delivered_to_executor']);

function steeringQueryKey(attemptId: string | undefined, moveId: string | undefined) {
  return attemptId ? (['steering', 'attempt', attemptId] as const) : (['steering', 'move', moveId] as const);
}

/**
 * Send a steering command for the given case/move (spec §1.1). On success, invalidates the
 * relevant steering-history query so the Composer's delivery-state ladder starts reflecting it —
 * `useSteeringHistory`'s polling then takes over to track issued → edge → executor →
 * acknowledged → applied without requiring a live WSS subscription in the browser.
 */
export function useSendSteering(caseId: string, moveId: string, attemptId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSteeringInput) => api.sendSteering(caseId, moveId, { ...data, attempt_id: attemptId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: steeringQueryKey(attemptId, moveId) });
    },
  });
}

/**
 * Steering history for an attempt (falls back to move-scoped history when no attempt has
 * started yet). Polls at a short interval while any command is still short of a settled state
 * (`acknowledged` or `applied`) so the Composer shows honest, live delivery progress — "Sent"
 * never silently reads as "Applied" (spec §1.3).
 */
export function useSteeringHistory(attemptId: string | undefined, moveId?: string) {
  const enabled = Boolean(attemptId || moveId);

  return useQuery<SteeringCommand[]>({
    queryKey: steeringQueryKey(attemptId, moveId),
    queryFn: () => api.getSteeringHistory(attemptId ? { attemptId } : { moveId }),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasInFlight = data?.some((s) => IN_FLIGHT_STATES.has(s.state));
      return hasInFlight ? 2000 : false;
    },
  });
}
