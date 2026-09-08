import type { DomainPack, PackController, ControllerContext, ControllerAction } from '@pos/process-sdk';

// ── Controllers ─────────────────────────────────────────────────

const contradictionController: PackController = {
  name: 'ContradictionController',
  description: 'When new evidence is attached, check for contradictions with existing claims. Flags contradictions for editorial attention.',
  triggers: ['EvidenceAttached', 'EntityCreated', 'RelationAdded'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    // Check if a CONTRADICTS relation was just added
    if (ctx.event_type === 'RelationAdded') {
      const relType = event_data['type'] as string;
      if (relType === 'CONTRADICTS') {
        actions.push({
          type: 'raise_attention',
          priority: 'high',
          reason: 'Contradiction detected between claims — editorial review required',
        });
      }
      return actions;
    }

    // When evidence is attached, look for existing claims it might contradict
    if (ctx.event_type === 'EvidenceAttached') {
      const claims = await query('entities', { type: 'journalism.claim' });
      const relations = await query('relations', { relation_type: 'CONTRADICTS' });

      // If there are contradictions, raise attention
      if ((relations as any[]).length > 0) {
        const unresolvedContradictions = (relations as any[]).filter(r => !r.metadata?.resolved);
        if (unresolvedContradictions.length > 0) {
          actions.push({
            type: 'raise_attention',
            priority: 'high',
            reason: `${unresolvedContradictions.length} unresolved contradiction(s) detected`,
          });
        }
      }
    }

    return actions;
  },
};

const sourceVerificationController: PackController = {
  name: 'SourceVerificationController',
  description: 'Require independent corroboration for high-impact claims. Claims need at least 2 independent sources.',
  triggers: ['EvidenceAttached', 'EntityCreated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    // Check claims that have only one source
    const claims = await query('entities', { type: 'journalism.claim' });

    for (const claim of claims as any[]) {
      const confidence = claim.properties?.confidence ?? 0;
      if (confidence < 0.7) continue; // only check high-confidence/high-impact claims

      // Count supporting evidence from independent sources
      const evidence = await query('evidence', { subject_id: claim.id });
      const sources = new Set<string>();
      for (const ev of evidence as any[]) {
        const sourceId = ev.provenance?.source_id ?? ev.source_ref?.id;
        if (sourceId) sources.add(sourceId);
      }

      if (sources.size < 2 && (evidence as any[]).length > 0) {
        actions.push({
          type: 'raise_attention',
          priority: 'medium',
          reason: `Claim "${claim.title}" has only ${sources.size} independent source(s) — needs corroboration`,
        });
      }
    }

    return actions;
  },
};

const retractionController: PackController = {
  name: 'RetractionController',
  description: 'When a source retracts, cascade invalidation to all claims derived from that source.',
  triggers: ['EntityCreated', 'EvidenceInvalidated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    const entityType = event_data['type'] as string;
    if (entityType !== 'journalism.retraction') return [];

    const retractedClaimId = (event_data['properties'] as any)?.original_claim;
    if (!retractedClaimId) return [];

    // Find all evidence that references the retracted claim
    const evidence = await query('evidence', { subject_id: retractedClaimId });
    for (const ev of evidence as any[]) {
      if (ev.validity === 'valid') {
        actions.push({
          type: 'invalidate_evidence',
          evidence_id: ev.id,
          reason: `Source retraction — original claim retracted`,
        });
      }
    }

    // Find derived claims (claims that CITES or SUPPORTS the retracted claim)
    const relations = await query('relations', { target_id: retractedClaimId });
    for (const rel of relations as any[]) {
      if (rel.type === 'CITES' || rel.type === 'SUPPORTS') {
        actions.push({
          type: 'raise_attention',
          priority: 'critical',
          reason: `Retraction cascade: claim ${rel.source_ref?.id} derived from retracted claim`,
        });
      }
    }

    return actions;
  },
};

// ── Pack Definition ─────────────────────────────────────────────

export const investigationPack: DomainPack = {
  id: 'investigation',
  name: 'Investigative Journalism',
  version: '1.0.0',
  domain: 'journalism',

  entity_types: {
    'journalism.source': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['person', 'document', 'public_record', 'anonymous', 'expert'] },
        reliability: { type: 'string', enum: ['verified', 'trusted', 'unverified', 'unreliable'] },
        contact: { type: 'string' },
        protection_level: { type: 'string', enum: ['public', 'confidential', 'deep_background'] },
      },
    },
    'journalism.claim': {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        source: { type: 'string' },
        confidence: { type: 'number' as any },
        verified: { type: 'boolean' as any },
        impact_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
    },
    'journalism.document': {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: { type: 'string' },
        obtained_at: { type: 'string' },
        classification: { type: 'string', enum: ['public', 'leaked', 'foia', 'confidential'] },
      },
    },
    'journalism.interview': {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        date: { type: 'string' },
        format: { type: 'string', enum: ['in_person', 'phone', 'email', 'video'] },
        on_record: { type: 'boolean' as any },
        key_quotes: { type: 'array' as any, items: { type: 'string' } },
      },
    },
    'journalism.publication': {
      type: 'object',
      properties: {
        title: { type: 'string' },
        outlet: { type: 'string' },
        publish_date: { type: 'string' },
        url: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'review', 'legal_review', 'published', 'retracted'] },
      },
    },
  },

  relation_types: ['SUPPORTS', 'CONTRADICTS', 'CITES', 'RETRACTS', 'CORROBORATES'],

  controllers: [contradictionController, sourceVerificationController, retractionController],

  evidence_types: {
    'source_statement': {
      name: 'Source Statement',
      description: 'A statement from a named or anonymous source.',
      required_provenance: ['source_id', 'on_record'],
    },
    'document_excerpt': {
      name: 'Document Excerpt',
      description: 'An excerpt from a document supporting or contradicting a claim.',
      required_provenance: ['document_id', 'page_reference'],
    },
    'public_record': {
      name: 'Public Record',
      description: 'Information from publicly available records.',
      required_provenance: ['record_type', 'source_url'],
    },
    'expert_opinion': {
      name: 'Expert Opinion',
      description: 'Expert analysis or opinion on a claim.',
      required_provenance: ['expert_name', 'field'],
    },
  },

  move_classes: ['INVESTIGATE', 'INTERVIEW', 'VERIFY_CLAIM', 'DRAFT_ARTICLE', 'PUBLISH'],

  view_priority: ['evidence', 'timeline', 'decisions', 'actors', 'risk'],

  default_rules: [
    { type: 'Requirement', statement: 'Claims require at least 2 independent sources', authority_ref: { type: 'editorial' } },
    { type: 'Prohibition', statement: 'No claim/fact collapse — claims remain claims until independently verified', authority_ref: { type: 'system' } },
    { type: 'Policy', statement: 'Contradictions must be addressed before publication', authority_ref: { type: 'editorial' } },
  ],

  intent_templates: [
    { class: 'INVESTIGATE', statement_template: 'Investigate {topic}', suggested_move_classes: ['INVESTIGATE', 'INTERVIEW', 'VERIFY_CLAIM'] },
    { class: 'PUBLISH', statement_template: 'Publish investigation on {topic}', suggested_move_classes: ['DRAFT_ARTICLE', 'PUBLISH'] },
  ],

  execution_hints: {
    prioritize_evidence_view: true,
  },
};
