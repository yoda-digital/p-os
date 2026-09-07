export const negotiationPack = {
  id: 'negotiation',
  name: 'Negotiation & Sales',
  version: '0.1.0',
  domain: 'negotiation',
  type_schemas: {
    'negotiation.stakeholder': { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, authority_level: { type: 'string' }, interests: { type: 'array', items: { type: 'string' } } } },
    'negotiation.offer': { type: 'object', properties: { description: { type: 'string' }, value: { type: 'number' }, terms: { type: 'array', items: { type: 'string' } }, valid_until: { type: 'string' } } },
    'negotiation.counteroffer': { type: 'object', properties: { original_offer: { type: 'string' }, modifications: { type: 'array', items: { type: 'string' } }, value: { type: 'number' } } },
    'negotiation.commitment': { type: 'object', properties: { description: { type: 'string' }, party: { type: 'string' }, binding: { type: 'boolean' }, conditions: { type: 'array', items: { type: 'string' } } } },
    'negotiation.signal': { type: 'object', properties: { type: { type: 'string' }, description: { type: 'string' }, confidence: { type: 'number' }, source: { type: 'string' } } },
    'negotiation.unknown': { type: 'object', properties: { question: { type: 'string' }, impact: { type: 'string' }, strategy_to_learn: { type: 'string' } } },
  },
  relation_types: ['RESPONDS_TO', 'SUPERSEDES', 'COMMITS_TO', 'SIGNALS', 'BLOCKS', 'ENABLES'],
  views: ['kanban', 'timeline', 'decisions', 'actors', 'risk'],
  controllers: ['deadline', 'attention', 'risk'],
  default_rules: [
    { type: 'Policy', statement: 'A "no deal" result may be successful', authority_ref: { type: 'system' } },
  ],
  execution_hints: { require_human_for_commitments: true },
  extractors: ['offer', 'commitment', 'signal'],
} as const;
