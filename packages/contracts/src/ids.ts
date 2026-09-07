import { z } from 'zod';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

export declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type OrganizationId = Brand<string, 'OrganizationId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type CaseId = Brand<string, 'CaseId'>;
export type EntityId = Brand<string, 'EntityId'>;
export type RelationId = Brand<string, 'RelationId'>;
export type AssertionId = Brand<string, 'AssertionId'>;
export type IntentId = Brand<string, 'IntentId'>;
export type RuleId = Brand<string, 'RuleId'>;
export type ActorId = Brand<string, 'ActorId'>;
export type ResourceId = Brand<string, 'ResourceId'>;
export type MoveId = Brand<string, 'MoveId'>;
export type AttemptId = Brand<string, 'AttemptId'>;
export type EvidenceId = Brand<string, 'EvidenceId'>;
export type DecisionId = Brand<string, 'DecisionId'>;
export type EventId = Brand<string, 'EventId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type ExecutorId = Brand<string, 'ExecutorId'>;
export type SessionBindingId = Brand<string, 'SessionBindingId'>;
export type UserId = Brand<string, 'UserId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type MembershipId = Brand<string, 'MembershipId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type PackId = Brand<string, 'PackId'>;
export type SimulationId = Brand<string, 'SimulationId'>;

// ---------------------------------------------------------------------------
// UUIDv7 generation (no external deps beyond node:crypto)
// ---------------------------------------------------------------------------

/**
 * Generate a UUIDv7 — time-ordered, globally unique.
 *
 * Layout (RFC 9562):
 *   0-47:  48-bit unix timestamp in milliseconds
 *   48-51: version (0b0111 = 7)
 *   52-63: 12 random bits
 *   64-65: variant  (0b10)
 *   66-127: 62 random bits
 */
export function generateUUIDv7(): string {
  // On Node 22+ randomUUID() is available, but we build v7 manually for time-ordering
  const now = Date.now();
  const buf = new Uint8Array(16);
  // Fill with random bytes via globalThis.crypto (available Node 19+)
  globalThis.crypto.getRandomValues(buf);

  // Timestamp: 48 bits → bytes 0-5
  buf[0] = (now / 2 ** 40) & 0xff;
  buf[1] = (now / 2 ** 32) & 0xff;
  buf[2] = (now / 2 ** 24) & 0xff;
  buf[3] = (now / 2 ** 16) & 0xff;
  buf[4] = (now / 2 ** 8) & 0xff;
  buf[5] = now & 0xff;

  // Version 7 in bits 48-51
  buf[6] = (buf[6]! & 0x0f) | 0x70;

  // Variant 10 in bits 64-65
  buf[8] = (buf[8]! & 0x3f) | 0x80;

  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Create a branded ID of the given type.
 */
export function createId<T extends string>(): T {
  return generateUUIDv7() as T;
}

// ---------------------------------------------------------------------------
// Zod helpers — string UUID refinement usable with branded types
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const zId = z.string().regex(UUID_RE, 'Must be a valid UUID');

// Branded Zod types — use double-cast to satisfy TS strict mode
function brandedId<T>(): z.ZodType<T> {
  return zId as unknown as z.ZodType<T>;
}

export const zOrganizationId = brandedId<OrganizationId>();
export const zWorkspaceId = brandedId<WorkspaceId>();
export const zProjectId = brandedId<ProjectId>();
export const zCaseId = brandedId<CaseId>();
export const zEntityId = brandedId<EntityId>();
export const zRelationId = brandedId<RelationId>();
export const zAssertionId = brandedId<AssertionId>();
export const zIntentId = brandedId<IntentId>();
export const zRuleId = brandedId<RuleId>();
export const zActorId = brandedId<ActorId>();
export const zResourceId = brandedId<ResourceId>();
export const zMoveId = brandedId<MoveId>();
export const zAttemptId = brandedId<AttemptId>();
export const zEvidenceId = brandedId<EvidenceId>();
export const zDecisionId = brandedId<DecisionId>();
export const zEventId = brandedId<EventId>();
export const zCommandId = brandedId<CommandId>();
export const zDeviceId = brandedId<DeviceId>();
export const zExecutorId = brandedId<ExecutorId>();
export const zSessionBindingId = brandedId<SessionBindingId>();
export const zUserId = brandedId<UserId>();
export const zTeamId = brandedId<TeamId>();
export const zMembershipId = brandedId<MembershipId>();
export const zSessionId = brandedId<SessionId>();
export const zPackId = brandedId<PackId>();
export const zSimulationId = brandedId<SimulationId>();

// ---------------------------------------------------------------------------
// Semantic reference — points at any addressable object
// ---------------------------------------------------------------------------

export const zSemanticRef = z.object({
  id: zId,
  type: z.string(),
});
export type SemanticRef = z.infer<typeof zSemanticRef>;

// ---------------------------------------------------------------------------
// Common reusable schemas
// ---------------------------------------------------------------------------

export const zISODateString = z.string().datetime({ offset: true }).or(z.string().datetime());
export const zPriority = z.enum(['critical', 'high', 'medium', 'low']);
export type Priority = z.infer<typeof zPriority>;
export const zRiskLevel = z.enum(['critical', 'high', 'medium', 'low', 'none']);
export type RiskLevel = z.infer<typeof zRiskLevel>;
