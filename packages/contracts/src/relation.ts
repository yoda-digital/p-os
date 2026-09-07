import { z } from 'zod';
import { zRelationId, zCaseId, zActorId, zISODateString, zSemanticRef } from './ids.js';

// ---------------------------------------------------------------------------
// Relation types
// ---------------------------------------------------------------------------

export const RelationType = {
  DependsOn: 'DEPENDS_ON',
  Blocks: 'BLOCKS',
  Requires: 'REQUIRES',
  Produces: 'PRODUCES',
  Supports: 'SUPPORTS',
  Contradicts: 'CONTRADICTS',
  Supersedes: 'SUPERSEDES',
  Implements: 'IMPLEMENTS',
  Represents: 'REPRESENTS',
  Authorizes: 'AUTHORIZES',
  Owns: 'OWNS',
  Contains: 'CONTAINS',
  Affects: 'AFFECTS',
  Invalidates: 'INVALIDATES',
} as const;

export const zRelationType = z.enum([
  'DEPENDS_ON',
  'BLOCKS',
  'REQUIRES',
  'PRODUCES',
  'SUPPORTS',
  'CONTRADICTS',
  'SUPERSEDES',
  'IMPLEMENTS',
  'REPRESENTS',
  'AUTHORIZES',
  'OWNS',
  'CONTAINS',
  'AFFECTS',
  'INVALIDATES',
]);
export type RelationType = z.infer<typeof zRelationType>;

// ---------------------------------------------------------------------------
// Relation
// ---------------------------------------------------------------------------

export const zRelation = z.object({
  id: zRelationId,
  case_id: zCaseId,
  source_ref: zSemanticRef,
  target_ref: zSemanticRef,
  type: zRelationType,
  qualifier: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),
  effective_from: zISODateString.optional(),
  effective_until: zISODateString.optional(),
  source_refs: z.array(zSemanticRef).default([]),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Relation = z.infer<typeof zRelation>;
