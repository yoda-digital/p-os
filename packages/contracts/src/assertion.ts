import { z } from 'zod';
import {
  zAssertionId,
  zCaseId,
  zActorId,
  zEvidenceId,
  zISODateString,
  zSemanticRef,
} from './ids.js';

// ---------------------------------------------------------------------------
// Assertion modality
// ---------------------------------------------------------------------------

export const AssertionModality = {
  Observed: 'observed',
  Claimed: 'claimed',
  Believed: 'believed',
  Hypothesized: 'hypothesized',
  Inferred: 'inferred',
  Evaluated: 'evaluated',
  Verified: 'verified',
  Presumed: 'presumed',
  Disputed: 'disputed',
  Authoritative: 'authoritative',
} as const;

export const zAssertionModality = z.enum([
  'observed',
  'claimed',
  'believed',
  'hypothesized',
  'inferred',
  'evaluated',
  'verified',
  'presumed',
  'disputed',
  'authoritative',
]);
export type AssertionModality = z.infer<typeof zAssertionModality>;

// ---------------------------------------------------------------------------
// Assertion status
// ---------------------------------------------------------------------------

export const AssertionStatus = {
  Active: 'active',
  Retracted: 'retracted',
  Superseded: 'superseded',
  Disputed: 'disputed',
} as const;

export const zAssertionStatus = z.enum(['active', 'retracted', 'superseded', 'disputed']);
export type AssertionStatus = z.infer<typeof zAssertionStatus>;

// ---------------------------------------------------------------------------
// Assertion
// ---------------------------------------------------------------------------

export const zAssertion = z.object({
  id: zAssertionId,
  case_id: zCaseId,
  subject_ref: zSemanticRef,
  predicate: z.string().min(1),
  value: z.unknown(),
  modality: zAssertionModality,
  source_refs: z.array(zSemanticRef).default([]),
  evidence_refs: z.array(zEvidenceId).default([]),
  confidence: z.number().min(0).max(1).default(1),
  effective_from: zISODateString.optional(),
  effective_until: zISODateString.optional(),
  status: zAssertionStatus.default('active'),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Assertion = z.infer<typeof zAssertion>;
