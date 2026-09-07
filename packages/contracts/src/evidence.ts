import { z } from 'zod';
import {
  zEvidenceId,
  zCaseId,
  zActorId,
  zISODateString,
  zSemanticRef,
} from './ids.js';

// ---------------------------------------------------------------------------
// Evidence relation
// ---------------------------------------------------------------------------

export const EvidenceRelation = {
  Supports: 'supports',
  Contradicts: 'contradicts',
  Verifies: 'verifies',
  Invalidates: 'invalidates',
  EstablishesProvenance: 'establishes_provenance',
  EstablishesAuthority: 'establishes_authority',
  EstablishesCompliance: 'establishes_compliance',
} as const;

export const zEvidenceRelation = z.enum([
  'supports',
  'contradicts',
  'verifies',
  'invalidates',
  'establishes_provenance',
  'establishes_authority',
  'establishes_compliance',
]);
export type EvidenceRelation = z.infer<typeof zEvidenceRelation>;

// ---------------------------------------------------------------------------
// Evidence validity
// ---------------------------------------------------------------------------

export const EvidenceValidity = {
  Valid: 'valid',
  Stale: 'stale',
  Invalid: 'invalid',
  Disputed: 'disputed',
  Unknown: 'unknown',
} as const;

export const zEvidenceValidity = z.enum(['valid', 'stale', 'invalid', 'disputed', 'unknown']);
export type EvidenceValidity = z.infer<typeof zEvidenceValidity>;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const zEvidence = z.object({
  id: zEvidenceId,
  case_id: zCaseId,
  subject_refs: z.array(zSemanticRef).min(1),
  relation: zEvidenceRelation,
  artifact_ref: zSemanticRef.optional(),
  source_ref: zSemanticRef.optional(),
  scope: z.object({
    description: z.string(),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
  provenance: z
    .object({
      origin: z.string(),
      method: z.string().optional(),
      tool: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
  observed_at: zISODateString,
  fresh_until: zISODateString.optional(),
  confidence: z.number().min(0).max(1).default(1),
  validity: zEvidenceValidity.default('valid'),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Evidence = z.infer<typeof zEvidence>;
