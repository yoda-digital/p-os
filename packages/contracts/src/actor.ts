import { z } from 'zod';
import {
  zActorId,
  zOrganizationId,
  zISODateString,
  zSemanticRef,
} from './ids.js';

// ---------------------------------------------------------------------------
// Actor class
// ---------------------------------------------------------------------------

export const ActorClass = {
  Human: 'human',
  AiAgent: 'ai_agent',
  Team: 'team',
  Organization: 'organization',
  ExternalAuthority: 'external_authority',
  SoftwareService: 'software_service',
  ExecutorRuntime: 'executor_runtime',
} as const;

export const zActorClass = z.enum([
  'human',
  'ai_agent',
  'team',
  'organization',
  'external_authority',
  'software_service',
  'executor_runtime',
]);
export type ActorClass = z.infer<typeof zActorClass>;

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export const zActor = z.object({
  id: zActorId,
  organization_id: zOrganizationId,
  class: zActorClass,
  identity_ref: zSemanticRef.optional(),
  display_name: z.string().min(1),
  roles: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  authority_grants: z
    .array(
      z.object({
        action: z.string(),
        scope: z.string().default('*'),
        granted_by: zSemanticRef.optional(),
        expires_at: zISODateString.optional(),
      }),
    )
    .default([]),
  availability: z
    .object({
      status: z.enum(['available', 'busy', 'offline', 'unavailable']).default('available'),
      schedule: z.string().optional(),
    })
    .default({ status: 'available' }),
  cost_profile: z
    .object({
      cost_per_hour: z.number().nonnegative().optional(),
      currency: z.string().default('USD'),
      token_cost_input: z.number().nonnegative().optional(),
      token_cost_output: z.number().nonnegative().optional(),
    })
    .optional(),
  trust_level: z.enum(['full', 'high', 'medium', 'low', 'none']).default('medium'),
  created_at: zISODateString,
  created_by: zActorId.optional(),
  revision: z.number().int().nonnegative().default(0),
});

export type Actor = z.infer<typeof zActor>;
