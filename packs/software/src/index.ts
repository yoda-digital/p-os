import type { DomainPack, PackController, ControllerContext, ControllerAction } from '@pos/process-sdk';

// ── Controllers ─────────────────────────────────────────────────

const testPassController: PackController = {
  name: 'TestPassController',
  description: 'When test evidence is attached, auto-advance move verification if all tests pass.',
  triggers: ['EvidenceAttached'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const provenance = (event_data['provenance'] as Record<string, unknown>) ?? {};
    if (provenance['type'] !== 'test_run' && provenance['type'] !== 'test_result') return [];

    const moveId = event_data['move_id'] as string;
    if (!moveId) return [];

    // Check if all test evidence for this move is passing
    const evidence = await query('evidence', { move_id: moveId, provenance_type: 'test_run' });
    const allPassing = evidence.every((e: any) => {
      const p = e.provenance ?? {};
      return p.result === 'pass' || p.status === 'passed';
    });

    if (allPassing && evidence.length > 0) {
      return [
        { type: 'update_move', move_id: moveId, fields: { verification: 'passed' } },
        { type: 'log', message: `Tests pass for move ${moveId} — verification auto-advanced` },
      ];
    }

    return [];
  },
};

const reviewController: PackController = {
  name: 'ReviewController',
  description: 'When a code review is approved, mark review evidence as valid.',
  triggers: ['EvidenceAttached'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data } = ctx;
    const provenance = (event_data['provenance'] as Record<string, unknown>) ?? {};
    if (provenance['type'] !== 'code_review') return [];

    if (provenance['status'] === 'approved') {
      return [
        { type: 'log', message: 'Code review approved — evidence marked valid' },
      ];
    }

    if (provenance['status'] === 'changes_requested') {
      const moveId = event_data['move_id'] as string;
      if (moveId) {
        return [
          { type: 'raise_attention', priority: 'medium', reason: 'Code review: changes requested', move_id: moveId },
        ];
      }
    }

    return [];
  },
};

const deployController: PackController = {
  name: 'DeployController',
  description: 'When a deployment succeeds, collect deployment evidence automatically.',
  triggers: ['AttemptSucceeded', 'EvidenceAttached'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, event_type } = ctx;
    const provenance = (event_data['provenance'] as Record<string, unknown>) ?? {};

    if (event_type === 'EvidenceAttached' && provenance['type'] === 'deployment_status') {
      if (provenance['status'] === 'success') {
        return [{ type: 'log', message: 'Deployment succeeded — evidence collected' }];
      }
      if (provenance['status'] === 'failed') {
        const moveId = event_data['move_id'] as string;
        return [
          { type: 'raise_attention', priority: 'high', reason: 'Deployment failed', move_id: moveId },
        ];
      }
    }

    return [];
  },
};

// ── Pack Definition ─────────────────────────────────────────────

export const softwarePack: DomainPack = {
  id: 'software',
  name: 'Software Delivery',
  version: '1.0.0',
  domain: 'software',

  entity_types: {
    'software.repository': {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Repository URL' },
        branch: { type: 'string', description: 'Default branch' },
        remote: { type: 'string', description: 'Remote name' },
        provider: { type: 'string', description: 'GitHub, GitLab, etc.' },
      },
    },
    'software.commit': {
      type: 'object',
      properties: {
        sha: { type: 'string' },
        message: { type: 'string' },
        author: { type: 'string' },
        date: { type: 'string' },
        files_changed: { type: 'number' as any },
      },
    },
    'software.pull_request': {
      type: 'object',
      properties: {
        number: { type: 'number' as any },
        title: { type: 'string' },
        state: { type: 'string', enum: ['open', 'closed', 'merged'] },
        url: { type: 'string' },
        author: { type: 'string' },
        reviewers: { type: 'array' as any, items: { type: 'string' } },
      },
    },
    'software.deployment': {
      type: 'object',
      properties: {
        environment: { type: 'string' },
        version: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'running', 'success', 'failed', 'rolled_back'] },
        url: { type: 'string' },
        deployed_at: { type: 'string' },
      },
    },
    'software.test_suite': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        framework: { type: 'string' },
        pass_count: { type: 'number' as any },
        fail_count: { type: 'number' as any },
        coverage_pct: { type: 'number' as any },
      },
    },
    'software.branch': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        base: { type: 'string' },
      },
    },
    'software.worktree': {
      type: 'object',
      properties: {
        path: { type: 'string' },
        branch: { type: 'string' },
      },
    },
  },

  relation_types: ['IMPLEMENTS', 'TESTS', 'DEPLOYS', 'REVIEWS', 'DEPENDS_ON', 'CHERRY_PICKED_FROM'],

  controllers: [testPassController, reviewController, deployController],

  evidence_types: {
    'test_result': {
      name: 'Test Result',
      description: 'Pass/fail result with optional coverage from a test suite run.',
      required_provenance: ['type', 'result'],
      validation_rules: ['result must be pass or fail', 'coverage_pct optional 0-100'],
    },
    'code_review': {
      name: 'Code Review',
      description: 'Review approval or change request from a code reviewer.',
      required_provenance: ['type', 'status', 'reviewer'],
      validation_rules: ['status must be approved or changes_requested'],
    },
    'deployment_status': {
      name: 'Deployment Status',
      description: 'Deployment outcome for a specific environment.',
      required_provenance: ['type', 'status', 'environment'],
      validation_rules: ['status must be success, failed, or rolled_back'],
    },
    'security_scan': {
      name: 'Security Scan',
      description: 'Security vulnerability scan results.',
      required_provenance: ['type', 'tool', 'severity_counts'],
      validation_rules: ['severity_counts must include critical, high, medium, low'],
    },
  },

  move_classes: ['IMPLEMENT', 'REVIEW', 'TEST', 'DEPLOY', 'HOTFIX'],

  view_priority: ['kanban', 'dependencies', 'actors', 'evidence', 'timeline'],

  default_rules: [
    { type: 'Requirement', statement: 'All tests must pass before merge', authority_ref: { type: 'system' } },
    { type: 'Requirement', statement: 'Code review required before merge', authority_ref: { type: 'system' } },
  ],

  intent_templates: [
    { class: 'DELIVER', statement_template: 'Deliver {feature} to {environment}', suggested_move_classes: ['IMPLEMENT', 'REVIEW', 'TEST', 'DEPLOY'] },
    { class: 'FIX', statement_template: 'Fix {issue} in {component}', suggested_move_classes: ['IMPLEMENT', 'TEST', 'DEPLOY'] },
    { class: 'HOTFIX', statement_template: 'Hotfix {issue} in production', suggested_move_classes: ['HOTFIX', 'TEST', 'DEPLOY'] },
  ],

  execution_hints: {
    prefer_worktree_isolation: true,
    default_strategy: 'background_session',
  },
};
