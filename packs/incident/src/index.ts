import type { DomainPack, PackController, ControllerContext, ControllerAction } from '@pos/process-sdk';

// ── Controllers ─────────────────────────────────────────────────

const escalationController: PackController = {
  name: 'EscalationController',
  description: 'When impact increases or severity changes, auto-escalate. Monitors severity and affected_users to trigger escalation.',
  triggers: ['EntityCreated', 'EvidenceAttached', 'MoveUpdated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    const entityType = event_data['type'] as string;
    if (entityType === 'incident.impact') {
      const severity = (event_data['properties'] as any)?.severity;
      const affectedUsers = (event_data['properties'] as any)?.affected_users ?? 0;

      if (severity === 'critical' || affectedUsers > 1000) {
        actions.push({
          type: 'raise_attention',
          priority: 'critical',
          reason: `Incident escalation: severity=${severity}, affected_users=${affectedUsers}`,
        });
        actions.push({
          type: 'emit_event',
          event_type: 'IncidentEscalated',
          data: { severity, affected_users: affectedUsers, reason: 'Impact threshold exceeded' },
        });
      } else if (severity === 'high' || affectedUsers > 100) {
        actions.push({
          type: 'raise_attention',
          priority: 'high',
          reason: `Incident impact increasing: severity=${severity}, affected_users=${affectedUsers}`,
        });
      }
    }

    // Also check if multiple failed mitigations suggest escalation
    if (entityType === 'incident.mitigation') {
      const effectiveness = (event_data['properties'] as any)?.effectiveness;
      if (effectiveness === 'ineffective') {
        const mitigations = await query('entities', { type: 'incident.mitigation' });
        const failed = (mitigations as any[]).filter(m => m.properties?.effectiveness === 'ineffective');
        if (failed.length >= 2) {
          actions.push({
            type: 'raise_attention',
            priority: 'critical',
            reason: `${failed.length} mitigations ineffective — consider escalation or alternative approach`,
          });
        }
      }
    }

    return actions;
  },
};

const mitigationTracker: PackController = {
  name: 'MitigationTracker',
  description: 'Track mitigation effectiveness. Reports on which mitigations are working and which need replacement.',
  triggers: ['EntityCreated', 'EvidenceAttached'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    const entityType = event_data['type'] as string;
    if (entityType !== 'incident.mitigation') return [];

    const status = (event_data['properties'] as any)?.status;
    const effectiveness = (event_data['properties'] as any)?.effectiveness;

    if (status === 'applied' && effectiveness === 'effective') {
      actions.push({
        type: 'log',
        message: 'Mitigation effective — incident impact may be reducing',
      });
    }

    if (status === 'applied' && effectiveness === 'partial') {
      actions.push({
        type: 'raise_attention',
        priority: 'medium',
        reason: 'Mitigation only partially effective — additional measures may be needed',
      });
    }

    return actions;
  },
};

const postmortemController: PackController = {
  name: 'PostmortemController',
  description: 'Require post-incident review. Raises attention when incident is resolved but no postmortem exists.',
  triggers: ['MoveSatisfied', 'MoveUpdated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query, case_id } = ctx;
    const actions: ControllerAction[] = [];

    // Check if the incident is moving to resolved state
    const moveId = (event_data['move_id'] as string) ?? (event_data['id'] as string);
    if (!moveId) return [];

    // Check if there's a postmortem entity
    const postmortems = await query('entities', { type: 'incident.post_mortem' });
    if ((postmortems as any[]).length === 0) {
      // Check if any RECOVER or MITIGATE moves are done
      const moves = await query('moves', {});
      const recoveryMoves = (moves as any[]).filter(
        m => (m.class === 'RECOVER' || m.class === 'MITIGATE') && m.outcome === 'satisfied'
      );

      if (recoveryMoves.length > 0) {
        actions.push({
          type: 'raise_attention',
          priority: 'medium',
          reason: 'Incident mitigated/recovered but no post-mortem has been created',
        });
      }
    }

    return actions;
  },
};

// ── Pack Definition ─────────────────────────────────────────────

export const incidentPack: DomainPack = {
  id: 'incident',
  name: 'Incident Response',
  version: '1.0.0',
  domain: 'incident',

  entity_types: {
    'incident.alert': {
      type: 'object',
      properties: {
        description: { type: 'string' },
        severity: { type: 'string', enum: ['info', 'warning', 'error', 'critical'] },
        source: { type: 'string' },
        detected_at: { type: 'string' },
        acknowledged: { type: 'boolean' as any },
      },
    },
    'incident.hypothesis': {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        confidence: { type: 'number' as any },
        evidence_for: { type: 'array' as any, items: { type: 'string' } },
        evidence_against: { type: 'array' as any, items: { type: 'string' } },
        status: { type: 'string', enum: ['proposed', 'investigating', 'confirmed', 'disproven'] },
      },
    },
    'incident.mitigation': {
      type: 'object',
      properties: {
        action: { type: 'string' },
        status: { type: 'string', enum: ['proposed', 'in_progress', 'applied', 'rolled_back'] },
        effectiveness: { type: 'string', enum: ['unknown', 'effective', 'partial', 'ineffective'] },
        applied_at: { type: 'string' },
      },
    },
    'incident.postmortem': {
      type: 'object',
      properties: {
        root_cause: { type: 'string' },
        timeline: { type: 'array' as any, items: { type: 'object' } },
        action_items: { type: 'array' as any, items: { type: 'string' } },
        lessons: { type: 'array' as any, items: { type: 'string' } },
        severity_classification: { type: 'string' },
      },
    },
    'incident.affected_system': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        impact_level: { type: 'string', enum: ['none', 'degraded', 'down', 'data_loss'] },
        recovery_status: { type: 'string', enum: ['affected', 'recovering', 'recovered'] },
      },
    },
  },

  relation_types: ['CAUSES', 'MITIGATES', 'ESCALATES', 'RECOVERS', 'ROOT_CAUSE_OF'],

  controllers: [escalationController, mitigationTracker, postmortemController],

  evidence_types: {
    'log_entry': {
      name: 'Log Entry',
      description: 'Log entries from affected systems.',
      required_provenance: ['source_system', 'timestamp', 'level'],
    },
    'metric_snapshot': {
      name: 'Metric Snapshot',
      description: 'Metric values at a specific point in time.',
      required_provenance: ['metric_name', 'value', 'timestamp'],
    },
    'user_report': {
      name: 'User Report',
      description: 'Report from an affected user.',
      required_provenance: ['reporter', 'description'],
    },
    'mitigation_result': {
      name: 'Mitigation Result',
      description: 'Result of applying a mitigation action.',
      required_provenance: ['mitigation_id', 'result'],
      validation_rules: ['result must be effective, partial, or ineffective'],
    },
  },

  move_classes: ['TRIAGE', 'INVESTIGATE', 'MITIGATE', 'RECOVER', 'POSTMORTEM'],

  view_priority: ['timeline', 'risk', 'evidence', 'actors', 'decisions'],

  default_rules: [
    { type: 'Policy', statement: 'Escalation required if severity increases', authority_ref: { type: 'system' } },
    { type: 'SafetyRule', statement: 'Preemptive mitigation preferred over reactive recovery', authority_ref: { type: 'system' } },
    { type: 'Requirement', statement: 'Post-incident review required', authority_ref: { type: 'system' } },
  ],

  intent_templates: [
    { class: 'RESOLVE', statement_template: 'Resolve incident: {description}', suggested_move_classes: ['TRIAGE', 'INVESTIGATE', 'MITIGATE', 'RECOVER'] },
    { class: 'REVIEW', statement_template: 'Conduct post-mortem for {incident}', suggested_move_classes: ['POSTMORTEM'] },
  ],

  execution_hints: {
    prioritize_speed: true,
    escalation_enabled: true,
  },
};
