export const incidentPack = {
  id: 'incident',
  name: 'Incident Response',
  version: '0.1.0',
  domain: 'incident',
  type_schemas: {
    'incident.event': { type: 'object', properties: { description: { type: 'string' }, severity: { type: 'string' }, source: { type: 'string' }, detected_at: { type: 'string' } } },
    'incident.hypothesis': { type: 'object', properties: { statement: { type: 'string' }, confidence: { type: 'number' }, evidence_for: { type: 'array', items: { type: 'string' } }, evidence_against: { type: 'array', items: { type: 'string' } } } },
    'incident.mitigation': { type: 'object', properties: { action: { type: 'string' }, status: { type: 'string' }, effectiveness: { type: 'string' } } },
    'incident.impact': { type: 'object', properties: { scope: { type: 'string' }, severity: { type: 'string' }, affected_systems: { type: 'array', items: { type: 'string' } }, affected_users: { type: 'number' } } },
    'incident.recovery_action': { type: 'object', properties: { description: { type: 'string' }, status: { type: 'string' }, verified: { type: 'boolean' } } },
    'incident.post_mortem': { type: 'object', properties: { root_cause: { type: 'string' }, timeline: { type: 'array', items: { type: 'object' } }, action_items: { type: 'array', items: { type: 'string' } }, lessons: { type: 'array', items: { type: 'string' } } } },
  },
  relation_types: ['CAUSED_BY', 'MITIGATES', 'ESCALATES', 'AFFECTS', 'RECOVERS', 'PREVENTS'],
  views: ['timeline', 'kanban', 'evidence', 'risk', 'actors'],
  controllers: ['risk', 'attention', 'deadline', 'evidence'],
  default_rules: [
    { type: 'Policy', statement: 'Escalation required if severity increases', authority_ref: { type: 'system' } },
    { type: 'SafetyRule', statement: 'Preemptive mitigation preferred over reactive recovery', authority_ref: { type: 'system' } },
  ],
  execution_hints: { prioritize_speed: true, escalation_enabled: true },
  extractors: ['incident_event', 'hypothesis', 'impact'],
} as const;
