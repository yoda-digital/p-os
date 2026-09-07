export const researchPack = {
  id: 'research',
  name: 'Research',
  version: '0.1.0',
  domain: 'research',
  type_schemas: {
    'research.hypothesis': { type: 'object', properties: { statement: { type: 'string' }, status: { type: 'string' }, confidence: { type: 'number' } } },
    'research.experiment': { type: 'object', properties: { name: { type: 'string' }, methodology: { type: 'string' }, status: { type: 'string' }, outcome: { type: 'string' } } },
    'research.finding': { type: 'object', properties: { summary: { type: 'string' }, significance: { type: 'string' }, positive: { type: 'boolean' } } },
    'research.dataset': { type: 'object', properties: { name: { type: 'string' }, source: { type: 'string' }, size: { type: 'number' }, format: { type: 'string' } } },
    'research.literature': { type: 'object', properties: { title: { type: 'string' }, authors: { type: 'array', items: { type: 'string' } }, doi: { type: 'string' }, relevance: { type: 'string' } } },
    'research.methodology': { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, limitations: { type: 'array', items: { type: 'string' } } } },
  },
  relation_types: ['TESTS', 'SUPPORTS', 'CONTRADICTS', 'REPLACES', 'EXTENDS', 'USES_DATA', 'CITES'],
  views: ['evidence', 'kanban', 'timeline', 'dependencies'],
  controllers: ['evidence', 'completion', 'attention'],
  default_rules: [
    { type: 'Policy', statement: 'Negative findings may satisfy LEARN intents', authority_ref: { type: 'system' } },
    { type: 'Requirement', statement: 'Hypotheses must have defined stopping rules', authority_ref: { type: 'system' } },
  ],
  execution_hints: {},
  extractors: ['hypothesis', 'finding', 'citation'],
} as const;
