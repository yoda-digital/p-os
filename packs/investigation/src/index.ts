export const investigationPack = {
  id: 'investigation',
  name: 'Investigative Journalism',
  version: '0.1.0',
  domain: 'journalism',
  type_schemas: {
    'journalism.question': { type: 'object', properties: { text: { type: 'string' }, priority: { type: 'string' }, answered: { type: 'boolean' } } },
    'journalism.claim': { type: 'object', properties: { statement: { type: 'string' }, source: { type: 'string' }, confidence: { type: 'number' }, verified: { type: 'boolean' } } },
    'journalism.source': { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, reliability: { type: 'string' }, contact: { type: 'string' } } },
    'journalism.document': { type: 'object', properties: { title: { type: 'string' }, type: { type: 'string' }, obtained_at: { type: 'string' }, classification: { type: 'string' } } },
    'journalism.contradiction': { type: 'object', properties: { claim_a: { type: 'string' }, claim_b: { type: 'string' }, nature: { type: 'string' } } },
    'journalism.retraction': { type: 'object', properties: { original_claim: { type: 'string' }, reason: { type: 'string' }, retracted_at: { type: 'string' } } },
    'journalism.publication_decision': { type: 'object', properties: { article_title: { type: 'string' }, publish: { type: 'boolean' }, conditions: { type: 'array', items: { type: 'string' } } } },
  },
  relation_types: ['SUPPORTS', 'CONTRADICTS', 'SOURCED_FROM', 'CORROBORATES', 'RETRACTS', 'BASED_ON'],
  views: ['evidence', 'kanban', 'timeline', 'decisions', 'actors'],
  controllers: ['evidence', 'contradiction', 'attention'],
  default_rules: [
    { type: 'Requirement', statement: 'Claims require at least 2 independent sources', authority_ref: { type: 'editorial' } },
    { type: 'Prohibition', statement: 'No claim/fact collapse — claims remain claims until independently verified', authority_ref: { type: 'system' } },
  ],
  execution_hints: { prioritize_evidence_view: true },
  extractors: ['claim', 'source', 'contradiction'],
} as const;
