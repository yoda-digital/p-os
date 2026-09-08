// Execution API Routes (SP3 §3.2)
// POST /moves/:id/execute   — compile plan + dispatch via Edge WSS
// GET  /moves/:id/execution — get current execution status
// POST /moves/:id/stop      — stop execution
// GET  /attempts/:id/logs   — get attempt logs

import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { ExecutionCompiler, type ExecutionPlan, type MoveInput, type CapabilitySet } from '@pos/execution';

type Sql = ReturnType<typeof postgres>;

const compiler = new ExecutionCompiler();

export function executionRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  // ── POST /moves/:id/execute ───────────────────────────────────
  // Compile execution plan + dispatch to connected device via Edge WSS
  app.post('/moves/:id/execute', async (c) => {
    const moveId = c.req.param('id');
    const user = getUser(c);

    // 1. Fetch the move
    const [move] = await sql`SELECT * FROM moves WHERE id = ${moveId}`;
    if (!move) return c.json({ error: 'Move not found' }, 404);

    const caseId = move.case_id as string;

    // Check that the move is in an executable state
    const execution = move.execution as string;
    if (execution === 'running') {
      return c.json({ error: 'Move is already executing' }, 409);
    }
    if (execution === 'finished') {
      return c.json({ error: 'Move has already finished' }, 409);
    }

    // 2. Check for an active attempt
    const [activeAttempt] = await sql`
      SELECT id FROM attempts WHERE move_id = ${moveId} AND state IN ('running', 'starting', 'queued')
      LIMIT 1
    `;
    if (activeAttempt) {
      return c.json({
        error: 'Move already has an active attempt',
        attempt_id: activeAttempt.id,
      }, 409);
    }

    // 3. Compile execution plan
    const moveInput: MoveInput = {
      id: moveId,
      class: move.class as string,
      title: move.title as string,
      priority: move.priority as string,
      risk: move.risk as string,
      required_capabilities: (move.required_capabilities ?? []) as string[],
      execution_policy: (move.execution_policy ?? {}) as Record<string, unknown>,
      dependencies: (move.dependencies ?? []) as string[],
      deadline: move.deadline as string | undefined,
      constraints: (move.constraints ?? []) as unknown[],
    };

    // Probe device capabilities (from edge_connections)
    const capabilities: CapabilitySet = await probeDeviceCapabilities(sql, user);

    const plan = compiler.compile(moveInput, capabilities);

    // 4. Create attempt record with the plan
    const attemptId = crypto.randomUUID();
    await sql`
      INSERT INTO attempts (
        id, case_id, move_id, executor_id, strategy, state, model, effort,
        claude_job_id, execution_plan, created_at, revision
      ) VALUES (
        ${attemptId}, ${caseId}, ${moveId}, ${plan.executor},
        ${plan.strategy}, 'queued', ${plan.model_hint ?? null}, ${plan.effort_policy},
        NULL, ${sql.json(plan as any)}, NOW(), 1
      )
    `;

    // 5. Find a connected device and dispatch via Edge WSS
    const device = await findConnectedDevice(sql, user);

    if (device && plan.executor === 'claude_code') {
      // Build context capsule for the dispatcher
      const contextCapsule = buildContextCapsule(move, plan);

      // Dispatch StartMove command via Edge WSS
      // The realtime server relays this to the connected device's WebSocket
      await sql`
        INSERT INTO events (
          id, tenant_id, case_id, type, actor_id, occurred_at, recorded_at,
          causation_id, correlation_id, case_sequence, data
        ) VALUES (
          ${crypto.randomUUID()},
          ${move.organization_id as string},
          ${caseId},
          'ExecutionDispatched',
          ${user.user_id},
          NOW(), NOW(),
          ${attemptId}, ${attemptId}, 0,
          ${sql.json({
            attempt_id: attemptId,
            move_id: moveId,
            device_id: device.device_id,
            strategy: plan.strategy,
            model: plan.model_hint,
            plan,
          })}
        )
      `;

      // Queue a start_move command for the device
      await sql`
        INSERT INTO edge_commands (
          id, device_id, type, payload, status, created_at
        ) VALUES (
          ${crypto.randomUUID()},
          ${device.device_id as string},
          'start_move',
          ${sql.json({
            caseId,
            moveId,
            executionPlan: plan,
            contextCapsule,
          })},
          'pending',
          NOW()
        )
      `.catch(() => {
        // edge_commands table may not exist yet — fall back to event-only dispatch
      });

      // Update attempt to starting
      await sql`UPDATE attempts SET state = 'starting', started_at = NOW() WHERE id = ${attemptId}`;

      return c.json({
        status: 'dispatched',
        attempt_id: attemptId,
        plan,
        device_id: device.device_id,
      }, 201);
    }

    if (plan.executor === 'human') {
      // Human executor — create attention item
      await sql`UPDATE attempts SET state = 'queued' WHERE id = ${attemptId}`;

      return c.json({
        status: 'queued_for_human',
        attempt_id: attemptId,
        plan,
      }, 201);
    }

    // No device connected or non-claude executor
    return c.json({
      status: 'queued',
      attempt_id: attemptId,
      plan,
      message: plan.executor === 'claude_code'
        ? 'No device connected — attempt queued for when a device comes online'
        : `Executor type ${plan.executor} does not require a device`,
    }, 201);
  });

  // ── GET /moves/:id/execution ──────────────────────────────────
  // Get current execution status for a move
  app.get('/moves/:id/execution', async (c) => {
    const moveId = c.req.param('id');

    const [move] = await sql`SELECT id, execution, case_id FROM moves WHERE id = ${moveId}`;
    if (!move) return c.json({ error: 'Move not found' }, 404);

    // Get all attempts for this move (newest first)
    const attempts = await sql`
      SELECT id, state, strategy, model, effort,
             claude_job_id, working_directory, worktree_path, model_used,
             execution_plan, started_at, ended_at, failure_reason,
             created_at, revision
      FROM attempts
      WHERE move_id = ${moveId}
      ORDER BY created_at DESC
    `;

    const current = attempts.find(
      (a: any) => ['running', 'starting', 'queued'].includes(a.state),
    );

    // If there is a plan, extract the WHY explanation
    const currentPlan = current?.execution_plan as ExecutionPlan | null;

    return c.json({
      move_id: moveId,
      execution_state: move.execution,
      current_attempt: current ? {
        id: current.id,
        state: current.state,
        strategy: current.strategy,
        model: current.model ?? current.model_used,
        effort: current.effort,
        claude_job_id: current.claude_job_id,
        started_at: current.started_at,
        why: currentPlan?.why,
      } : null,
      attempts: attempts.map((a: any) => ({
        id: a.id,
        state: a.state,
        strategy: a.strategy,
        model: a.model ?? a.model_used,
        started_at: a.started_at,
        ended_at: a.ended_at,
        failure_reason: a.failure_reason,
      })),
      total_attempts: attempts.length,
    });
  });

  // ── POST /moves/:id/stop ──────────────────────────────────────
  // Stop execution of a move
  app.post('/moves/:id/stop', async (c) => {
    const moveId = c.req.param('id');
    const user = getUser(c);

    const [move] = await sql`SELECT id, case_id, organization_id FROM moves WHERE id = ${moveId}`;
    if (!move) return c.json({ error: 'Move not found' }, 404);

    // Find active attempt
    const [activeAttempt] = await sql`
      SELECT id, claude_job_id FROM attempts
      WHERE move_id = ${moveId} AND state IN ('running', 'starting', 'queued')
      LIMIT 1
    `;

    if (!activeAttempt) {
      return c.json({ error: 'No active attempt to stop' }, 409);
    }

    // Update attempt state
    await sql`
      UPDATE attempts SET state = 'stopped', ended_at = NOW()
      WHERE id = ${activeAttempt.id}
    `;

    // Dispatch stop command to device
    const device = await findConnectedDevice(sql, user);
    if (device && activeAttempt.claude_job_id) {
      await sql`
        INSERT INTO edge_commands (id, device_id, type, payload, status, created_at)
        VALUES (
          ${crypto.randomUUID()},
          ${device.device_id as string},
          'stop',
          ${sql.json({
            caseId: move.case_id,
            moveId,
            attemptId: activeAttempt.id,
            reason: 'user_requested',
          })},
          'pending',
          NOW()
        )
      `.catch(() => {
        // edge_commands table may not exist yet
      });
    }

    // Record event
    await sql`
      INSERT INTO events (
        id, tenant_id, case_id, type, actor_id, occurred_at, recorded_at,
        causation_id, correlation_id, case_sequence, data
      ) VALUES (
        ${crypto.randomUUID()},
        ${move.organization_id as string},
        ${move.case_id as string},
        'ExecutionStopped',
        ${user.user_id},
        NOW(), NOW(),
        ${activeAttempt.id as string}, ${activeAttempt.id as string}, 0,
        ${sql.json({
          attempt_id: activeAttempt.id,
          move_id: moveId,
          reason: 'user_requested',
        })}
      )
    `;

    return c.json({
      status: 'stopped',
      attempt_id: activeAttempt.id,
    });
  });

  // ── GET /attempts/:id/logs ────────────────────────────────────
  // Get logs for a specific attempt
  app.get('/attempts/:id/logs', async (c) => {
    const attemptId = c.req.param('id');

    const [attempt] = await sql`
      SELECT a.*, m.title AS move_title
      FROM attempts a
      JOIN moves m ON m.id = a.move_id
      WHERE a.id = ${attemptId}
    `;
    if (!attempt) return c.json({ error: 'Attempt not found' }, 404);

    // Get events related to this attempt
    const events = await sql`
      SELECT id, type, occurred_at, data
      FROM events
      WHERE data->>'attempt_id' = ${attemptId}
      ORDER BY occurred_at ASC
      LIMIT 100
    `;

    // Get steering commands for this attempt
    const steering = await sql`
      SELECT id, class, instruction, state, issued_at, delivered_at, acknowledged_at, applied_at
      FROM steering_commands
      WHERE attempt_id = ${attemptId}
      ORDER BY issued_at ASC
    `;

    return c.json({
      attempt_id: attemptId,
      move_id: attempt.move_id,
      move_title: attempt.move_title,
      state: attempt.state,
      strategy: attempt.strategy,
      model: attempt.model ?? attempt.model_used,
      claude_job_id: attempt.claude_job_id,
      started_at: attempt.started_at,
      ended_at: attempt.ended_at,
      failure_reason: attempt.failure_reason,
      execution_plan: attempt.execution_plan,
      events: events.map((e: any) => ({
        id: e.id,
        type: e.type,
        occurred_at: e.occurred_at,
        data: e.data,
      })),
      steering: steering.map((s: any) => ({
        id: s.id,
        class: s.class,
        instruction: s.instruction,
        state: s.state,
        issued_at: s.issued_at,
        delivered_at: s.delivered_at,
      })),
    });
  });

  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────

async function probeDeviceCapabilities(sql: Sql, user: { user_id: string }): Promise<CapabilitySet> {
  try {
    const [device] = await sql`
      SELECT d.capabilities FROM devices d
      WHERE d.user_id = ${user.user_id} AND d.status = 'active'
      ORDER BY d.last_seen_at DESC NULLS LAST
      LIMIT 1
    `;
    if (!device?.capabilities) return {};

    const caps = device.capabilities as Record<string, boolean>;
    return {
      agent_team: caps['agent_team'] ?? false,
      dynamic_workflow: caps['dynamic_workflow'] ?? false,
      subagent: caps['subagent'] ?? true, // Most Claude Code installs support subagents
      background_session: caps['background_session'] ?? true,
      worktree: caps['worktree'] ?? true,
      cross_session_messaging: caps['cross_session_messaging'] ?? false,
    };
  } catch {
    return { subagent: true, background_session: true, worktree: true };
  }
}

async function findConnectedDevice(
  sql: Sql,
  user: { user_id: string },
): Promise<{ device_id: string } | null> {
  try {
    const [conn] = await sql`
      SELECT ec.device_id
      FROM edge_connections ec
      JOIN devices d ON d.id = ec.device_id
      WHERE d.user_id = ${user.user_id}
        AND d.status = 'active'
        AND ec.last_heartbeat_at > NOW() - INTERVAL '2 minutes'
      ORDER BY ec.last_heartbeat_at DESC
      LIMIT 1
    `;
    return conn ? { device_id: conn.device_id as string } : null;
  } catch {
    return null;
  }
}

function buildContextCapsule(
  move: Record<string, unknown>,
  plan: ExecutionPlan,
): Record<string, unknown> {
  return {
    title: move.title,
    objective: move.objective,
    instructions: `Execute move: ${move.title}\nClass: ${move.class}\nStrategy: ${plan.strategy}\nModel: ${plan.model_hint ?? 'auto'}`,
    constraints: move.constraints,
    context: JSON.stringify({
      case_id: move.case_id,
      move_id: move.id,
      priority: move.priority,
      risk: move.risk,
      dependencies: move.dependencies,
    }),
  };
}
