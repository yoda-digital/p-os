import type { DomainPack, PackController, ControllerContext, ControllerAction } from '@pos/process-sdk';

// ── Controllers ─────────────────────────────────────────────────

const hypothesisController: PackController = {
  name: 'HypothesisController',
  description: 'When an experiment result is attached, update the hypothesis status based on the findings.',
  triggers: ['EvidenceAttached', 'EntityCreated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    const provenance = (event_data['provenance'] as Record<string, unknown>) ?? {};
    if (provenance['type'] !== 'experimental_result') return [];

    const result = provenance['result'] as string;
    const hypothesisId = provenance['hypothesis_id'] as string;
    if (!hypothesisId) return [];

    if (result === 'supports') {
      actions.push({
        type: 'log',
        message: `Experiment supports hypothesis ${hypothesisId}`,
      });
    } else if (result === 'disproves' || result === 'rejects') {
      actions.push({
        type: 'raise_attention',
        priority: 'medium',
        reason: `Experiment disproves hypothesis — review stopping rules`,
      });
    }

    return actions;
  },
};

const negativeFindingController: PackController = {
  name: 'NegativeFindingController',
  description: 'A rejected hypothesis CAN satisfy a LEARN intent. Negative findings are valid outcomes.',
  triggers: ['EvidenceAttached', 'EntityCreated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    const entityType = event_data['type'] as string;
    if (entityType !== 'research.finding') return [];

    const positive = (event_data['properties'] as any)?.positive;
    if (positive === false) {
      // Negative finding — still valuable
      actions.push({
        type: 'log',
        message: 'Negative finding recorded — may satisfy LEARN intent',
      });

      // Check if there's a LEARN intent that this finding can satisfy
      const moves = await query('moves', {});
      for (const move of moves as any[]) {
        if (move.class === 'EXPERIMENT' || move.class === 'ANALYZE') {
          actions.push({
            type: 'log',
            message: `Negative finding may satisfy move ${move.id} (${move.class})`,
          });
        }
      }
    }

    return actions;
  },
};

const reproducibilityController: PackController = {
  name: 'ReproducibilityController',
  description: 'Flag unreproduced findings. Findings should be replicated before being considered strong evidence.',
  triggers: ['EvidenceAttached'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { query } = ctx;
    const actions: ControllerAction[] = [];

    const findings = await query('entities', { type: 'research.finding' });

    for (const finding of findings as any[]) {
      // Count replication evidence
      const evidence = await query('evidence', { subject_id: finding.id });
      const replications = (evidence as any[]).filter(
        e => e.provenance?.type === 'experimental_result' && e.provenance?.replication === true
      );

      if (replications.length === 0 && (evidence as any[]).length > 0) {
        actions.push({
          type: 'raise_attention',
          priority: 'low',
          reason: `Finding "${finding.title}" has not been independently replicated`,
        });
      }
    }

    return actions;
  },
};

// ── Pack Definition ─────────────────────────────────────────────

export const researchPack: DomainPack = {
  id: 'research',
  name: 'Research',
  version: '1.0.0',
  domain: 'research',

  entity_types: {
    'research.hypothesis': {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        status: { type: 'string', enum: ['proposed', 'testing', 'supported', 'rejected', 'inconclusive'] },
        confidence: { type: 'number' as any },
        stopping_rules: { type: 'array' as any, items: { type: 'string' } },
      },
    },
    'research.experiment': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        methodology: { type: 'string' },
        status: { type: 'string', enum: ['designed', 'running', 'completed', 'failed'] },
        outcome: { type: 'string' },
        sample_size: { type: 'number' as any },
      },
    },
    'research.dataset': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        source: { type: 'string' },
        size: { type: 'number' as any },
        format: { type: 'string' },
        validation_status: { type: 'string', enum: ['raw', 'cleaned', 'validated'] },
      },
    },
    'research.finding': {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        significance: { type: 'string', enum: ['high', 'medium', 'low', 'not_significant'] },
        positive: { type: 'boolean' as any },
        p_value: { type: 'number' as any },
        effect_size: { type: 'number' as any },
      },
    },
    'research.methodology': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        limitations: { type: 'array' as any, items: { type: 'string' } },
        peer_reviewed: { type: 'boolean' as any },
      },
    },
  },

  relation_types: ['TESTS', 'SUPPORTS', 'DISPROVES', 'EXTENDS', 'REPLICATES'],

  controllers: [hypothesisController, negativeFindingController, reproducibilityController],

  evidence_types: {
    'experimental_result': {
      name: 'Experimental Result',
      description: 'Result from a controlled experiment.',
      required_provenance: ['experiment_id', 'result', 'methodology'],
    },
    'statistical_analysis': {
      name: 'Statistical Analysis',
      description: 'Statistical analysis of experimental data.',
      required_provenance: ['method', 'p_value', 'confidence_interval'],
    },
    'peer_review': {
      name: 'Peer Review',
      description: 'Peer review of methodology or findings.',
      required_provenance: ['reviewer', 'verdict'],
      validation_rules: ['verdict must be accepted, revision_required, or rejected'],
    },
    'dataset_validation': {
      name: 'Dataset Validation',
      description: 'Validation of dataset integrity and quality.',
      required_provenance: ['dataset_id', 'validation_method', 'result'],
    },
  },

  move_classes: ['HYPOTHESIZE', 'EXPERIMENT', 'ANALYZE', 'REPLICATE', 'PUBLISH'],

  view_priority: ['evidence', 'timeline', 'dependencies', 'decisions', 'risk'],

  default_rules: [
    { type: 'Policy', statement: 'Negative findings may satisfy LEARN intents', authority_ref: { type: 'system' } },
    { type: 'Requirement', statement: 'Hypotheses must have defined stopping rules', authority_ref: { type: 'system' } },
    { type: 'Requirement', statement: 'Experiments must be reproducible', authority_ref: { type: 'system' } },
  ],

  intent_templates: [
    { class: 'LEARN', statement_template: 'Determine whether {hypothesis}', suggested_move_classes: ['HYPOTHESIZE', 'EXPERIMENT', 'ANALYZE'] },
    { class: 'VALIDATE', statement_template: 'Replicate findings from {study}', suggested_move_classes: ['REPLICATE', 'ANALYZE'] },
    { class: 'PUBLISH', statement_template: 'Publish research on {topic}', suggested_move_classes: ['ANALYZE', 'PUBLISH'] },
  ],

  execution_hints: {},
};
