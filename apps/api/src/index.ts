import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { startEmbeddedPostgres, getConnectionString, getDb, runMigrations, stopEmbeddedPostgres, closeDb } from '@pos/db';
import { authRoutes } from './routes/auth.js';
import { caseRoutes } from './routes/cases.js';
import { moveRoutes } from './routes/moves.js';
import { decisionRoutes } from './routes/decisions.js';
import { evidenceRoutes } from './routes/evidence.js';
import { intentRoutes } from './routes/intents.js';
import { entityRoutes } from './routes/entities.js';
import { relationRoutes } from './routes/relations.js';
import { ruleRoutes } from './routes/rules.js';
import { actorRoutes } from './routes/actors.js';
import { resourceRoutes } from './routes/resources.js';
import { kanbanRoutes } from './routes/kanban.js';
import { attentionRoutes } from './routes/attention.js';
import { timelineRoutes } from './routes/timeline.js';
import { whyRoutes } from './routes/why.js';
import { steeringRoutes } from './routes/steering.js';
import { timeTravelRoutes } from './routes/time-travel.js';
import { simulationRoutes } from './routes/simulation.js';
import { intelligenceRoutes } from './routes/intelligence.js';
import { packRoutes } from './routes/packs.js';
import { commandRoutes } from './routes/commands.js';
import { invitationRoutes } from './routes/invitations.js';
import { teamManagementRoutes, caseTeamRoutes } from './routes/teams-management.js';
import { orgUnitRoutes } from './routes/org-units.js';
import { policyManagementRoutes } from './routes/policy-management.js';
import { memberRoutes } from './routes/members.js';
import { caseAccessRoutes } from './routes/case-access.js';
import { auditRoutes } from './routes/audit.js';
import { adminRoutes } from './routes/admin.js';
import { edgeRoutes } from './routes/edge.js';
import { executionRoutes } from './routes/execution.js';
import { governanceRoutes } from './routes/governance.js';
import { searchRoutes } from './routes/search.js';
import { integrationRoutes } from './routes/integrations.js';
import { webhookRoutes } from './routes/webhooks.js';

const PORT = parseInt(process.env['PORT'] ?? '4000', 10);

async function main() {
  console.log('[API] Starting embedded PostgreSQL...');
  await startEmbeddedPostgres();

  const sql = getDb(getConnectionString());
  console.log('[API] Running migrations...');
  await runMigrations(sql);

  // Bootstrap superadmin from env var
  const superadminEmail = process.env['SUPERADMIN_EMAIL'];
  if (superadminEmail) {
    const [existing] = await sql`
      SELECT u.id FROM users u
      JOIN memberships m ON m.user_id = u.id
      WHERE u.email = ${superadminEmail}
      AND m.organization_id = '00000000-0000-0000-0000-000000000000'
    `;
    if (!existing) {
      console.log(`[API] SUPERADMIN_EMAIL set — ${superadminEmail} will be granted superadmin on next login/register`);
      await sql`
        INSERT INTO invitations (organization_id, email, role, token, status, invited_by, expires_at)
        VALUES ('00000000-0000-0000-0000-000000000000', ${superadminEmail}, 'superadmin',
                ${'system-bootstrap-' + Date.now()}, 'pending',
                '00000000-0000-0000-0000-000000000000',
                NOW() + INTERVAL '365 days')
        ON CONFLICT DO NOTHING
      `;
    } else {
      console.log(`[API] SUPERADMIN_EMAIL set — ${superadminEmail} is already a superadmin`);
    }
  }

  const app = new Hono();

  // Global middleware
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
  app.use('*', logger());

  // Health check
  app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Public routes
  app.route('/api/v1/auth', authRoutes(sql));

  // Protected routes
  app.route('/api/v1/cases', caseRoutes(sql));
  app.route('/api/v1/moves', moveRoutes(sql));
  app.route('/api/v1/decisions', decisionRoutes(sql));
  app.route('/api/v1/evidence', evidenceRoutes(sql));
  app.route('/api/v1/intents', intentRoutes(sql));
  app.route('/api/v1/entities', entityRoutes(sql));
  app.route('/api/v1/relations', relationRoutes(sql));
  app.route('/api/v1/rules', ruleRoutes(sql));
  app.route('/api/v1/actors', actorRoutes(sql));
  app.route('/api/v1/resources', resourceRoutes(sql));
  app.route('/api/v1/kanban', kanbanRoutes(sql));
  app.route('/api/v1/attention', attentionRoutes(sql));
  app.route('/api/v1/timeline', timelineRoutes(sql));
  app.route('/api/v1/why', whyRoutes(sql));
  app.route('/api/v1/steering', steeringRoutes(sql));
  app.route('/api/v1/time-travel', timeTravelRoutes(sql));
  app.route('/api/v1/simulation', simulationRoutes(sql));
  app.route('/api/v1/intelligence', intelligenceRoutes(sql));
  app.route('/api/v1/search', searchRoutes(sql));
  app.route('/api/v1/packs', packRoutes(sql));
  app.route('/api/v1/commands', commandRoutes(sql));

  // RBAC / multi-user routes
  app.route('/api/v1/invitations', invitationRoutes(sql));
  app.route('/api/v1/teams', teamManagementRoutes(sql));
  app.route('/api/v1/org-units', orgUnitRoutes(sql));
  app.route('/api/v1/policies', policyManagementRoutes(sql));
  app.route('/api/v1/members', memberRoutes(sql));
  app.route('/api/v1/cases/:id/access', caseAccessRoutes(sql));
  app.route('/api/v1/cases/:caseId/teams', caseTeamRoutes(sql));
  app.route('/api/v1/audit', auditRoutes(sql));

  // Execution routes (SP3 — managed execution)
  app.route('/api/v1', executionRoutes(sql));

  // Governance routes (SP4 — autonomy, budget, authority)
  app.route('/api/v1/governance', governanceRoutes(sql));

  // Integrations routes (SP6 — external integrations)
  app.route('/api/v1/integrations', integrationRoutes(sql));
  app.route('/api/v1/webhooks', webhookRoutes(sql));

  // Admin routes (system org only)
  app.route('/api/v1/admin', adminRoutes(sql));

  // Process Edge routes — device pairing, event ingestion, context capsule, policy mirror.
  // Lives outside /api/v1 per the control-plane extension spec (§10.1); auth is mixed
  // per-route inside edgeRoutes (some endpoints are unauthenticated pairing steps,
  // others require a device auth token rather than a user JWT).
  app.route('/edge/v1', edgeRoutes(sql));

  // Seed default process packs
  await seedProcessPacks(sql);

  // Start server
  const server = serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[API] Universal Process OS API running on http://localhost:${PORT}`);
    console.log(`[API] Health check: http://localhost:${PORT}/api/health`);
  });

  // Graceful shutdown
  async function shutdown() {
    console.log('\n[API] Shutting down...');
    server.close();
    await closeDb();
    await stopEmbeddedPostgres();
    console.log('[API] Goodbye.');
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function seedProcessPacks(sql: any) {
  const [existing] = await sql`SELECT count(*) AS cnt FROM process_packs`;
  if (Number(existing?.cnt ?? 0) > 0) return;

  console.log('[API] Seeding default process packs...');

  const packs = [
    {
      id: crypto.randomUUID(),
      name: 'Software Delivery',
      version: '1.0.0',
      domain: 'software',
      type_schemas: { 'software.repository': {}, 'software.commit': {}, 'software.pr': {}, 'software.deployment': {}, 'software.test_suite': {} },
      relation_types: ['IMPLEMENTS', 'TESTS', 'DEPLOYS', 'REVIEWS'],
      views: ['kanban', 'dependencies', 'agents', 'evidence', 'timeline'],
      default_rules: [
        { type: 'Requirement', statement: 'Tests must pass before merge' },
        { type: 'Requirement', statement: 'Code review required' },
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'Procurement & Tender',
      version: '1.0.0',
      domain: 'procurement',
      type_schemas: { 'procurement.requirement': {}, 'procurement.document': {}, 'procurement.submission': {}, 'procurement.clarification': {} },
      relation_types: ['SATISFIES', 'CLARIFIES', 'REFERENCES', 'SUPERSEDES'],
      views: ['compliance', 'requirements', 'documents', 'deadlines', 'decisions'],
      default_rules: [
        { type: 'Deadline', statement: 'Submission deadline must be met' },
        { type: 'Requirement', statement: 'All mandatory documents must be present' },
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'Investigative Journalism',
      version: '1.0.0',
      domain: 'investigation',
      type_schemas: { 'journalism.source': {}, 'journalism.claim': {}, 'journalism.document': {}, 'journalism.interview': {} },
      relation_types: ['SUPPORTS', 'CONTRADICTS', 'CITES', 'RETRACTS'],
      views: ['evidence', 'claims', 'sources', 'contradictions', 'timeline'],
      default_rules: [
        { type: 'Requirement', statement: 'Claims must have independent sources' },
        { type: 'Policy', statement: 'Contradictions must be addressed before publication' },
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'Research',
      version: '1.0.0',
      domain: 'research',
      type_schemas: { 'research.hypothesis': {}, 'research.experiment': {}, 'research.dataset': {}, 'research.finding': {} },
      relation_types: ['TESTS', 'SUPPORTS', 'DISPROVES', 'EXTENDS'],
      views: ['hypotheses', 'experiments', 'findings', 'evidence', 'timeline'],
      default_rules: [
        { type: 'Policy', statement: 'Negative findings are valid outcomes' },
        { type: 'Requirement', statement: 'Experiments must be reproducible' },
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'Negotiation & Sales',
      version: '1.0.0',
      domain: 'negotiation',
      type_schemas: { 'negotiation.stakeholder': {}, 'negotiation.offer': {}, 'negotiation.commitment': {}, 'negotiation.signal': {} },
      relation_types: ['PROPOSES', 'COUNTERS', 'COMMITS', 'REJECTS'],
      views: ['stakeholders', 'commitments', 'signals', 'decisions', 'timeline'],
      default_rules: [
        { type: 'Policy', statement: 'No deal is a valid outcome' },
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'Incident Response',
      version: '1.0.0',
      domain: 'incident',
      type_schemas: { 'incident.alert': {}, 'incident.hypothesis': {}, 'incident.mitigation': {}, 'incident.postmortem': {} },
      relation_types: ['CAUSES', 'MITIGATES', 'ESCALATES', 'RECOVERS'],
      views: ['timeline', 'hypotheses', 'risk', 'evidence', 'actors'],
      default_rules: [
        { type: 'Policy', statement: 'Escalate if impact increases' },
        { type: 'Requirement', statement: 'Post-incident review required' },
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'Physical Logistics',
      version: '1.0.0',
      domain: 'logistics',
      type_schemas: { 'logistics.asset': {}, 'logistics.shipment': {}, 'logistics.location': {}, 'logistics.custody': {} },
      relation_types: ['CONTAINS', 'LOCATED_AT', 'CUSTODY_OF', 'SPLITS', 'MERGES'],
      views: ['resources', 'timeline', 'risk', 'compliance', 'actors'],
      default_rules: [
        { type: 'Requirement', statement: 'Chain of custody must be maintained' },
        { type: 'Invariant', statement: 'Asset quantities must balance' },
      ],
    },
  ];

  for (const pack of packs) {
    await sql`
      INSERT INTO process_packs (id, name, version, domain, type_schemas, relation_types, views, default_rules)
      VALUES (${pack.id}, ${pack.name}, ${pack.version}, ${pack.domain},
              ${sql.json(pack.type_schemas)}, ${sql.json(pack.relation_types)},
              ${sql.json(pack.views)}, ${sql.json(pack.default_rules)})
      ON CONFLICT (name, version) DO NOTHING
    `;
  }

  console.log(`[API] Seeded ${packs.length} process packs`);
}

main().catch((err) => {
  console.error('[API] Fatal error:', err);
  process.exit(1);
});
