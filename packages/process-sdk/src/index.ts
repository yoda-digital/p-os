/**
 * @pos/process-sdk — Pack SDK interface that domain packs implement.
 *
 * A DomainPack provides domain-specific BEHAVIOR, not just metadata.
 * It declares entity types, relation types, controllers, evidence types,
 * move classes, view ordering, default rules, and intent templates.
 */

// ── Core Types ──────────────────────────────────────────────────

/** JSON Schema (simplified for entity type declarations). */
export interface JSONSchemaLike {
  type: string;
  properties?: Record<string, JSONSchemaLike>;
  items?: JSONSchemaLike;
  required?: string[];
  enum?: string[];
  description?: string;
}

/** A pack controller that evaluates on domain events. */
export interface PackController {
  /** Unique controller name within the pack. */
  name: string;
  /** Human-readable description of what this controller enforces. */
  description: string;
  /** Event types this controller responds to. */
  triggers: string[];
  /**
   * Evaluate the controller given an event context.
   * Returns actions to take (emit events, raise attention, update state).
   */
  evaluate: (ctx: ControllerContext) => Promise<ControllerAction[]>;
}

/** Context provided to a pack controller during evaluation. */
export interface ControllerContext {
  event_type: string;
  event_data: Record<string, unknown>;
  case_id: string;
  move_id?: string;
  entity_id?: string;
  /** Query function for reading case state (entities, evidence, moves). */
  query: PackQueryFn;
}

/** Actions a controller can emit after evaluation. */
export type ControllerAction =
  | { type: 'raise_attention'; priority: string; reason: string; move_id?: string }
  | { type: 'update_move'; move_id: string; fields: Record<string, unknown> }
  | { type: 'emit_event'; event_type: string; data: Record<string, unknown> }
  | { type: 'invalidate_evidence'; evidence_id: string; reason: string }
  | { type: 'create_relation'; source_ref: EntityRef; target_ref: EntityRef; relation_type: string }
  | { type: 'log'; message: string };

/** Entity reference used in relations and evidence. */
export interface EntityRef {
  id: string;
  type: string;
}

/** Query function for controllers to read case state. */
export type PackQueryFn = (
  collection: 'entities' | 'evidence' | 'moves' | 'relations' | 'decisions',
  filter?: Record<string, unknown>,
) => Promise<unknown[]>;

/** Evidence type specification with validation rules. */
export interface EvidenceTypeSpec {
  name: string;
  description: string;
  /** Required fields in the evidence provenance. */
  required_provenance: string[];
  /** Validation function — returns true if evidence meets domain requirements. */
  validation_rules?: string[];
}

/** A rule template that packs suggest as defaults. */
export interface RuleTemplate {
  type: string;
  statement: string;
  authority_ref?: { type: string };
}

/** Intent template for domain-specific intents. */
export interface IntentTemplate {
  class: string;
  statement_template: string;
  suggested_move_classes: string[];
}

// ── DomainPack Interface ────────────────────────────────────────

export interface DomainPack {
  /** Pack identifier (e.g. 'software', 'procurement'). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Semver version. */
  version: string;
  /** Domain identifier. */
  domain: string;

  /** Domain-specific entity types with JSON Schema definitions. */
  entity_types: Record<string, JSONSchemaLike>;

  /** Domain-specific relation types. */
  relation_types: string[];

  /** Domain-specific controllers that enforce domain rules. */
  controllers: PackController[];

  /** Domain-specific evidence types with validation specs. */
  evidence_types: Record<string, EvidenceTypeSpec>;

  /** Domain-specific move classes. */
  move_classes: string[];

  /** View priority ordering for the sidebar. */
  view_priority: string[];

  /** Default rules applied when a case uses this pack. */
  default_rules: RuleTemplate[];

  /** Intent templates for this domain. */
  intent_templates: IntentTemplate[];

  /** Execution hints for the execution planner. */
  execution_hints: Record<string, unknown>;
}

// ── Helper to create a pack ─────────────────────────────────────

export function definePack(pack: DomainPack): DomainPack {
  return pack;
}

// ── Re-export Executor Contract (SP6 §2.1) ────────────────────────
export type {
  ExecutorContract as UniversalExecutorContract,
  ExecutorCapabilities as UniversalExecutorCapabilities,
  ExecutorHealth as UniversalExecutorHealth,
  MoveRef,
  ContextCapsule,
  AttemptBinding,
  ProgressReport,
  SteeringCommand as ExecutorSteeringCommand,
  Evidence as ExecutorEvidence,
} from './executor-contract.js';
