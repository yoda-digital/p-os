import type { DomainPack } from '@pos/process-sdk';

export const corePack: DomainPack = {
  id: 'core',
  name: 'Core Process Pack',
  version: '1.0.0',
  domain: 'core',

  entity_types: {
    'core.case': { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } } },
    'core.move': { type: 'object', properties: { title: { type: 'string' }, objective: { type: 'string' } } },
    'core.document': { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, format: { type: 'string' } } },
    'core.person': { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' } } },
    'core.milestone': { type: 'object', properties: { name: { type: 'string' }, target_date: { type: 'string' } } },
    'core.comment': { type: 'object', properties: { text: { type: 'string' }, author: { type: 'string' } } },
  },

  relation_types: ['DEPENDS_ON', 'BLOCKS', 'REQUIRES', 'PRODUCES', 'SUPPORTS', 'CONTRADICTS', 'SUPERSEDES', 'CONTAINS'],

  controllers: [],  // Core pack has no domain-specific controllers — kernel controllers handle everything

  evidence_types: {
    'observation': {
      name: 'Observation',
      description: 'A general observation or assessment.',
      required_provenance: ['observer'],
    },
    'document_review': {
      name: 'Document Review',
      description: 'Review of a document.',
      required_provenance: ['document_id', 'reviewer'],
    },
  },

  move_classes: ['PLAN', 'EXECUTE', 'VERIFY', 'REVIEW', 'REPORT'],

  view_priority: ['kanban', 'timeline', 'attention', 'dependencies', 'evidence', 'decisions'],

  default_rules: [],

  intent_templates: [
    { class: 'ACHIEVE', statement_template: 'Achieve {goal}', suggested_move_classes: ['PLAN', 'EXECUTE', 'VERIFY'] },
    { class: 'DELIVER', statement_template: 'Deliver {deliverable}', suggested_move_classes: ['PLAN', 'EXECUTE', 'REVIEW'] },
  ],

  execution_hints: {},
};
