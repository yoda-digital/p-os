import { z } from 'zod';
import { zPackId, zISODateString } from './ids.js';

// ---------------------------------------------------------------------------
// Domain pack reference
// ---------------------------------------------------------------------------

export const zDomainPackRef = z.object({
  pack_id: zPackId,
  version: z.string().min(1),
});
export type DomainPackRef = z.infer<typeof zDomainPackRef>;

// ---------------------------------------------------------------------------
// Type schema (within a pack)
// ---------------------------------------------------------------------------

export const zPackTypeSchema = z.object({
  type_id: z.string().min(1), // e.g. 'software.repository'
  semantic_class: z.string().min(1), // e.g. 'entity', 'relation', 'move'
  schema_version: z.string().default('1.0.0'),
  json_schema: z.record(z.string(), z.unknown()).default({}),
  traits: z.array(z.string()).default([]),
  display: z.object({
    label: z.string(),
    icon: z.string().optional(),
    color: z.string().optional(),
  }).optional(),
});
export type PackTypeSchema = z.infer<typeof zPackTypeSchema>;

// ---------------------------------------------------------------------------
// Pack view
// ---------------------------------------------------------------------------

export const zPackView = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum([
    'kanban',
    'timeline',
    'dependencies',
    'evidence_graph',
    'decisions',
    'compliance',
    'actors',
    'resources',
    'risk',
    'calendar',
    'attention',
    'custom',
  ]),
  config: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().default(0),
});
export type PackView = z.infer<typeof zPackView>;

// ---------------------------------------------------------------------------
// Pack controller extension
// ---------------------------------------------------------------------------

export const zPackController = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type PackController = z.infer<typeof zPackController>;

// ---------------------------------------------------------------------------
// Pack default rule
// ---------------------------------------------------------------------------

export const zPackDefaultRule = z.object({
  type: z.string().min(1),
  statement: z.string().min(1),
  predicate: z.record(z.string(), z.unknown()).default({}),
});
export type PackDefaultRule = z.infer<typeof zPackDefaultRule>;

// ---------------------------------------------------------------------------
// Process pack
// ---------------------------------------------------------------------------

export const zProcessPack = z.object({
  id: zPackId,
  name: z.string().min(1),
  version: z.string().min(1),
  domain: z.string().min(1), // e.g. 'software', 'procurement', 'journalism'
  description: z.string().default(''),
  type_schemas: z.array(zPackTypeSchema).default([]),
  relation_types: z.array(z.string()).default([]),
  views: z.array(zPackView).default([]),
  controllers: z.array(zPackController).default([]),
  default_rules: z.array(zPackDefaultRule).default([]),
  execution_hints: z.record(z.string(), z.unknown()).default({}),
  extractors: z.array(z.object({
    type: z.string(),
    config: z.record(z.string(), z.unknown()).default({}),
  })).default([]),
  created_at: zISODateString.optional(),
});
export type ProcessPack = z.infer<typeof zProcessPack>;
