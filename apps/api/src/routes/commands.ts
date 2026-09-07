import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function commandRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  // POST / — generic command submission
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();

    if (!body.type) return c.json({ error: 'Command type is required' }, 400);

    const command = {
      command_id: body.command_id ?? crypto.randomUUID(),
      type: body.type as string,
      tenant_id: body.tenant_id ?? user.organization_id,
      case_id: body.case_id,
      actor_id: body.actor_id ?? user.user_id,
      target_ref: body.target_ref,
      expected_revision: body.expected_revision,
      issued_at: body.issued_at ?? new Date().toISOString(),
      expires_at: body.expires_at,
      idempotency_key: body.idempotency_key,
      payload: body.payload ?? {},
    };

    const result = await processor.process(command);

    const statusCode = result.status === 'accepted' ? 200
      : result.status === 'conflict' ? 409
      : result.status === 'unauthorized' ? 403
      : result.status === 'expired' ? 410
      : 400;

    return c.json(result, statusCode);
  });

  return app;
}
