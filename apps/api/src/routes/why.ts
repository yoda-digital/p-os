import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';
import { WhyEngine, type WhyQuestionType } from '@pos/why';

type Sql = ReturnType<typeof postgres>;

const VALID_QUESTION_TYPES: WhyQuestionType[] = [
  'blocked', 'not_ready', 'active', 'done', 'failed',
  'this_agent', 'this_model', 'this_task', 'changed', 'requires_me',
];

export function whyRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);
  const engine = new WhyEngine(sql);

  // POST / — WHY query (10 question types + general)
  app.post('/', async (c) => {
    const body = await c.req.json<{
      caseId: string;
      question: string;
      questionType?: string;
      moveId?: string;
      targetId?: string;
      atTime?: string;
    }>();

    const { caseId, question, questionType, moveId, targetId, atTime } = body;

    if (!caseId || !question) {
      return c.json({ error: 'caseId and question are required' }, 400);
    }

    // Validate questionType if provided
    if (questionType && !VALID_QUESTION_TYPES.includes(questionType as WhyQuestionType)) {
      return c.json({
        error: `Invalid questionType. Valid types: ${VALID_QUESTION_TYPES.join(', ')}`,
        valid_types: VALID_QUESTION_TYPES,
      }, 400);
    }

    try {
      const result = await engine.explain({
        caseId,
        question,
        questionType: questionType as WhyQuestionType | undefined,
        targetMoveId: moveId,
        targetId,
        atTime,
      });

      return c.json({
        question: result.question,
        question_type: result.questionType,
        explanation: result.answer,
        causal_chain: result.causalChain.map(node => ({
          id: node.eventId,
          type: node.eventType,
          description: node.summary,
          timestamp: node.occurredAt,
          actor_id: node.actorId,
          caused_by: node.causedBy,
          data: node.data,
        })),
        deterministic: result.deterministic,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to explain';
      if (message.includes('not found')) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // GET /types — list available question types
  app.get('/types', (c) => {
    return c.json({
      types: VALID_QUESTION_TYPES.map(t => ({
        type: t,
        requires_move: !['general'].includes(t),
        description: WHY_TYPE_DESCRIPTIONS[t],
      })),
    });
  });

  return app;
}

const WHY_TYPE_DESCRIPTIONS: Record<WhyQuestionType, string> = {
  blocked: 'Why is this move blocked? Shows unsatisfied dependencies and pending decisions.',
  not_ready: 'Why is this move not ready? Shows preconditions and dependency state.',
  active: 'Why is this move active? Shows activation event and current attempt.',
  done: 'Why is this move done? Shows satisfaction evidence and completion chain.',
  failed: 'Why did this move fail? Shows failed attempts and failure patterns.',
  this_agent: 'Why is this agent assigned? Shows capability matching and assignment history.',
  this_model: 'Why was this model chosen? Shows model routing and attempt history.',
  this_task: 'Why does this task exist? Shows intent decomposition and creation chain.',
  changed: 'Why did this change? Shows event diffs and steering history.',
  requires_me: 'Why does this require me? Shows attention items, decisions, and authority requirements.',
};
