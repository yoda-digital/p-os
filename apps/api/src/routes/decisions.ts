import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function decisionRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const decisions = await sql`SELECT * FROM decisions WHERE case_id = ${caseId} ORDER BY created_at DESC`;
    return c.json(decisions);
  });

  // GET /:id — single decision with full detail
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [decision] = await sql`SELECT * FROM decisions WHERE id = ${id}`;
    if (!decision) return c.json({ error: 'Decision not found' }, 404);

    // Fetch linked evidence for each option
    const evidenceRefs = (decision.evidence_refs as string[]) ?? [];
    let evidence: readonly unknown[] = [];
    if (evidenceRefs.length > 0) {
      evidence = await sql`SELECT id, relation, confidence, validity, observed_at FROM evidence WHERE id = ANY(${evidenceRefs})`;
    }

    return c.json({ ...decision, linked_evidence: evidence });
  });

  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();
    const caseId = body.case_id;
    if (!caseId) return c.json({ error: 'case_id required' }, 400);

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${caseId}`;
    if (!caseRow) return c.json({ error: 'Case not found' }, 404);

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Decision.Create',
      tenant_id: caseRow.organization_id as string,
      case_id: caseId,
      actor_id: user.user_id,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [decision] = await sql`SELECT * FROM decisions WHERE id = ${result.data?.id as string}`;
    return c.json(decision, 201);
  });

  // PATCH /:id — update decision options, evidence, recommendation
  app.patch('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json();

    const [decision] = await sql`SELECT * FROM decisions WHERE id = ${id}`;
    if (!decision) return c.json({ error: 'Decision not found' }, 404);
    if (decision.state === 'decided') return c.json({ error: 'Cannot modify a decided decision' }, 400);

    // Build update fields
    const updates: Record<string, unknown> = {};
    if (body.options !== undefined) updates['options'] = sql.json(body.options);
    if (body.evidence_refs !== undefined) updates['evidence_refs'] = sql.json(body.evidence_refs);
    if (body.context !== undefined) updates['context'] = body.context;
    if (body.question !== undefined) updates['question'] = body.question;
    if (body.required_authority !== undefined) updates['required_authority'] = sql.json(body.required_authority);
    if (body.state !== undefined && ['draft', 'requested', 'in_review'].includes(body.state)) {
      updates['state'] = body.state;
    }

    if (Object.keys(updates).length === 0) return c.json({ error: 'No valid fields to update' }, 400);

    // Apply updates dynamically
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 0;

    for (const [key, val] of Object.entries(updates)) {
      setClauses.push(`${key} = $${++idx + 1}`);
      values.push(val);
    }

    // Use raw update since we have variable columns
    await sql`
      UPDATE decisions
      SET ${sql.unsafe(Object.entries(updates).map(([k]) => `"${k}" = excluded."${k}"`).join(', '))}
      WHERE id = ${id}
    `.catch(async () => {
      // Fallback: update individually
      for (const [key, val] of Object.entries(updates)) {
        await sql`UPDATE decisions SET ${sql(key)} = ${val as any}, revision = revision + 1 WHERE id = ${id}`;
      }
    });

    // Simpler approach: update each field individually
    if (body.options !== undefined) {
      await sql`UPDATE decisions SET options = ${sql.json(body.options)}, revision = revision + 1 WHERE id = ${id}`;
    }
    if (body.evidence_refs !== undefined) {
      await sql`UPDATE decisions SET evidence_refs = ${sql.json(body.evidence_refs)}, revision = revision + 1 WHERE id = ${id}`;
    }
    if (body.context !== undefined) {
      await sql`UPDATE decisions SET context = ${body.context}, revision = revision + 1 WHERE id = ${id}`;
    }
    if (body.state !== undefined && ['draft', 'requested', 'in_review'].includes(body.state)) {
      await sql`UPDATE decisions SET state = ${body.state}, revision = revision + 1 WHERE id = ${id}`;
    }
    if (body.required_authority !== undefined) {
      await sql`UPDATE decisions SET required_authority = ${sql.json(body.required_authority)}, revision = revision + 1 WHERE id = ${id}`;
    }

    // Emit update event
    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${decision.case_id}`;
    const eventId = crypto.randomUUID();
    await sql`
      INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, data)
      VALUES (${eventId}, ${caseRow?.organization_id as string}, ${decision.case_id as string},
              'DecisionUpdated', ${user.user_id}, NOW(),
              ${sql.json({ decision_id: id, updated_fields: Object.keys(body) })})
    `;
    await sql`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;

    const [updated] = await sql`SELECT * FROM decisions WHERE id = ${id}`;
    return c.json(updated);
  });

  // POST /:id/recommend — generate AI recommendation
  app.post('/:id/recommend', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const [decision] = await sql`SELECT * FROM decisions WHERE id = ${id}`;
    if (!decision) return c.json({ error: 'Decision not found' }, 404);

    const options = (decision.options as Array<{ label: string; description?: string }>) ?? [];
    if (options.length === 0) return c.json({ error: 'Decision must have options before recommendation' }, 400);

    // Simple heuristic recommendation based on available evidence and risks.
    // In production this would call an LLM, but here we build a structured
    // recommendation from the decision's existing data.

    const evidenceRefs = (decision.evidence_refs as string[]) ?? [];
    let evidenceStrength = 0.5;
    if (evidenceRefs.length > 0) {
      const evidenceRows = await sql`
        SELECT confidence, validity FROM evidence WHERE id = ANY(${evidenceRefs})
      `;
      const validEvidence = evidenceRows.filter(e => e.validity === 'valid');
      if (validEvidence.length > 0) {
        evidenceStrength = validEvidence.reduce((sum, e) => sum + Number(e.confidence ?? 0.5), 0) / validEvidence.length;
      }
    }

    // Score each option based on evidence coverage and risk balance
    const scored = options.map((opt, idx) => {
      const evidenceCount = (opt as any).evidence_refs?.length ?? 0;
      const riskCount = (opt as any).risks?.length ?? 0;
      const tradeoffCount = (opt as any).tradeoffs?.length ?? 0;
      // More evidence, fewer risks = better score
      const score = (evidenceCount * 0.4 + (1 - riskCount * 0.15) * 0.3 + evidenceStrength * 0.3);
      return { index: idx, label: opt.label, score: Math.max(0, Math.min(1, score)) };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    const confidence = body.confidence ?? Math.round(best!.score * 100) / 100;
    const rationale = body.rationale ??
      `Based on ${evidenceRefs.length} evidence items (avg strength: ${(evidenceStrength * 100).toFixed(0)}%), ` +
      `"${best!.label}" has the strongest evidence support among ${options.length} options.`;

    // Store the recommendation
    await sql`
      UPDATE decisions
      SET recommended_option = ${sql.json(best!.label)},
          recommendation_confidence = ${confidence},
          recommendation_rationale = ${rationale},
          state = 'in_review',
          revision = revision + 1
      WHERE id = ${id}
    `;

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${decision.case_id}`;
    const eventId = crypto.randomUUID();
    await sql`
      INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, data)
      VALUES (${eventId}, ${caseRow?.organization_id as string}, ${decision.case_id as string},
              'DecisionRecommended', ${user.user_id}, NOW(),
              ${sql.json({ decision_id: id, recommended_option: best!.label, confidence, rationale })})
    `;
    await sql`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;

    const [updated] = await sql`SELECT * FROM decisions WHERE id = ${id}`;
    return c.json(updated);
  });

  app.post('/:id/resolve', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json();

    const [decision] = await sql`SELECT case_id FROM decisions WHERE id = ${id}`;
    if (!decision) return c.json({ error: 'Decision not found' }, 404);

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${decision.case_id}`;

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Decision.Resolve',
      tenant_id: caseRow?.organization_id as string,
      case_id: decision.case_id as string,
      actor_id: user.user_id,
      target_ref: { id, type: 'decision' },
      issued_at: new Date().toISOString(),
      payload: {
        id,
        selected_option: body.selected_option,
        rationale: body.rationale,
        confidence: body.confidence,
        evidence_refs: body.evidence_refs,
      },
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [updated] = await sql`SELECT * FROM decisions WHERE id = ${id}`;
    return c.json(updated);
  });

  return app;
}
