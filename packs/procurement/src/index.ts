import type { DomainPack, PackController, ControllerContext, ControllerAction } from '@pos/process-sdk';

// ── Controllers ─────────────────────────────────────────────────

const clarificationController: PackController = {
  name: 'ClarificationController',
  description: 'When a clarification is issued, re-evaluate affected requirements. A clarification can invalidate previously satisfied requirements.',
  triggers: ['EntityCreated', 'EvidenceAttached'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query, case_id } = ctx;
    const entityType = event_data['type'] as string;
    if (entityType !== 'procurement.clarification') return [];

    const actions: ControllerAction[] = [];
    const clarificationId = (event_data['id'] as string) ?? (event_data['entity_id'] as string);

    // Find relations where this clarification CLARIFIES a requirement
    const relations = await query('relations', { source_type: 'procurement.clarification', source_id: clarificationId });
    for (const rel of relations as any[]) {
      if (rel.type === 'CLARIFIES' || rel.type === 'SUPERSEDES') {
        const targetId = rel.target_ref?.id;
        if (targetId) {
          // Invalidate evidence linked to the affected requirement
          const evidence = await query('evidence', { subject_id: targetId });
          for (const ev of evidence as any[]) {
            if (ev.validity === 'valid') {
              actions.push({
                type: 'invalidate_evidence',
                evidence_id: ev.id,
                reason: `Clarification ${clarificationId} affects requirement — re-evaluation needed`,
              });
            }
          }
          actions.push({
            type: 'raise_attention',
            priority: 'high',
            reason: `Clarification issued — requirement needs re-evaluation`,
          });
        }
      }
    }

    return actions;
  },
};

const deadlineController: PackController = {
  name: 'DeadlineController',
  description: 'Track submission deadlines with escalation. Raises attention when deadlines approach or pass.',
  triggers: ['MoveCreated', 'MoveActivated', 'MoveUpdated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data } = ctx;
    const deadline = event_data['deadline'] as string;
    if (!deadline) return [];

    const moveId = (event_data['move_id'] as string) ?? (event_data['id'] as string);
    const hoursLeft = (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60);

    if (hoursLeft < 0) {
      return [
        { type: 'raise_attention', priority: 'critical', reason: 'Submission deadline has passed', move_id: moveId },
      ];
    }

    if (hoursLeft < 24) {
      return [
        { type: 'raise_attention', priority: 'high', reason: `Submission deadline in ${Math.round(hoursLeft)} hours`, move_id: moveId },
      ];
    }

    return [];
  },
};

const complianceController: PackController = {
  name: 'ComplianceController',
  description: 'Auto-check mandatory document presence. Raises attention when mandatory documents are missing.',
  triggers: ['EvidenceAttached', 'EvidenceInvalidated', 'MoveActivated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { case_id, query } = ctx;
    const actions: ControllerAction[] = [];

    // Check all entities of type procurement.requirement where mandatory=true
    const requirements = await query('entities', { type: 'procurement.requirement' });
    const mandatoryReqs = (requirements as any[]).filter(r => r.properties?.mandatory === true);

    for (const req of mandatoryReqs) {
      const evidence = await query('evidence', { subject_id: req.id });
      const validEvidence = (evidence as any[]).filter(e => e.validity === 'valid');

      if (validEvidence.length === 0) {
        actions.push({
          type: 'raise_attention',
          priority: 'high',
          reason: `Mandatory requirement "${req.title}" has no valid evidence`,
        });
      }
    }

    return actions;
  },
};

// ── Pack Definition ─────────────────────────────────────────────

export const procurementPack: DomainPack = {
  id: 'procurement',
  name: 'Procurement & Tender',
  version: '1.0.0',
  domain: 'procurement',

  entity_types: {
    'procurement.requirement': {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Requirement text' },
        category: { type: 'string', description: 'Category (technical, financial, legal)' },
        mandatory: { type: 'boolean' as any, description: 'Whether this requirement is mandatory' },
        source_document: { type: 'string' },
        evaluation_weight: { type: 'number' as any },
      },
    },
    'procurement.document': {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: { type: 'string', enum: ['tender_notice', 'specification', 'submission', 'clarification', 'evaluation_report'] },
        version: { type: 'string' },
        url: { type: 'string' },
      },
    },
    'procurement.submission': {
      type: 'object',
      properties: {
        type: { type: 'string' },
        deadline: { type: 'string' },
        format: { type: 'string' },
        submitted: { type: 'boolean' as any },
        submitted_at: { type: 'string' },
      },
    },
    'procurement.clarification': {
      type: 'object',
      properties: {
        question: { type: 'string' },
        answer: { type: 'string' },
        issued_at: { type: 'string' },
        answered_at: { type: 'string' },
        affects_requirements: { type: 'array' as any, items: { type: 'string' } },
      },
    },
    'procurement.evaluation_criterion': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        weight: { type: 'number' as any },
        max_score: { type: 'number' as any },
        methodology: { type: 'string' },
      },
    },
    'procurement.bidder': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        registration_number: { type: 'string' },
        qualification_status: { type: 'string', enum: ['pending', 'qualified', 'disqualified'] },
      },
    },
  },

  relation_types: ['SATISFIES', 'CLARIFIES', 'REFERENCES', 'SUPERSEDES', 'CONFLICTS_WITH'],

  controllers: [clarificationController, deadlineController, complianceController],

  evidence_types: {
    'document_present': {
      name: 'Document Present',
      description: 'Confirms a required document has been submitted.',
      required_provenance: ['document_id', 'type'],
      validation_rules: ['document must exist in entity store'],
    },
    'requirement_met': {
      name: 'Requirement Met',
      description: 'Evidence that a specific requirement has been satisfied.',
      required_provenance: ['requirement_id', 'method'],
    },
    'compliance_check': {
      name: 'Compliance Check',
      description: 'Result of a compliance verification.',
      required_provenance: ['checker', 'result'],
      validation_rules: ['result must be compliant or non_compliant'],
    },
    'deadline_met': {
      name: 'Deadline Met',
      description: 'Confirms an action was completed before its deadline.',
      required_provenance: ['deadline', 'completed_at'],
    },
  },

  move_classes: ['DRAFT', 'CLARIFY', 'EVALUATE', 'SUBMIT', 'AWARD'],

  view_priority: ['compliance', 'kanban', 'evidence', 'decisions', 'timeline'],

  default_rules: [
    { type: 'Deadline', statement: 'Submission deadline must be met', authority_ref: { type: 'external' } },
    { type: 'Requirement', statement: 'All mandatory requirements must have evidence', authority_ref: { type: 'system' } },
    { type: 'Policy', statement: 'Clarifications invalidate affected requirement evidence', authority_ref: { type: 'system' } },
  ],

  intent_templates: [
    { class: 'SUBMIT', statement_template: 'Submit {document_type} for {tender_name}', suggested_move_classes: ['DRAFT', 'SUBMIT'] },
    { class: 'RESPOND', statement_template: 'Respond to clarification #{number}', suggested_move_classes: ['CLARIFY'] },
    { class: 'EVALUATE', statement_template: 'Evaluate submissions for {lot_name}', suggested_move_classes: ['EVALUATE', 'AWARD'] },
  ],

  execution_hints: {
    require_human_approval_for_submission: true,
  },
};
