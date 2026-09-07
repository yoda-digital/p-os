import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';

type Sql = ReturnType<typeof postgres>;

export function orgUnitRoutes(sql: Sql) {
  const app = new Hono();

  app.use('*', authMiddleware);

  // GET / — list org units as a flat list (client builds tree from parent_id)
  app.get('/', async (c) => {
    const user = getUser(c);

    const units = await sql`
      SELECT ou.*,
        (SELECT count(*) FROM unit_memberships um WHERE um.unit_id = ou.id) AS member_count,
        (SELECT count(*) FROM organizational_units child WHERE child.parent_id = ou.id) AS child_count
      FROM organizational_units ou
      WHERE ou.organization_id = ${user.organization_id}
      ORDER BY ou.name ASC
    `;

    return c.json(units);
  });

  // POST / — create org unit
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{
      name: string;
      parent_id?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }>();

    if (!body.name) {
      return c.json({ error: 'Name is required', error_key: 'org_unit.name_required' }, 400);
    }

    // If parent_id is specified, verify it exists in the same org
    if (body.parent_id) {
      const [parent] = await sql`
        SELECT id FROM organizational_units
        WHERE id = ${body.parent_id} AND organization_id = ${user.organization_id}
      `;
      if (!parent) {
        return c.json({ error: 'Parent unit not found', error_key: 'org_unit.parent_not_found' }, 404);
      }
    }

    const id = crypto.randomUUID();

    const [unit] = await sql`
      INSERT INTO organizational_units (id, organization_id, parent_id, name, description, metadata)
      VALUES (
        ${id},
        ${user.organization_id},
        ${body.parent_id ?? null},
        ${body.name},
        ${body.description ?? null},
        ${sql.json((body.metadata ?? {}) as any)}
      )
      RETURNING *
    `;

    await auditLog(sql, c, {
      action: 'org_unit.created',
      resource_type: 'organizational_unit',
      resource_id: id,
      details: { name: body.name, parent_id: body.parent_id ?? null },
    });

    return c.json(unit, 201);
  });

  // PATCH /:id — update org unit
  app.patch('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      parent_id?: string | null;
      description?: string;
      metadata?: Record<string, unknown>;
    }>();

    const [existing] = await sql`
      SELECT * FROM organizational_units
      WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;
    if (!existing) {
      return c.json({ error: 'Organizational unit not found', error_key: 'org_unit.not_found' }, 404);
    }

    // If changing parent, verify no circular reference
    if (body.parent_id !== undefined && body.parent_id !== null) {
      if (body.parent_id === id) {
        return c.json({ error: 'Unit cannot be its own parent', error_key: 'org_unit.circular_reference' }, 400);
      }
      const [parent] = await sql`
        SELECT id FROM organizational_units
        WHERE id = ${body.parent_id} AND organization_id = ${user.organization_id}
      `;
      if (!parent) {
        return c.json({ error: 'Parent unit not found', error_key: 'org_unit.parent_not_found' }, 404);
      }
    }

    const [updated] = await sql`
      UPDATE organizational_units SET
        name = COALESCE(${body.name ?? null}, name),
        parent_id = ${body.parent_id !== undefined ? (body.parent_id ?? null) : existing.parent_id},
        description = COALESCE(${body.description ?? null}, description),
        metadata = COALESCE(${body.metadata ? sql.json(body.metadata as any) : null}, metadata)
      WHERE id = ${id}
      RETURNING *
    `;

    await auditLog(sql, c, {
      action: 'org_unit.updated',
      resource_type: 'organizational_unit',
      resource_id: id,
      details: body,
    });

    return c.json(updated);
  });

  return app;
}
