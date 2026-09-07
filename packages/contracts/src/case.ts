import { z } from 'zod';
import {
  zCaseId,
  zOrganizationId,
  zWorkspaceId,
  zIntentId,
  zActorId,
  zProjectId,
  zISODateString,
  zSemanticRef,
} from './ids.js';

// ---------------------------------------------------------------------------
// Case lifecycle
// ---------------------------------------------------------------------------

export const CaseLifecycle = {
  Open: 'open',
  Dormant: 'dormant',
  Closed: 'closed',
  Archived: 'archived',
  Void: 'void',
} as const;

export const zCaseLifecycle = z.enum(['open', 'dormant', 'closed', 'archived', 'void']);
export type CaseLifecycle = z.infer<typeof zCaseLifecycle>;

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

export const zCase = z.object({
  id: zCaseId,
  organization_id: zOrganizationId,
  workspace_id: zWorkspaceId,
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  lifecycle: zCaseLifecycle.default('open'),
  primary_intent_ids: z.array(zIntentId).default([]),
  owner_actor_ids: z.array(zActorId).default([]),
  pack_refs: z.array(zSemanticRef).default([]),
  project_refs: z.array(zProjectId).default([]),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type Case = z.infer<typeof zCase>;
