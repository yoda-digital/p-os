import type { DomainPack, PackController, ControllerContext, ControllerAction } from '@pos/process-sdk';

// ── Controllers ─────────────────────────────────────────────────

const commitmentTracker: PackController = {
  name: 'CommitmentTracker',
  description: 'Track what each party has committed to. Raises attention when commitments conflict or expire.',
  triggers: ['EntityCreated', 'EvidenceAttached'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    const entityType = event_data['type'] as string;
    if (entityType !== 'negotiation.commitment') return [];

    const props = (event_data['properties'] as any) ?? {};

    // If commitment has conditions, check if they conflict with existing commitments
    if (props.conditions && Array.isArray(props.conditions) && props.conditions.length > 0) {
      const existingCommitments = await query('entities', { type: 'negotiation.commitment' });
      const conflicting = (existingCommitments as any[]).filter(c => {
        const existingConditions = c.properties?.conditions ?? [];
        return existingConditions.some((ec: string) =>
          props.conditions.some((nc: string) =>
            ec.toLowerCase().includes('not') && nc.toLowerCase().includes(ec.replace(/not\s*/i, '').trim())
          )
        );
      });

      if (conflicting.length > 0) {
        actions.push({
          type: 'raise_attention',
          priority: 'high',
          reason: `New commitment may conflict with ${conflicting.length} existing commitment(s)`,
        });
      }
    }

    // Track binding vs non-binding
    if (props.binding) {
      actions.push({
        type: 'log',
        message: `Binding commitment recorded from ${props.party ?? 'unknown party'}`,
      });
    }

    return actions;
  },
};

const signalAnalyzer: PackController = {
  name: 'SignalAnalyzer',
  description: 'Interpret signals for deal health. Aggregate signal confidence to assess deal trajectory.',
  triggers: ['EntityCreated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    const entityType = event_data['type'] as string;
    if (entityType !== 'negotiation.signal') return [];

    // Aggregate all signals to assess deal health
    const signals = await query('entities', { type: 'negotiation.signal' });
    const positive = (signals as any[]).filter(s => s.properties?.type === 'positive');
    const negative = (signals as any[]).filter(s => s.properties?.type === 'negative');

    const ratio = positive.length / Math.max(positive.length + negative.length, 1);

    if (ratio < 0.3 && (signals as any[]).length >= 3) {
      actions.push({
        type: 'raise_attention',
        priority: 'high',
        reason: `Deal health declining — ${negative.length} negative signals vs ${positive.length} positive`,
      });
    }

    return actions;
  },
};

const noDealController: PackController = {
  name: 'NoDealController',
  description: '"No deal" is a valid successful outcome. Prevents the system from treating walk-away as failure.',
  triggers: ['DecisionCreated', 'DecisionResolved'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data } = ctx;
    const actions: ControllerAction[] = [];

    if (ctx.event_type === 'DecisionResolved') {
      const selectedOption = event_data['selected_option'] as string;
      if (selectedOption?.toLowerCase().includes('no deal') || selectedOption?.toLowerCase().includes('walk away')) {
        actions.push({
          type: 'log',
          message: 'No-deal outcome selected — this is a valid successful resolution',
        });
      }
    }

    return actions;
  },
};

// ── Pack Definition ─────────────────────────────────────────────

export const negotiationPack: DomainPack = {
  id: 'negotiation',
  name: 'Negotiation & Sales',
  version: '1.0.0',
  domain: 'negotiation',

  entity_types: {
    'negotiation.stakeholder': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        role: { type: 'string' },
        authority_level: { type: 'string', enum: ['decision_maker', 'influencer', 'gatekeeper', 'champion', 'end_user'] },
        interests: { type: 'array' as any, items: { type: 'string' } },
        sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'unknown'] },
      },
    },
    'negotiation.offer': {
      type: 'object',
      properties: {
        description: { type: 'string' },
        value: { type: 'number' as any },
        currency: { type: 'string' },
        terms: { type: 'array' as any, items: { type: 'string' } },
        valid_until: { type: 'string' },
        from_party: { type: 'string' },
      },
    },
    'negotiation.commitment': {
      type: 'object',
      properties: {
        description: { type: 'string' },
        party: { type: 'string' },
        binding: { type: 'boolean' as any },
        conditions: { type: 'array' as any, items: { type: 'string' } },
        expires_at: { type: 'string' },
      },
    },
    'negotiation.signal': {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['positive', 'negative', 'neutral', 'urgency'] },
        description: { type: 'string' },
        confidence: { type: 'number' as any },
        source: { type: 'string' },
      },
    },
    'negotiation.deal_term': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'string' },
        status: { type: 'string', enum: ['proposed', 'agreed', 'disputed', 'dropped'] },
        priority: { type: 'string', enum: ['must_have', 'nice_to_have', 'negotiable'] },
      },
    },
  },

  relation_types: ['PROPOSES', 'COUNTERS', 'COMMITS', 'REJECTS', 'ESCALATES'],

  controllers: [commitmentTracker, signalAnalyzer, noDealController],

  evidence_types: {
    'verbal_commitment': {
      name: 'Verbal Commitment',
      description: 'A verbal commitment from a stakeholder.',
      required_provenance: ['party', 'context'],
    },
    'written_agreement': {
      name: 'Written Agreement',
      description: 'A written or signed agreement.',
      required_provenance: ['document_id', 'parties'],
    },
    'market_signal': {
      name: 'Market Signal',
      description: 'Market intelligence relevant to the negotiation.',
      required_provenance: ['source', 'type'],
    },
    'competitive_intel': {
      name: 'Competitive Intelligence',
      description: 'Information about competitor offerings or positions.',
      required_provenance: ['competitor', 'source'],
    },
  },

  move_classes: ['PROSPECT', 'PROPOSE', 'NEGOTIATE', 'CLOSE', 'DELIVER'],

  view_priority: ['kanban', 'decisions', 'actors', 'timeline', 'risk'],

  default_rules: [
    { type: 'Policy', statement: 'A "no deal" result may be successful', authority_ref: { type: 'system' } },
    { type: 'Policy', statement: 'Binding commitments require human approval', authority_ref: { type: 'system' } },
  ],

  intent_templates: [
    { class: 'CLOSE', statement_template: 'Close deal with {stakeholder}', suggested_move_classes: ['NEGOTIATE', 'CLOSE'] },
    { class: 'PROSPECT', statement_template: 'Qualify {lead} as opportunity', suggested_move_classes: ['PROSPECT', 'PROPOSE'] },
  ],

  execution_hints: {
    require_human_for_commitments: true,
  },
};
