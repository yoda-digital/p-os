import { z } from 'zod';
import { zSimulationId, zCaseId, zEventId, zActorId, zISODateString } from './ids.js';
import { zProcessEvent } from './events.js';

// ---------------------------------------------------------------------------
// Simulation fork
// ---------------------------------------------------------------------------

export const zSimulationFork = z.object({
  id: zSimulationId,
  source_case_id: zCaseId,
  fork_event_id: zEventId,
  title: z.string().min(1),
  description: z.string().default(''),
  hypothetical_changes: z.array(z.object({
    description: z.string(),
    type: z.string(), // e.g. 'deadline_change', 'resource_unavailable', 'strategy_change'
    params: z.record(z.string(), z.unknown()).default({}),
  })).default([]),
  status: z.enum(['active', 'adopted', 'discarded']).default('active'),
  created_at: zISODateString,
  created_by: zActorId,
});
export type SimulationFork = z.infer<typeof zSimulationFork>;

// ---------------------------------------------------------------------------
// Simulated event — extends ProcessEvent with simulation_id
// ---------------------------------------------------------------------------

export const zSimulatedEvent = zProcessEvent.extend({
  simulation_id: zSimulationId,
});
export type SimulatedEvent = z.infer<typeof zSimulatedEvent>;

// ---------------------------------------------------------------------------
// Simulation result
// ---------------------------------------------------------------------------

export const zSimulationResult = z.object({
  simulation_id: zSimulationId,
  event_count: z.number().int().nonnegative(),
  affected_moves: z.array(z.string()),
  projected_completion: zISODateString.optional(),
  projected_cost: z.number().nonnegative().optional(),
  risks: z.array(z.object({
    description: z.string(),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
  })).default([]),
  summary: z.string().default(''),
});
export type SimulationResult = z.infer<typeof zSimulationResult>;
