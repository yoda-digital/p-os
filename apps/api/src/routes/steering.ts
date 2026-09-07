import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function steeringRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  // POST / — send steering command
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();

    if (!body.case_id || !body.move_id || !body.class || !body.instruction) {
      return c.json({ error: 'case_id, move_id, class, and instruction are required' }, 400);
    }

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${body.case_id}`;
    if (!caseRow) return c.json({ error: 'Case not found' }, 404);

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Attempt.Steer',
      tenant_id: caseRow.organization_id as string,
      case_id: body.case_id,
      actor_id: user.user_id,
      target_ref: { id: body.attempt_id ?? body.move_id, type: 'attempt' },
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    return c.json({ status: 'accepted', steering_id: result.data?.steering_id }, 201);
  });

  // GET / — get steering history
  app.get('/', async (c) => {
    const attemptId = c.req.query('attemptId');
    const moveId = c.req.query('moveId');

    if (attemptId) {
      const commands = await sql`
        SELECT * FROM steering_commands WHERE attempt_id = ${attemptId} ORDER BY issued_at DESC
      `;
      return c.json(commands);
    }

    if (moveId) {
      const commands = await sql`
        SELECT * FROM steering_commands WHERE move_id = ${moveId} ORDER BY issued_at DESC
      `;
      return c.json(commands);
    }

    return c.json({ error: 'attemptId or moveId required' }, 400);
  });

  return app;
}
