// Context Capsule generator — builds the 11-section markdown Context Capsule from
// canonical DB state (not from transcript summarization).
//
// Canonical structure: docs/superpowers/specs/2026-09-08-sp1-claude-integration-core.md §7
// and docs/specs_design.md §102-103.

import type postgres from 'postgres';
import type { ContextCapsule } from './index.js';

type Sql = ReturnType<typeof postgres>;

const GENERATOR_VERSION = '1.0.0';
const DELTA_EVENT_LIMIT = 40;
const FALLBACK_DELTA_EVENT_LIMIT = 15;

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const ACTIVE_EXECUTION_STATES = [
  'queued',
  'starting',
  'running',
  'pausing',
  'paused',
  'suspended',
  'finishing',
];
const TERMINAL_ATTEMPT_FAILURE_STATES = ['failed', 'timed_out', 'lost'];
const OPEN_ATTEMPT_STATES = ['pending', 'starting', 'running', 'paused'];
const OPEN_DECISION_STATES = ['draft', 'requested', 'in_review', 'deferred'];
const CLOSED_RULE_STATUSES = ['satisfied', 'not_applicable', 'waived'];
const CONSTRAINT_STEERING_CLASSES = ['constraint', 'hard_stop', 'pause'];
const VERIFIED_MODALITIES = new Set(['verified', 'observed', 'authoritative']);

/** Renders a `{id, type}` semantic ref as a short human-readable label using resolved title maps. */
function formatRef(
  ref: { id?: string; type?: string } | null | undefined,
  titlesByType: Record<string, Map<string, string>>,
): string {
  if (!ref?.id) return 'unknown';
  const title = titlesByType[ref.type ?? '']?.get(ref.id);
  if (title) return `"${title}"`;
  return `${ref.type ?? 'ref'}:${ref.id.slice(0, 8)}`;
}

function byPriority(a: { priority?: string }, b: { priority?: string }): number {
  return (PRIORITY_RANK[a.priority ?? ''] ?? 9) - (PRIORITY_RANK[b.priority ?? ''] ?? 9);
}

/** Summarizes an intent/move completion contract JSONB blob into one readable line. */
function summarizeContract(contract: unknown): string {
  if (!contract || typeof contract !== 'object') return 'none specified';
  const c = contract as { description?: string; predicates?: Array<{ description?: string }> };
  if (c.description) return c.description;
  if (c.predicates?.length) {
    return c.predicates.map((p) => p.description).filter(Boolean).join('; ');
  }
  return 'none specified';
}

/** Best-effort one-line summary of an event's JSONB data payload, for the DELTA section. */
function summarizeEventData(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  return Object.entries(data as Record<string, unknown>)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

export async function generateCapsule(
  sql: Sql,
  caseId: string,
  moveId?: string,
  lastEventAck?: number,
): Promise<ContextCapsule> {
  const [caseRow] = await sql`
    SELECT c.*, o.name AS organization_name
    FROM cases c
    LEFT JOIN organizations o ON o.id = c.organization_id
    WHERE c.id = ${caseId}
  `;
  if (!caseRow) throw new Error(`Case ${caseId} not found`);

  const move = moveId
    ? (await sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`)[0]
    : undefined;

  const [
    intents,
    entities,
    relations,
    assertions,
    decisionRows,
    ruleRows,
    allMoves,
    allAttempts,
    evidenceRows,
    steeringCommands,
    actors,
    deltaEvents,
  ] = await Promise.all([
    sql`SELECT * FROM intents WHERE case_id = ${caseId} AND status = 'active'`,
    sql`SELECT * FROM entities WHERE case_id = ${caseId} ORDER BY created_at DESC LIMIT 12`,
    sql`SELECT * FROM relations WHERE case_id = ${caseId} ORDER BY created_at DESC LIMIT 15`,
    sql`SELECT * FROM assertions WHERE case_id = ${caseId} AND status = 'active' ORDER BY confidence DESC LIMIT 20`,
    sql`SELECT * FROM decisions WHERE case_id = ${caseId} ORDER BY created_at DESC LIMIT 50`,
    sql`SELECT * FROM rules WHERE case_id = ${caseId} ORDER BY created_at DESC LIMIT 50`,
    sql`SELECT * FROM moves WHERE case_id = ${caseId} ORDER BY created_at DESC LIMIT 200`,
    sql`
      SELECT a.*, m.title AS move_title FROM attempts a
      JOIN moves m ON m.id = a.move_id
      WHERE a.case_id = ${caseId} ORDER BY a.created_at DESC LIMIT 50
    `,
    sql`SELECT * FROM evidence WHERE case_id = ${caseId} ORDER BY observed_at DESC NULLS LAST LIMIT 20`,
    sql`SELECT * FROM steering_commands WHERE case_id = ${caseId} ORDER BY issued_at DESC LIMIT 20`,
    sql`SELECT id, display_name FROM actors WHERE organization_id = ${caseRow.organization_id} LIMIT 200`,
    lastEventAck != null
      ? sql`
          SELECT * FROM events WHERE case_id = ${caseId} AND case_sequence > ${lastEventAck}
          ORDER BY case_sequence ASC LIMIT ${DELTA_EVENT_LIMIT}
        `
      : sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          ORDER BY case_sequence DESC LIMIT ${FALLBACK_DELTA_EVENT_LIMIT}
        `,
  ]);

  // Policy restrictions live in a separate (RBAC) migration — degrade gracefully rather
  // than fail capsule generation if that schema isn't present in a given environment.
  let denyPolicies: Array<{ name: string; description: string | null }> = [];
  try {
    denyPolicies = await sql`
      SELECT name, description FROM policies
      WHERE organization_id = ${caseRow.organization_id} AND active = true AND effect = 'deny'
      LIMIT 20
    `;
  } catch {
    denyPolicies = [];
  }

  // --- lookup maps for rendering semantic refs as readable titles ---------
  const entityTitles = new Map(entities.map((e) => [e.id as string, e.title as string]));
  const moveTitlesMap = new Map(allMoves.map((m) => [m.id as string, m.title as string]));
  const actorTitles = new Map(actors.map((a) => [a.id as string, a.display_name as string]));
  const titlesByType: Record<string, Map<string, string>> = {
    entity: entityTitles,
    move: moveTitlesMap,
    actor: actorTitles,
  };
  const actorName = (id: string) => actorTitles.get(id) ?? id.slice(0, 8);

  // --- derived groupings ----------------------------------------------------
  const completedMoves = allMoves.filter((m) => m.outcome === 'satisfied');
  const activeMoves = allMoves.filter((m) => ACTIVE_EXECUTION_STATES.includes(m.execution));
  const cancelledOrSupersededMoves = allMoves.filter((m) =>
    ['cancelled', 'superseded'].includes(m.outcome),
  );
  const moveDependencies: string[] = move ? (move.dependencies ?? []) : [];
  const blockerMoves = move
    ? allMoves.filter((m) => moveDependencies.includes(m.id) && m.outcome !== 'satisfied')
    : [];
  const downstreamMoves = move
    ? allMoves.filter((m) => (m.dependencies ?? []).includes(move.id))
    : [];
  const activeAttempt = move
    ? allAttempts.find((a) => a.move_id === move.id && OPEN_ATTEMPT_STATES.includes(a.state))
    : undefined;
  const failedAttempts = allAttempts.filter((a) => TERMINAL_ATTEMPT_FAILURE_STATES.includes(a.state));

  const pendingDecisions = decisionRows.filter((d) => OPEN_DECISION_STATES.includes(d.state));
  const resolvedDecisions = decisionRows
    .filter((d) => d.state === 'decided')
    .sort((a, b) => new Date(b.decided_at ?? 0).getTime() - new Date(a.decided_at ?? 0).getTime())
    .slice(0, 5);
  const supersededDecisions = decisionRows.filter((d) => d.state === 'superseded');

  const activeRules = ruleRows.filter((r) => !CLOSED_RULE_STATUSES.includes(r.evaluation_status));
  const activeSteering = steeringCommands.filter(
    (s) => CONSTRAINT_STEERING_CLASSES.includes(s.class) && s.state !== 'applied',
  );

  const verifiedAssertions = assertions.filter((a) => VERIFIED_MODALITIES.has(a.modality));
  const uncertainAssertions = assertions.filter((a) => !VERIFIED_MODALITIES.has(a.modality));

  // === 1. IDENTITY ============================================================
  const ownerIds: string[] = caseRow.owner_actor_ids ?? [];
  const identity = [
    `Case: ${caseRow.id} — "${caseRow.title}" (${caseRow.lifecycle})`,
    move ? `Move: ${move.id} — "${move.title}" [${move.class}]` : 'Move: none bound',
    activeAttempt ? `Attempt: ${activeAttempt.id} (${activeAttempt.state})` : 'Attempt: none active',
    `Organization: ${caseRow.organization_name ?? caseRow.organization_id}`,
    `Owners: ${ownerIds.map(actorName).join(', ') || 'unassigned'}`,
  ].join('\n');

  // === 2. INTENT ===============================================================
  const intentLines = [...intents]
    .sort(byPriority)
    .map(
      (i) =>
        `[${i.class}] ${i.statement} (${i.priority}, ${i.status}) — success: ${summarizeContract(i.success_contract)}`,
    );
  const intent = intentLines.join('\n') || 'No active intents.';

  // === 3. REALITY ==============================================================
  const entityLines = entities.map((e) => `"${e.title}" [${e.type}]`);
  const relationLines = relations.map(
    (r) =>
      `${formatRef(r.source_ref, titlesByType)} --[${r.type}${r.qualifier ? `/${r.qualifier}` : ''}]--> ${formatRef(r.target_ref, titlesByType)}`,
  );
  const verifiedLines = verifiedAssertions.map(
    (a) => `${formatRef(a.subject_ref, titlesByType)} ${a.predicate} = ${JSON.stringify(a.value)} [${a.modality}]`,
  );
  const uncertainLines = uncertainAssertions.map(
    (a) =>
      `${formatRef(a.subject_ref, titlesByType)} ${a.predicate} = ${JSON.stringify(a.value)} (${a.modality}, confidence ${a.confidence})`,
  );
  const reality = [
    `Entities: ${entityLines.join(', ') || 'none tracked'}`,
    `Known relations:\n${relationLines.join('\n') || 'none.'}`,
    `Verified facts:\n${verifiedLines.join('\n') || 'none.'}`,
    `Uncertainty:\n${uncertainLines.join('\n') || 'none flagged.'}`,
  ].join('\n');

  // === 4. DECISIONS =============================================================
  const decisionsText =
    [
      ...pendingDecisions.map((d) => `PENDING [${d.state}]: ${d.question}`),
      ...resolvedDecisions.map(
        (d) =>
          `DECIDED: ${d.question} → ${JSON.stringify(d.selected_option)}${d.rationale ? ` (${d.rationale})` : ''}`,
      ),
    ].join('\n') || 'No applicable decisions.';

  // === 5. CONSTRAINTS ===========================================================
  const constraintsText =
    [
      ...activeRules.map((r) => `[${r.type}] ${r.statement} — ${r.evaluation_status}`),
      ...activeSteering.map(
        (s) =>
          `STEERING [${s.class}] on ${formatRef({ id: s.move_id, type: 'move' }, titlesByType)}: ${s.instruction} (${s.state})`,
      ),
      ...denyPolicies.map((p) => `POLICY (deny) "${p.name}"${p.description ? `: ${p.description}` : ''}`),
    ].join('\n') || 'No active constraints.';

  // === 6. PROGRESS ==============================================================
  const activeMoveLines = activeMoves.map((m) => {
    const assigned: string[] = (m.assigned_actor_ids ?? []).map(actorName);
    return `"${m.title}" [readiness=${m.readiness}, execution=${m.execution}, attention=${m.attention}]${assigned.length ? ` — assigned: ${assigned.join(', ')}` : ''}`;
  });
  const progress = [
    `Completed (${completedMoves.length}): ${completedMoves.map((m) => `"${m.title}"`).join(', ') || 'none yet'}`,
    `Active (${activeMoves.length}): ${activeMoveLines.join('; ') || 'none'}`,
    `Failed approaches (${failedAttempts.length}): ${
      failedAttempts.map((a) => `"${a.move_title}" via ${a.strategy} — ${a.failure_reason ?? a.state}`).join('; ') ||
      'none'
    }`,
  ].join('\n');

  // === 7. DEPENDENCIES ==========================================================
  const dependenciesText = !move
    ? 'No move bound — dependency scope unavailable.'
    : [
        `Blockers: ${blockerMoves.map((m) => `"${m.title}" (${m.outcome})`).join(', ') || 'none'}`,
        `Downstream: ${downstreamMoves.map((m) => `"${m.title}" (${m.outcome})`).join(', ') || 'none'}`,
      ].join('\n');

  // === 8. EVIDENCE ==============================================================
  const evidenceText =
    evidenceRows
      .map((e) => {
        const refs = (e.subject_refs ?? []).map((r: { id?: string; type?: string }) => formatRef(r, titlesByType));
        return `[${e.validity}] ${e.relation} ${refs.join(', ')} (confidence ${e.confidence})`;
      })
      .join('\n') || 'No evidence recorded.';

  // === 9. DELTA =================================================================
  const deltaHeader =
    lastEventAck != null ? `Since event #${lastEventAck}:` : 'Recent activity (no session anchor provided):';
  const deltaLines = deltaEvents.map((e) => {
    const summary = summarizeEventData(e.data);
    return `#${e.case_sequence ?? '?'} ${e.type} @ ${e.occurred_at}${summary ? ` — ${summary}` : ''}`;
  });
  const deltaText = `${deltaHeader}\n${deltaLines.join('\n') || 'No changes.'}`;

  // === 10. NEXT =================================================================
  const nextCandidates: string[] = [];
  if (pendingDecisions.length > 0) {
    nextCandidates.push(`Resolve pending decision: "${pendingDecisions[0]?.question}"`);
  }
  if (move) {
    if (move.readiness === 'not_ready') {
      nextCandidates.push(`Unblock "${move.title}" — resolve blockers before it can proceed.`);
    } else if (move.execution === 'not_started') {
      nextCandidates.push(`Start "${move.title}": ${move.objective || move.title}`);
    } else if (ACTIVE_EXECUTION_STATES.includes(move.execution)) {
      nextCandidates.push(`Continue "${move.title}": ${move.objective || move.title}`);
    }
    const failedOnMove = failedAttempts.filter((a) => a.move_id === move.id);
    if (failedOnMove.length > 0) {
      nextCandidates.push(
        `Consider an alternate strategy for "${move.title}" — ${failedOnMove.length} prior attempt(s) failed.`,
      );
    }
  } else if (activeMoves.length > 0) {
    nextCandidates.push(`Bind to move in progress: "${activeMoves[0]?.title}"`);
  } else {
    const readyMove = allMoves.find((m) => m.readiness === 'ready' && m.execution === 'not_started');
    nextCandidates.push(
      readyMove ? `Bind to next ready move: "${readyMove.title}"` : 'No immediate action — case at rest.',
    );
  }
  const nextText = nextCandidates.slice(0, 3).join('\n');

  // === 11. DO NOT REPEAT ========================================================
  const doNotRepeatText =
    [
      ...failedAttempts.map(
        (a) => `Failed: "${a.move_title}" via ${a.strategy} — ${a.failure_reason ?? 'unknown reason'}`,
      ),
      ...cancelledOrSupersededMoves.map(
        (m) => `${m.outcome === 'cancelled' ? 'Cancelled' : 'Superseded'}: "${m.title}"`,
      ),
      ...supersededDecisions.map((d) => `Superseded decision: "${d.question}"`),
    ].join('\n') || 'No failed or superseded approaches recorded.';

  // === assemble =================================================================
  const includedObjectRefs = Array.from(
    new Set<string>([
      caseRow.id,
      caseRow.organization_id,
      ...(move ? [move.id] : []),
      ...(activeAttempt ? [activeAttempt.id] : []),
      ...intents.map((i) => i.id as string),
      ...entities.map((e) => e.id as string),
      ...relations.map((r) => r.id as string),
      ...assertions.map((a) => a.id as string),
      ...decisionRows.map((d) => d.id as string),
      ...ruleRows.map((r) => r.id as string),
      ...allMoves.map((m) => m.id as string),
      ...allAttempts.map((a) => a.id as string),
      ...evidenceRows.map((e) => e.id as string),
      ...steeringCommands.map((s) => s.id as string),
    ]),
  );

  const capsule: ContextCapsule = {
    capsuleId: crypto.randomUUID(),
    caseId,
    caseRevision: Number(caseRow.revision),
    moveId: move?.id,
    moveRevision: move ? Number(move.revision) : undefined,
    attemptId: activeAttempt?.id,
    generatedAt: new Date().toISOString(),
    generatorVersion: GENERATOR_VERSION,
    sections: {
      identity,
      intent,
      reality,
      decisions: decisionsText,
      constraints: constraintsText,
      progress,
      dependencies: dependenciesText,
      evidence: evidenceText,
      delta: deltaText,
      next: nextText,
      doNotRepeat: doNotRepeatText,
    },
    includedObjectRefs,
    tokenEstimate: 0,
  };

  const fullText = Object.values(capsule.sections).join('\n');
  capsule.tokenEstimate = Math.ceil(fullText.length / 4);

  await sql`
    INSERT INTO context_capsules (
      id, case_id, case_revision, move_id, move_revision, attempt_id,
      generated_at, generator_version, sections, included_object_refs, token_estimate
    )
    VALUES (
      ${capsule.capsuleId}, ${caseId}, ${capsule.caseRevision}, ${capsule.moveId ?? null},
      ${capsule.moveRevision ?? null}, ${capsule.attemptId ?? null}, ${capsule.generatedAt},
      ${capsule.generatorVersion}, ${JSON.stringify(capsule.sections)},
      ${JSON.stringify(capsule.includedObjectRefs)}, ${capsule.tokenEstimate}
    )
  `;

  return capsule;
}
