#!/usr/bin/env node
/**
 * Process MCP server (spec section 3) — the 12 `process.*` tools exposed to
 * Claude over stdio. Started by Claude's MCP runtime from `.mcp.json`.
 *
 * Every tool reads local SQLite state first and falls back to the control
 * plane over HTTP (`CONTROL_PLANE_URL`) on a cache miss; writes enqueue to
 * the local outbox before attempting a direct HTTP call, so nothing is lost
 * while offline. Authentication is the paired device identity — no
 * per-request tokens (spec section 3.2).
 *
 * Tool descriptions are kept short and mutually distinctive so Claude's MCP
 * tool search can defer/select among them efficiently (spec section 38).
 */
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

import { caseGetInputShape, handleCaseGet } from './tools/case-get.js';
import { caseSearchInputShape, handleCaseSearch } from './tools/case-search.js';
import { moveGetInputShape, handleMoveGet } from './tools/move-get.js';
import { moveListInputShape, handleMoveList } from './tools/move-list.js';
import { movePropseInputShape, handleMovePropose } from './tools/move-propose.js';
import { moveBindTaskInputShape, handleMoveBindTask } from './tools/move-bind-task.js';
import { evidenceRegisterInputShape, handleEvidenceRegister } from './tools/evidence-register.js';
import { assertionProposeInputShape, handleAssertionPropose } from './tools/assertion-propose.js';
import { decisionRequestInputShape, handleDecisionRequest } from './tools/decision-request.js';
import { contextGetInputShape, handleContextGet } from './tools/context-get.js';
import { whyExplainInputShape, handleWhyExplain } from './tools/why-explain.js';
import { steeringAckInputShape, handleSteeringAck } from './tools/steering-ack.js';

const SERVER_NAME = 'process-os';
const SERVER_VERSION = '0.1.0';

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** Build the Process MCP server and register all 12 `process.*` tools. */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  server.registerTool(
    'process.case.get',
    {
      title: 'Get current Case',
      description:
        'Get the Case bound to this session: id, title, lifecycle, intent, and active Moves. ' +
        'Use for "what am I working on" / "show current case".',
      inputSchema: caseGetInputShape,
      annotations: READ_ONLY,
    },
    async (args) => handleCaseGet(args),
  );

  server.registerTool(
    'process.case.search',
    {
      title: 'Search Cases',
      description:
        'Search Cases across the organization by title, type, or lifecycle state. ' +
        'Use to find or disambiguate a Case, not to inspect the current one.',
      inputSchema: caseSearchInputShape,
      annotations: READ_ONLY,
    },
    async (args) => handleCaseSearch(args),
  );

  server.registerTool(
    'process.move.get',
    {
      title: 'Get Move details',
      description:
        'Get one Move by id: its state vector, dependencies, and attached evidence. Requires move_id.',
      inputSchema: moveGetInputShape,
      annotations: READ_ONLY,
    },
    async (args) => handleMoveGet(args),
  );

  server.registerTool(
    'process.move.list',
    {
      title: 'List Moves',
      description:
        'List Moves for a Case with their current state. Use to see what work exists/remains on a Case.',
      inputSchema: moveListInputShape,
      annotations: READ_ONLY,
    },
    async (args) => handleMoveList(args),
  );

  server.registerTool(
    'process.move.propose',
    {
      title: 'Propose a Move',
      description:
        'Propose a new Move (unit of work) on the current Case. Use when new work is identified ' +
        'that is not yet tracked as a Move.',
      inputSchema: movePropseInputShape,
      annotations: WRITE,
    },
    async (args) => handleMovePropose(args),
  );

  server.registerTool(
    'process.move.bind_task',
    {
      title: 'Bind task to an Attempt',
      description:
        "Map Claude's native task to an Attempt on a Move, starting that Attempt. " +
        'Use right after creating a native task that works toward a specific Move.',
      inputSchema: moveBindTaskInputShape,
      annotations: WRITE,
    },
    async (args) => handleMoveBindTask(args),
  );

  server.registerTool(
    'process.evidence.register',
    {
      title: 'Register Evidence',
      description:
        'Register Evidence (test pass, commit, review, artifact) supporting a Case/Move/Attempt. ' +
        'Use after producing verifiable proof of progress.',
      inputSchema: evidenceRegisterInputShape,
      annotations: WRITE,
    },
    async (args) => handleEvidenceRegister(args),
  );

  server.registerTool(
    'process.assertion.propose',
    {
      title: 'Propose an Assertion',
      description:
        'Propose a factual assertion (subject/predicate/object) about an entity in the current Case. ' +
        'Use to record a claim distinct from Evidence or a completed Move.',
      inputSchema: assertionProposeInputShape,
      annotations: WRITE,
    },
    async (args) => handleAssertionPropose(args),
  );

  server.registerTool(
    'process.decision.request',
    {
      title: 'Request a human Decision',
      description:
        'Request a human decision on an open question blocking or affecting the current Case/Move. ' +
        'Use when you cannot proceed without a judgment call only a human can make.',
      inputSchema: decisionRequestInputShape,
      annotations: WRITE,
    },
    async (args) => handleDecisionRequest(args),
  );

  server.registerTool(
    'process.context.get',
    {
      title: 'Get Context Capsule',
      description:
        'Get the full 11-section Context Capsule (identity, intent, reality, constraints, progress, ' +
        'dependencies, evidence, delta, next, do-not-repeat) for the current Case.',
      inputSchema: contextGetInputShape,
      annotations: READ_ONLY,
    },
    async (args) => handleContextGet(args),
  );

  server.registerTool(
    'process.why.explain',
    {
      title: 'Explain WHY',
      description:
        'Explain WHY a piece of process state exists — the causal chain of events/decisions/rules ' +
        'behind a Case, Move, Decision, Assertion, or Rule. Requires a ref id.',
      inputSchema: whyExplainInputShape,
      annotations: READ_ONLY,
    },
    async (args) => handleWhyExplain(args),
  );

  server.registerTool(
    'process.steering.ack',
    {
      title: 'Acknowledge Steering',
      description:
        'Acknowledge that a steering command (pause/redirect/guidance) delivered into this session ' +
        'has been received and acted upon. Requires steering_id.',
      inputSchema: steeringAckInputShape,
      annotations: WRITE,
    },
    async (args) => handleSteeringAck(args),
  );

  return server;
}

/** Connect the server to stdio and start listening. */
export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // The stdio transport owns stdout — log failures to stderr only.
    console.error('[process-os mcp] fatal error:', err);
    process.exit(1);
  });
}
