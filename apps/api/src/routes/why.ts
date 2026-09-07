import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';

type Sql = ReturnType<typeof postgres>;

export function whyRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  // POST / — WHY query
  app.post('/', async (c) => {
    const body = await c.req.json<{ caseId: string; question: string; moveId?: string }>();
    const { caseId, question, moveId } = body;

    if (!caseId || !question) {
      return c.json({ error: 'caseId and question are required' }, 400);
    }

    // Deterministic causal traversal
    const causalChain: Array<{
      event_id: string;
      type: string;
      occurred_at: string;
      actor_id: string | null;
      summary: string;
      caused_by: string | null;
    }> = [];

    // Detect question type and target
    const lowerQ = question.toLowerCase();
    let targetMoveId = moveId;

    // Try to extract move reference from question
    if (!targetMoveId && lowerQ.includes('move')) {
      const idMatch = question.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (idMatch) targetMoveId = idMatch[0];
    }

    let explanation = '';

    if (targetMoveId) {
      // Get move state
      const [move] = await sql`SELECT * FROM moves WHERE id = ${targetMoveId}`;
      if (!move) return c.json({ error: 'Move not found' }, 404);

      if (lowerQ.includes('blocked') || lowerQ.includes('not ready')) {
        // WHY is move blocked?
        // Check dependencies
        const deps = (move.dependencies as string[]) ?? [];
        if (deps.length > 0) {
          const blockers = await sql`
            SELECT id, title, outcome, execution FROM moves WHERE id = ANY(${deps})
          `;
          for (const b of blockers) {
            if (b.outcome !== 'satisfied') {
              // Find the events for this blocker
              const [lastEvent] = await sql`
                SELECT * FROM events WHERE case_id = ${caseId} AND data->>'id' = ${b.id as string}
                ORDER BY case_sequence DESC LIMIT 1
              `;
              causalChain.push({
                event_id: lastEvent?.id as string ?? 'unknown',
                type: 'dependency_unsatisfied',
                occurred_at: (lastEvent?.occurred_at as Date)?.toISOString() ?? new Date().toISOString(),
                actor_id: lastEvent?.actor_id as string ?? null,
                summary: `Dependency "${b.title}" is ${b.outcome} (execution: ${b.execution})`,
                caused_by: null,
              });
            }
          }
          explanation = `Move "${move.title}" is blocked because ${blockers.filter((b: Record<string, unknown>) => b.outcome !== 'satisfied').length} dependencies are not yet satisfied.`;
        }

        // Check if there are decisions blocking it
        const blockingDecisions = await sql`
          SELECT * FROM decisions WHERE case_id = ${caseId} AND ${targetMoveId} = ANY(blocking_move_ids) AND state != 'decided'
        `;
        for (const d of blockingDecisions) {
          causalChain.push({
            event_id: d.id as string,
            type: 'decision_pending',
            occurred_at: (d.created_at as Date).toISOString(),
            actor_id: d.created_by as string,
            summary: `Pending decision: "${d.question}"`,
            caused_by: null,
          });
        }
        if (blockingDecisions.length > 0) {
          explanation += ` Additionally, ${blockingDecisions.length} decision(s) must be resolved.`;
        }

        if (!explanation) {
          explanation = `Move "${move.title}" readiness is "${move.readiness}". No specific blocking dependencies found.`;
        }
      } else if (lowerQ.includes('active') || lowerQ.includes('running')) {
        // WHY is move active?
        const activationEvent = await sql`
          SELECT * FROM events WHERE case_id = ${caseId} AND type = 'MoveActivated' AND data->>'id' = ${targetMoveId}
          ORDER BY case_sequence DESC LIMIT 1
        `;
        if (activationEvent.length > 0) {
          const evt = activationEvent[0]!;
          causalChain.push({
            event_id: evt.id as string,
            type: 'MoveActivated',
            occurred_at: (evt.occurred_at as Date).toISOString(),
            actor_id: evt.actor_id as string,
            summary: `Move was activated`,
            caused_by: evt.causation_id as string,
          });
          explanation = `Move "${move.title}" is active because it was activated at ${(evt.occurred_at as Date).toISOString()}.`;
        }
      } else if (lowerQ.includes('done') || lowerQ.includes('satisfied') || lowerQ.includes('complete')) {
        // WHY is move done?
        const satisfiedEvents = await sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          AND type IN ('MoveSatisfied', 'MoveUpdated')
          AND data->>'id' = ${targetMoveId}
          ORDER BY case_sequence DESC
        `;
        for (const evt of satisfiedEvents) {
          causalChain.push({
            event_id: evt.id as string,
            type: evt.type as string,
            occurred_at: (evt.occurred_at as Date).toISOString(),
            actor_id: evt.actor_id as string,
            summary: `${evt.type}: ${JSON.stringify(evt.data)}`,
            caused_by: evt.causation_id as string,
          });
        }
        explanation = `Move "${move.title}" outcome is "${move.outcome}".`;
      } else {
        // Generic WHY for a move — show its full event history
        const moveEvents = await sql`
          SELECT * FROM events WHERE case_id = ${caseId} AND data->>'id' = ${targetMoveId}
          ORDER BY case_sequence ASC
        `;
        for (const evt of moveEvents) {
          causalChain.push({
            event_id: evt.id as string,
            type: evt.type as string,
            occurred_at: (evt.occurred_at as Date).toISOString(),
            actor_id: evt.actor_id as string,
            summary: `${evt.type}`,
            caused_by: evt.causation_id as string,
          });
        }
        explanation = `Move "${move.title}" is in state: readiness=${move.readiness}, execution=${move.execution}, verification=${move.verification}, outcome=${move.outcome}. ${moveEvents.length} events in history.`;
      }
    } else {
      // Generic case-level WHY
      const recentEvents = await sql`
        SELECT * FROM events WHERE case_id = ${caseId}
        ORDER BY case_sequence DESC LIMIT 20
      `;
      for (const evt of recentEvents) {
        causalChain.push({
          event_id: evt.id as string,
          type: evt.type as string,
          occurred_at: (evt.occurred_at as Date).toISOString(),
          actor_id: evt.actor_id as string,
          summary: `${evt.type}`,
          caused_by: evt.causation_id as string,
        });
      }
      explanation = `Case has ${recentEvents.length} recent events. Ask about a specific move for detailed causal analysis.`;
    }

    return c.json({
      question,
      explanation,
      causal_chain: causalChain,
    });
  });

  return app;
}
