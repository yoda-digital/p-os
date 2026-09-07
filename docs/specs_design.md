# Universal Process OS
## Technical Specification & System Design

**Status:** Canonical Technical Specification  
**Depends on:** `vision.md`, `blueprint.md`  
**Next document:** `implementation_plan.md`  
**Validation baseline:** 7 September 2026  
**Claude Code baseline tested/design-targeted against:** v2.1.263  
**Minimum intended Claude Code compatibility:** v2.1.251+, subject to capability probing  
**Current MCP reference revision:** `2026-07-28`  
**Primary control plane:** `ai-kanban.yoda.digital`

---

# 0. Purpose

This document converts the architectural blueprint into an implementable technical contract.

It defines:

- canonical process data;
- object identity and versioning;
- event and command protocols;
- state derivation;
- concurrency semantics;
- Kanban behavior;
- steering semantics;
- evidence and completion semantics;
- policy and authority enforcement;
- execution scheduling;
- Claude Code integration;
- context/session lifecycle orchestration;
- local edge behavior;
- offline synchronization;
- realtime behavior;
- security boundaries;
- process/domain extension mechanisms;
- storage requirements;
- observability;
- compatibility and fallback rules;
- non-functional requirements;
- adversarial acceptance cases.

Where this document says **MUST**, violating the requirement is an architectural defect.

Where it says **SHOULD**, deviations require an explicit rationale.

Where it says **MAY**, the capability is optional.

---

# 1. Validation Baseline

The design is intentionally aligned with the newest relevant Claude Code capabilities rather than treating Claude Code as the simpler runtime it was historically.

At the current baseline, Claude Code plugins can ship skills, agents, hooks, MCP servers, LSP servers, workflows, background monitors, settings and executables. Plugin manifests also support user configuration, dependencies, and Channel declarations. Marketplace-installed plugins can have eligible Node dependencies automatically installed into Claude's plugin cache.

The hook system currently exposes lifecycle events including:

```text
SessionStart
Setup
InstructionsLoaded
UserPromptSubmit
UserPromptExpansion

PreToolUse
PermissionRequest
PermissionDenied
PostToolUse
PostToolUseFailure
PostToolBatch

MessageDisplay

SubagentStart
SubagentStop

TaskCreated
TaskCompleted
TeammateIdle

ConfigChange
CwdChanged
DirectoryAdded
FileChanged

WorktreeCreate
WorktreeRemove

PreCompact
PostCompact

PreModelSwitch
PostModelSwitch

Elicitation
ElicitationResult

Stop
StopFailure
SessionEnd
```

Hook handlers may be command, HTTP, MCP-tool, prompt, or agent-based where the event supports them.

Claude's current background-agent system already includes a supervisor daemon, `claude --bg`, machine-readable session listing, attach/log/stop/respawn operations, restart behavior, and persistence of background jobs. Universal Process OS MUST therefore reuse the native supervisor instead of implementing a second Claude process supervisor.

Claude's v2 MCP runtime supports MCP revision `2026-07-28`. That MCP revision changed the core protocol toward stateless request/response semantics, introduced formal extensions, strengthened authorization, and uses JSON Schema 2020-12 for modern tool schemas.

Channels remain research preview and currently cannot register when their MCP server negotiates protocol revision `2026-07-28`. The architecture therefore MUST treat Channel transport as separate from the main production Process MCP transport.

These are design constraints, not trivia.

---

# 2. Architectural Layers

The system SHALL consist of the following logical layers:

```text
┌──────────────────────────────────────────────────────┐
│ EXPERIENCE                                           │
│                                                      │
│ Kanban · Attention · Graph · Timeline · Evidence    │
│ Decisions · Compliance · Search · WHY · Analytics   │
└──────────────────────┬───────────────────────────────┘
                       │ semantic commands
                       ▼
┌──────────────────────────────────────────────────────┐
│ UNIVERSAL CASE RUNTIME                               │
│                                                      │
│ Event Ledger · Semantic Model · Controllers         │
│ Policies · Projections · Context Intelligence       │
└──────────────────────┬───────────────────────────────┘
                       │ execution commands
                       ▼
┌──────────────────────────────────────────────────────┐
│ EXECUTION ORCHESTRATION                              │
│                                                      │
│ Execution Compiler · Scheduler · Executor Registry  │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│ EXECUTION EDGES                                      │
│                                                      │
│ Claude · Human · API · CI · future agent runtimes   │
└──────────────────────┬───────────────────────────────┘
                       │ events / evidence
                       ▼
                 UNIVERSAL CASE RUNTIME
```

There MUST NOT be a code path by which an executor directly writes canonical process state.

Executors produce:

```text
Events
Evidence
Proposals
Attempt state
```

The Case Runtime determines canonical derived state.

---

# 3. Identity Model

All canonical objects MUST have globally unique immutable identifiers.

Preferred representation:

```text
UUIDv7
```

because IDs remain globally unique while preserving useful temporal locality.

Canonical IDs include:

```text
organization_id
workspace_id
project_id
case_id
entity_id
relation_id
assertion_id
intent_id
rule_id
actor_id
resource_id
move_id
attempt_id
evidence_id
decision_id
event_id
command_id
device_id
executor_id
session_binding_id
```

Human-readable keys MAY coexist:

```text
TENDER-42
AUTH-17
INC-2026-018
```

but MUST NOT be canonical primary identifiers.

Human-readable keys MAY change.

UUIDs MUST NOT.

---

# 4. Versioning Model

Every mutable aggregate MUST expose:

```text
revision: uint64
```

Revision starts at:

```text
0
```

and increments for every accepted semantic mutation affecting that aggregate.

Commands that modify existing canonical state SHOULD carry:

```text
expected_revision
```

Example:

```json
{
  "command_id": "019...",
  "type": "Move.ChangePriority",
  "target_id": "019...",
  "expected_revision": 17,
  "payload": {
    "priority": "critical"
  }
}
```

If current revision is:

```text
18
```

the server MUST reject the mutation as:

```text
REVISION_CONFLICT
```

unless the command explicitly invokes an authorized force/merge operation.

Silent last-write-wins MUST NOT be used for canonical semantic mutations.

---

# 5. Time Model

The system MUST distinguish:

```text
occurred_at
recorded_at
effective_from
effective_until
```

where relevant.

`occurred_at`:

> when something happened in the domain or executor.

`recorded_at`:

> when Universal Process OS accepted the event.

`effective_from` / `effective_until`:

> temporal validity of a rule, relation, assertion, authority grant, etc.

Clock skew MUST NOT cause events to be discarded.

Ordering MUST therefore use a combination of:

```text
per-case sequence
causation graph
recorded_at
occurred_at
```

rather than trusting wall-clock timestamps alone.

---

# 6. Case

Canonical shape:

```json
{
  "id": "uuid",
  "organization_id": "uuid",
  "workspace_id": "uuid",
  "type": "core.case",
  "title": "Prepare UNDP tender",
  "description": "...",

  "lifecycle": "open",

  "primary_intent_ids": [],
  "owner_actor_ids": [],

  "pack_refs": [],
  "project_refs": [],

  "created_at": "...",
  "created_by": "...",

  "revision": 42
}
```

`lifecycle` MUST remain deliberately coarse:

```text
open
dormant
closed
archived
void
```

Detailed process status MUST NOT be encoded here.

The Case's operational condition is derived through projections.

---

# 7. Entity

Entity is the generic representation of something relevant to a Case.

Canonical shape:

```json
{
  "id": "uuid",
  "case_id": "uuid",

  "type": "procurement.requirement",
  "schema_version": "1.0.0",

  "label": "Provide three references",

  "attributes": {},

  "created_by": "actor-id",
  "created_at": "...",

  "revision": 4
}
```

Examples:

```text
software.repository
software.release
procurement.requirement
procurement.clarification
journalism.source
journalism.document
research.hypothesis
sales.account
logistics.shipment
legal.filing
```

The kernel MUST NOT hard-code every domain entity type.

---

# 8. Semantic Type Registry

Entity, Relation, Assertion, Move, Rule and Evidence types SHALL be namespaced:

```text
core.*
software.*
procurement.*
journalism.*
research.*
legal.*
org.example.custom.*
```

Every registered type MUST provide:

```text
type_id
semantic_class
schema_version
JSON Schema
traits[]
display metadata
migration metadata
```

Custom schema definitions SHOULD use JSON Schema 2020-12, which remains the current JSON Schema specification and also aligns with the modern MCP tool-schema direction.

Types SHOULD prefer composable traits over deep inheritance.

Example:

```text
procurement.requirement

traits:
  - evidence_requirable
  - versioned_external_rule
  - deadline_sensitive
```

---

# 9. Relation

Canonical:

```json
{
  "id": "uuid",
  "case_id": "uuid",

  "type": "core.depends_on",

  "source_id": "uuid",
  "target_id": "uuid",

  "qualifier": null,

  "confidence": 1.0,

  "effective_from": "...",
  "effective_until": null,

  "provenance": {},

  "revision": 1
}
```

Relations MAY connect arbitrary semantic objects, not only Entities.

Examples:

```text
DEPENDS_ON
BLOCKS
REQUIRES
PRODUCES
SUPPORTS
CONTRADICTS
SUPERSEDES
IMPLEMENTS
REPRESENTS
AUTHORIZES
OWNS
CONTAINS
AFFECTS
INVALIDATES
```

This deliberately adopts the object-centric insight that events and process state may involve multiple objects and relationships rather than belonging to one artificial "case row." OCEL's object-centric model strongly validates this direction.

---

# 10. Assertion

Assertion represents a statement about reality.

```json
{
  "id": "uuid",
  "case_id": "uuid",

  "type": "core.claim",

  "subject_ref": "uuid",
  "predicate": "delivery_days",
  "value": 30,

  "modality": "claimed",

  "source_refs": [],
  "evidence_refs": [],

  "confidence": 0.72,

  "effective_from": "...",
  "effective_until": null,

  "status": "active",

  "revision": 2
}
```

`modality` SHOULD support at least:

```text
observed
claimed
believed
hypothesized
inferred
evaluated
verified
presumed
disputed
authoritative
```

The system MUST NOT automatically convert:

```text
claimed → verified
```

based solely on an LLM's confidence.

---

# 11. Contradiction

Contradiction MUST be modeled explicitly.

Example:

```text
Assertion A:
deadline = 12 Sep

Assertion B:
deadline = 13 Sep
```

Runtime MAY derive:

```text
Contradiction C
```

with:

```text
status = unresolved
```

Resolution MAY result in:

```text
A superseded
B verified
```

but history MUST retain both.

---

# 12. Retraction

A retraction MUST NOT erase the original assertion.

```text
Assertion C1
    ↓
Retraction R1
```

The assertion remains historically queryable and becomes:

```text
status = retracted
```

This is mandatory for:

```text
journalism
legal
research
negotiation
audit
```

and useful elsewhere.

---

# 13. Evidence

Canonical:

```json
{
  "id": "uuid",
  "case_id": "uuid",

  "type": "core.evidence",

  "subject_refs": [],
  "relation": "supports",

  "artifact_ref": null,
  "source_ref": null,

  "scope": {},
  "provenance": {},

  "observed_at": "...",
  "fresh_until": null,

  "confidence": 1.0,

  "validity": "valid",

  "revision": 3
}
```

`validity`:

```text
valid
stale
invalid
disputed
unknown
```

Evidence MAY support multiple objects.

Evidence MAY be invalidated without deleting it.

---

# 14. Evidence Scope

Evidence MUST describe what it actually proves.

Example:

```json
{
  "type": "software.test_result",
  "scope": {
    "repository": "repo-id",
    "commit": "abc123",
    "test_suite": "auth-e2e"
  }
}
```

It MUST NOT automatically prove:

```text
auth-e2e passes on HEAD
```

after HEAD changes.

---

# 15. Evidence Invalidation

The Evidence Controller MUST support rules such as:

```text
artifact changed
→ evidence stale

rule superseded
→ compliance evidence needs re-evaluation

source retracted statement
→ derived confidence recalculated

new commit
→ old build/test evidence not current
```

Invalidation MUST propagate causally.

---

# 16. Intent

Canonical:

```json
{
  "id": "uuid",
  "case_id": "uuid",

  "type": "core.intent.achieve",

  "statement": "Submit a compliant proposal before the deadline",

  "priority": 90,

  "owner_refs": [],

  "success_contract": {},
  "stop_contract": {},

  "status": "active",

  "revision": 5
}
```

Intent classes SHOULD include:

```text
ACHIEVE
MAINTAIN
AVOID
LEARN
DECIDE
EXPLORE
NEGOTIATE
CREATE
RECOVER
COMPLY
MONITOR
```

A Case MAY have conflicting Intents.

The runtime MUST preserve those conflicts rather than pretending everything can be reduced to one progress percentage.

---

# 17. Rule

Canonical:

```json
{
  "id": "uuid",
  "case_id": "uuid",

  "type": "core.rule.requirement",

  "statement": "...",

  "authority_ref": "uuid",

  "applicability": {},
  "predicate": {},

  "effective_from": "...",
  "effective_until": null,

  "supersedes": null,

  "revision": 7
}
```

Rule types include:

```text
Requirement
Obligation
Prohibition
Permission
Deadline
Policy
Invariant
ApprovalRule
BudgetRule
SafetyRule
RetentionRule
SeparationOfDuties
```

---

# 18. Rule Evaluation

Rules MUST evaluate to one of:

```text
satisfied
unsatisfied
unknown
violated
waived
not_applicable
at_risk
```

`unknown` MUST be distinct from `unsatisfied`.

Missing evidence MUST NOT silently mean failure unless the Rule explicitly defines closed-world semantics.

---

# 19. Actor

Canonical:

```json
{
  "id": "uuid",

  "type": "human",

  "identity_ref": "...",

  "roles": [],
  "capabilities": [],
  "authority_grants": [],

  "availability": {},
  "cost_profile": {},

  "active": true
}
```

Actor classes:

```text
human
ai_agent
team
organization
external_authority
software_service
executor_runtime
```

---

# 20. Capability vs Authority

These MUST remain separate.

Example:

```text
Claude capability:
financial-analysis = yes

Claude authority:
approve_payment = no
```

The Policy Engine MUST evaluate authority independently from executor competence.

---

# 21. Resource

Resource captures constrained availability.

Examples:

```text
person hours
machine
GPU
vehicle
inventory
budget
API quota
agent concurrency
token budget
```

Canonical properties SHOULD support:

```text
capacity
availability
reservations
cost
location
consumable/reusable
```

Resource conflicts MUST be independently representable from task dependencies.

---

# 22. Decision

Canonical:

```json
{
  "id": "uuid",
  "case_id": "uuid",

  "question": "Which persistence strategy should be used?",

  "options": [],

  "evidence_refs": [],
  "risk_refs": [],

  "recommended_option": null,
  "recommendation_confidence": null,

  "required_authority": [],

  "state": "requested",

  "selected_option": null,
  "rationale": null,

  "revision": 3
}
```

Decision states:

```text
draft
requested
in_review
decided
deferred
superseded
cancelled
```

A Decision MAY block multiple Moves.

---

# 23. Move

Move is the canonical intentional process intervention.

```json
{
  "id": "uuid",
  "case_id": "uuid",

  "type": "core.move.act",

  "title": "Prepare technical methodology",
  "objective": "...",

  "intent_refs": [],

  "preconditions": [],
  "postconditions": [],

  "completion_contract": {},

  "required_capabilities": [],
  "required_authority": [],

  "constraints": [],

  "dependencies": [],

  "priority": 50,
  "risk": "medium",

  "deadline": null,

  "execution_policy": {},

  "revision": 11
}
```

Move classes:

```text
ACT
OBSERVE
ASK
WAIT
DECIDE
COMMUNICATE
VERIFY
DELEGATE
ESCALATE
APPROVE
REJECT
STOP
```

---

# 24. Task

Task SHALL NOT be a kernel primitive separate from Move.

Task is:

```text
Move(type = ACT)
```

with task-oriented projection metadata.

This prevents the ontology from becoming task-centric again through the back door.

---

# 25. Move State Vector

Move state MUST be derived as separate dimensions.

Required dimensions:

```text
readiness
execution
verification
attention
risk
temporal
outcome
```

Example:

```json
{
  "readiness": "ready",
  "execution": "running",
  "verification": "pending",
  "attention": "autonomous",
  "risk": "medium",
  "temporal": "on_track",
  "outcome": "unsatisfied"
}
```

---

# 26. Readiness

```text
not_ready
ready
conditional
```

`not_ready` MUST carry causal blockers.

---

# 27. Execution State

```text
not_started
queued
starting
running
pausing
paused
suspended
finishing
finished
```

`finished` does not mean satisfied.

---

# 28. Outcome State

```text
unsatisfied
partially_satisfied
satisfied
failed
cancelled
superseded
expired
not_applicable
abandoned
```

---

# 29. Verification State

```text
not_required
pending
running
passed
failed
waived
stale
```

---

# 30. Attention State

```text
autonomous
watch
human_input
human_decision
human_approval
critical_intervention
```

---

# 31. Attempt

Canonical:

```json
{
  "id": "uuid",
  "move_id": "uuid",

  "executor_id": "uuid",

  "strategy": "claude.background_session",

  "state": "running",

  "runtime_refs": {},

  "started_at": "...",
  "ended_at": null,

  "model": null,
  "effort": null,

  "cost": {},
  "usage": {},

  "revision": 8
}
```

A Move MAY have multiple concurrent Attempts.

---

# 32. Attempt Terminal Semantics

Attempts terminate as:

```text
succeeded
failed
cancelled
superseded
interrupted
timed_out
lost
```

`Attempt.succeeded` means:

> the executor reports that the attempt produced its intended output.

It does NOT automatically mean:

```text
Move.outcome = satisfied
```

Completion Engine decides that.

---

# 33. Event Envelope

The internal event envelope SHOULD be compatible in spirit with CloudEvents rather than inventing a random event shape for sport.

CloudEvents remains the dominant standardized generic event envelope and is a CNCF Graduated project.

Canonical Process Event:

```json
{
  "specversion": "1.0",

  "id": "uuid",
  "source": "urn:yoda:edge:device-id",
  "type": "yoda.process.move.activated.v1",

  "subject": "case/<case-id>/move/<move-id>",

  "time": "2026-09-07T13:12:11.482Z",

  "datacontenttype": "application/json",

  "tenantid": "uuid",
  "caseid": "uuid",

  "actorid": "uuid",

  "causationid": "uuid",
  "correlationid": "uuid",

  "occurredat": "...",

  "data": {}
}
```

We SHOULD preserve CloudEvents-compatible core fields while adding Process OS extension attributes.

---

# 34. Case Sequence

Every accepted Event SHALL receive:

```text
case_sequence
```

from the canonical store.

Example:

```text
E101 → sequence 501
E102 → sequence 502
```

This sequence defines deterministic projection order for a Case.

---

# 35. Causation

Every system-generated Event MUST carry a `causation_id` pointing to:

```text
Command
Event
ControllerEvaluation
```

that caused it.

Example:

```text
ClarificationObserved
  ↓
RuleSuperseded
  ↓
EvidenceInvalidated
  ↓
MoveGenerated
```

No important autonomous mutation may be causally anonymous.

---

# 36. Correlation

A longer logical operation MUST carry the same:

```text
correlation_id
```

across:

```text
human command
server events
edge command
Claude attempt
verification
completion
```

This SHOULD also be propagated into distributed tracing.

---

# 37. Command Envelope

Canonical:

```json
{
  "command_id": "uuid",
  "type": "Move.Steer",

  "tenant_id": "uuid",
  "case_id": "uuid",

  "actor_id": "uuid",

  "target_ref": {
    "type": "attempt",
    "id": "uuid"
  },

  "expected_revision": 14,

  "issued_at": "...",
  "expires_at": "...",

  "idempotency_key": "string",

  "payload": {}
}
```

A command is an intent to change process/execution state.

A command is NOT an Event.

---

# 38. Command Result

Every command returns:

```text
accepted
rejected
conflict
deferred
expired
unauthorized
unsupported
```

Accepted commands produce one or more Events.

---

# 39. Idempotency

All edge-originated and UI-originated mutations MUST support idempotency.

The server MUST deduplicate:

```text
event_id
command_id
idempotency_key
```

At-least-once network delivery MUST be safe.

Exactly-once transport MUST NOT be assumed.

---

# 40. Event Ingestion

Edge batches MAY contain Events out of order.

The server MUST:

1. authenticate the device;
2. validate schema;
3. deduplicate;
4. persist accepted Events;
5. assign canonical sequence where appropriate;
6. trigger projections/controllers.

Executor observations MUST NOT be allowed to mutate authoritative state merely because they arrived first.

---

# 41. Projections

Canonical state is reconstructed from Events.

Frequently queried projections SHOULD be materialized.

Required projections:

```text
case_summary
move_state
actor_workload
attention_queue
kanban
dependency_graph
evidence_status
rule_compliance
decision_queue
executor_status
timeline
context_status
cost_summary
```

Projection rebuild MUST be possible from canonical Event history.

---

# 42. Kanban Projection

Default board:

```text
BACKLOG
READY
ACTIVE
WAITING
NEEDS INPUT
VERIFY
DONE
```

Columns are queries over derived state.

Example:

```text
READY:

readiness = ready
AND
execution = not_started
AND
outcome = unsatisfied
```

`DONE`:

```text
outcome IN (
  satisfied,
  cancelled,
  superseded,
  not_applicable
)
```

UI SHOULD visually distinguish terminal meaning.

A cancelled card is not the same thing as satisfied work merely because both left the factory floor.

---

# 43. Kanban Drag Semantics

Dragging MUST emit a semantic command.

Examples:

```text
BACKLOG → READY
=
RequestReadiness

READY → ACTIVE
=
RequestActivation

ACTIVE → WAITING
=
SuspendOrWait

VERIFY → DONE
=
RequestSatisfaction
```

The runtime MAY reject the requested transition.

---

# 44. Optimistic UI

UI MAY display a pending transition immediately.

It MUST visually indicate:

```text
pending server validation
```

until the command is accepted.

On rejection, UI MUST revert and explain why.

---

# 45. Create / Edit / Delete

Authorized humans MUST be able to:

```text
CreateMove
EditMove
ChangePriority
ChangeDeadline
ChangeExecutorPolicy
AddConstraint
RemoveConstraint
AddDependency
RemoveDependency
SplitMove
MergeMoves
ForkMove
PauseMove
ResumeMove
CancelMove
SupersedeMove
RequestVerification
```

Normal Delete MUST map to semantic terminal states such as:

```text
cancelled
superseded
void
archived
```

rather than physical deletion.

---

# 46. Steering

Steering types:

```text
advisory
constraint
redirect
pause
hard_stop
fork
reassign
```

Canonical steering event:

```json
{
  "type": "yoda.execution.steering.issued.v1",
  "data": {
    "attempt_id": "...",
    "mode": "constraint",
    "instruction": "Do not modify the public API",
    "constraint_ref": "..."
  }
}
```

---

# 47. Steering Versioning

Steering MUST NOT rewrite prior attempt instructions.

Example:

```text
Attempt version 1
14:00 start

SteeringEvent
14:12

Attempt instruction version 2
14:12 onward
```

WHY and Time Travel MUST expose this boundary.

---

# 48. Steering Delivery Guarantees

Steering has three delivery classes.

## Class 1: Immediate Channel

When a compatible Claude Channel is available:

```text
server
→ channel transport
→ active Claude session
```

This is the lowest-latency semantic injection.

It MUST NOT be required for correctness because Channels remain research preview.

## Class 2: Safe-point Injection

Default reliable mechanism:

```text
server
→ WSS Process Edge
→ local pending steering queue
→ next hook interception point
→ Claude additionalContext / denial / redirection
```

Safe points SHOULD include:

```text
PreToolUse
UserPromptSubmit
TaskCompleted
SubagentStop
TeammateIdle
Stop
```

## Class 3: Runtime Interruption

Hard stop:

```text
server
→ local dispatcher
→ claude stop <background-id>
```

or equivalent controlled process termination.

---

# 49. Steering Latency Semantics

UI MUST distinguish:

```text
issued
delivered_to_edge
delivered_to_executor
acknowledged
applied
```

"Sent" MUST NOT falsely mean "Claude already incorporated this instruction."

---

# 50. Remote Hook Reliability Rule

Claude HTTP hook connection failures and non-2xx responses are non-blocking; execution continues unless a successful 2xx hook response explicitly returns a blocking decision.

Therefore:

> **Critical safety or completion enforcement MUST NOT depend solely on a remote HTTP hook.**

Critical enforcement MUST run locally using cached policy/evidence and a command hook or other deterministic local mechanism.

Remote HTTP hooks are suitable for:

```text
telemetry
non-critical synchronization
advisory controls
```

but not as the only fail-closed barrier.

---

# 51. Local Policy Mirror

Process Edge MUST maintain a local signed subset of policy needed to enforce:

```text
critical completion gates
tool restrictions
hard constraints
authority boundaries
steering stop/pause state
```

The mirror MUST include:

```text
policy_version
issued_at
expires_at
signature
```

If critical policy expires while offline, configured security posture determines:

```text
fail_closed
or
allow_limited_operation
```

per organization/Case.

---

# 52. Completion Contract

Move completion MAY define:

```json
{
  "all": [
    {
      "evidence": "software.tests.pass",
      "scope": {
        "commit": "$current_commit"
      }
    },
    {
      "approval": "security-review"
    }
  ]
}
```

Completion Engine MUST evaluate this contract independently from executor task state.

---

# 53. Claude Task Completion Gate

Claude exposes `TaskCompleted` before a native task is closed and allows hooks to block completion. The hook fires both on explicit `TaskUpdate` completion and when a team member ends a turn while still owning in-progress tasks.

For mapped Claude tasks, Process Edge SHOULD use this hook to prevent native completion where required process evidence is missing.

However:

```text
Claude native task completed
```

remains only execution state.

Canonical Move satisfaction still comes from Completion Engine.

---

# 54. Claude Task Creation Gate

`TaskCreated` exposes:

```text
task_id
task_subject
task_description
teammate_name
```

and can reject creation. The older `team_name` field is already deprecated, so Process OS MUST NOT use it as durable identity.

Task mapping MUST therefore anchor on:

```text
Claude session ID
Claude task ID
Attempt ID
```

not team name.

---

# 55. Native Task Mapping

Default mapping:

```text
Move
  ↓
Attempt
  ↓
0..N Claude Tasks
```

When a session is bound to exactly one active Move, newly created native tasks MAY be automatically associated with that Attempt.

When mapping is ambiguous:

```text
multiple active Moves in one session
```

the task MUST initially become:

```text
UnmappedExecutionWork
```

until:

```text
Claude explicitly binds it
human binds it
classifier proposes mapping with accepted confidence
```

No silent guess becomes canonical.

---

# 56. Impact Propagation

Whenever a semantic object changes, Runtime SHALL compute affected dependencies.

Examples:

```text
Rule changed
→ requirement satisfaction reevaluated
→ evidence possibly invalidated
→ Move readiness recalculated
→ attention recalculated
```

Propagation MUST be event-driven and bounded.

Infinite controller loops MUST be detected.

---

# 57. Controller Execution

Every Controller run MUST have:

```text
controller_id
controller_version
trigger_event_ids
input_revision
output
confidence if semantic
duration
```

Controller outputs MUST be replayable where deterministic.

AI-controller outputs MUST be persisted as evaluation results so historical reasoning does not silently change when the underlying model later changes.

---

# 58. AI Proposals

AI SHOULD NOT directly mutate high-impact canonical state.

It should create:

```text
Proposal
```

with:

```text
proposed_commands[]
confidence
evidence_refs[]
rationale_summary
risk
required_approval
```

Policy decides:

```text
auto_accept
human_review
reject
```

---

# 59. Autonomy Policy

Autonomy is action-specific.

Example:

```json
{
  "move_create": "auto_low_risk",
  "move_cancel": "human",
  "priority_change": "auto_within_owned_scope",
  "spawn_agent": "auto",
  "submit_external": "human",
  "financial_commitment": "human"
}
```

Avoid one global:

```text
autonomous = true
```

because real authority does not work like a checkbox in a demo.

---

# 60. Human Attention Engine

Attention priority SHOULD derive from:

```text
required authority
risk severity
deadline pressure
critical path impact
number of blocked descendants
financial/business impact
uncertainty
duration waiting
```

Attention events MUST be deduplicated.

The system MUST NOT notify repeatedly for the same unresolved condition unless severity changes or policy requires escalation.

---

# 61. Execution Compiler

Input:

```text
Move semantics
capability requirements
authority
risk
context requirement
expected work topology
parallelism
communication topology
resource constraints
deadline
budget
available executors
Claude capabilities
```

Output:

```text
ExecutionPlan
```

---

# 62. ExecutionPlan

Canonical plan MAY specify:

```json
{
  "executor": "claude_code",

  "strategy": "background_session",

  "session_policy": "fresh",

  "model_policy": "adaptive",
  "effort_policy": "high",

  "isolation": "worktree",

  "parallelism": 1,

  "verification_strategy": "...",

  "context_policy": "...",

  "budget": {}
}
```

ExecutionPlan is versioned.

It MAY change while the Move remains the same.

---

# 63. Executor Contract

Every executor adapter MUST implement a subset of:

```text
discoverCapabilities()
canAccept(move)
startAttempt()
reportProgress()
receiveSteering()
pauseAttempt()
resumeAttempt()
cancelAttempt()
collectEvidence()
finishAttempt()
health()
```

Unsupported operations MUST be declared, not silently ignored.

---

# 64. Claude Executor Capability Profile

At the current baseline, Claude adapter SHOULD expose feature probes for:

```text
plugin_hooks
plugin_mcp
task_tools

subagents
agent_teams
dynamic_workflows

background_sessions
agent_view_supervisor

cross_session_messaging

worktrees

goals
scheduled_tasks

channels

pre_model_switch
post_compact
resume_context_metrics

mcp_v2
mcp_tool_search
```

Runtime MUST probe capabilities rather than hard-code only version thresholds.

---

# 65. Minimum Claude Version

Recommended minimum:

```text
2.1.251
```

because current lifecycle data after this point includes materially valuable resume/fork context metrics and model-switch hooks. `SessionStart` on resume/fork can expose `seconds_since_last_response`, `context_tokens`, likely prompt-cache expiration and estimated cache-write cost.

Latest release SHOULD remain the primary support target.

Current validated release:

```text
2.1.263
```



---

# 66. Claude Plugin Layout

Recommended:

```text
universal-process/
│
├── .claude-plugin/
│   └── plugin.json
│
├── skills/
│   ├── connect/
│   │   └── SKILL.md
│   ├── process/
│   │   └── SKILL.md
│   ├── why/
│   │   └── SKILL.md
│   ├── steer/
│   │   └── SKILL.md
│   └── context/
│       └── SKILL.md
│
├── agents/
│   ├── process-architect.md
│   ├── process-guardian.md
│   └── evidence-verifier.md
│
├── workflows/
│   └── ...
│
├── hooks/
│   └── hooks.json
│
├── monitors/
│   └── monitors.json
│
├── .mcp.json
│
├── package.json
├── package-lock.json
│
└── bin/
    └── ...
```

Current plugin reference explicitly supports `workflows/` and treats monitors as an experimental manifest component.

---

# 67. Plugin Agent Restriction

Plugin-shipped agents currently cannot define their own:

```text
hooks
mcpServers
permissionMode
```

for security reasons.

Therefore Process Architect / Guardian / Verifier MUST rely on:

```text
plugin-level hooks
plugin-level Process MCP
allowed agent tools/skills
```

rather than assuming each plugin agent can embed isolated MCP and permission policy.

---

# 68. Plugin Persistent Data

Use:

```text
${CLAUDE_PLUGIN_DATA}
```

for persistent local state that must survive plugin updates.

Current Claude plugin runtime provides this directory explicitly and retains it across plugin version changes until uninstall.

Suitable data:

```text
device identity
local SQLite database
outbox
cached policies
pairing metadata
capability cache
edge configuration
```

Secrets SHOULD use OS secure storage where available.

---

# 69. User Configuration

Claude plugin `userConfig` can prompt users at enable time and marks sensitive values for secure storage.

Use it only for bootstrap necessities such as:

```text
control_plane_url
organization_hint
optional deployment mode
```

Do NOT require users to paste API tokens manually as the normal path.

Normal authentication SHALL use browser pairing/OAuth-style login.

---

# 70. Process MCP

Process MCP exposes semantic process capabilities to Claude.

Required tool groups:

```text
process.case.get
process.case.search

process.move.get
process.move.list
process.move.propose
process.move.bind_task

process.evidence.register
process.assertion.propose

process.decision.request

process.context.get
process.context.delta

process.why.explain

process.execution.report

process.steering.ack
```

Tool schemas SHOULD remain concise because modern Claude Code defers MCP tools through tool search by default when supported.

---

# 71. Process MCP Transport

Primary Process MCP SHOULD be:

```text
remote HTTP
```

or a local stdio bridge backed by the edge, depending deployment mode.

It MUST support current Claude MCP behavior and SHOULD be compatible with the MCP `2026-07-28` stateless revision where available.

---

# 72. MCP Stateful Application Data

MCP 2026-07-28 removes protocol-level session assumptions from the core, but Process OS itself remains stateful.

Therefore every MCP request MUST carry or derive:

```text
user identity
device identity
organization
Claude session binding
Case binding
Attempt binding
```

Process state MUST NOT depend on an MCP transport session ID.

---

# 73. Channel Transport Separation

The Channel server MUST be logically and operationally separate from primary Process MCP.

Reason:

Current Claude Code does not register a Channel server that negotiates MCP revision `2026-07-28`.

Architecture:

```text
Process MCP
  → newest supported MCP revision

Process Channel
  → Channel-compatible protocol mode
```

Never force the primary Process MCP backward merely to support an experimental Channel.

---

# 74. MCP Long Tool Calls

Claude automatically backgrounds main-conversation MCP tool calls that remain active beyond approximately two minutes, giving Claude a task ID while the operation continues. Those tasks do not survive session exit.

Therefore:

> MCP background task state MUST NOT be canonical Attempt durability.

Long-running Process operations must return quickly and continue asynchronously in Process OS itself.

---

# 75. Hook Design Philosophy

Hooks serve four purposes:

```text
telemetry
context hydration
governance
execution interception
```

They SHOULD remain fast.

Hooks MUST NOT perform heavy process reasoning synchronously where avoidable.

---

# 76. SessionStart Hook

SessionStart MUST:

1. identify device/session;
2. resolve Case binding;
3. fetch/read locally cached Context Capsule;
4. return `additionalContext`;
5. optionally set session title;
6. optionally register watched paths.

Current `SessionStart` supports sources:

```text
startup
resume
clear
compact
fork
```

and can inject `additionalContext`, set a session title, register watched paths and request skill reload.

---

# 77. SessionStart Must Not Depend on MCP Connectivity

Claude docs explicitly note that MCP-tool hooks at SessionStart may execute before MCP servers finish connecting.

Therefore critical SessionStart hydration MUST use:

```text
local command hook
```

talking to:

```text
local Process Edge/cache
```

not require a live MCP call.

Network refresh MAY occur asynchronously afterward.

---

# 78. UserPromptSubmit

Use to:

```text
attach latest critical process delta
surface pending steering
detect possible new Case/Move intent
```

Do NOT rewrite the user's prompt.

Claude's hook model supports adding context alongside a prompt, not replacing the prompt.

---

# 79. PreToolUse

Use for:

```text
hard local policy enforcement
pending steering delivery
risk checks
tool-input redaction
```

Any automatic tool-input rewrite MUST create a Process Event.

Silent rewriting is prohibited.

---

# 80. PostToolUse

Use for:

```text
tool telemetry
artifact detection
evidence candidates
external side-effect detection
```

Avoid synchronously uploading full tool output by default.

---

# 81. PostToolBatch

Use as a useful semantic safe point after parallel tool calls.

Potential actions:

```text
flush accumulated events
evaluate steering
run lightweight policy
detect phase transition
```

---

# 82. Permission Hooks

`PermissionRequest` / `PermissionDenied` SHOULD be translated into:

```text
ExecutionBlocked
PermissionNeeded
PermissionDenied
```

Events.

Remote approval through Process OS MAY be supported only where Claude's actual runtime allows safe permission relay.

---

# 83. MessageDisplay

`MessageDisplay` can alter only displayed text, not transcript/model content.

Process OS MUST NOT use it for semantic steering.

It MAY later provide optional UI decoration.

---

# 84. InstructionsLoaded

Use as telemetry to track when:

```text
CLAUDE.md
.claude/rules/*
```

actually entered context.

This helps Context Orchestrator understand which instructions Claude has really loaded rather than assuming they exist merely because files exist.

---

# 85. ConfigChange

Use to detect meaningful harness/runtime configuration drift.

Potential process effects:

```text
permissions changed
MCP changed
agent configuration changed
settings changed
```

This should inform:

```text
ExecutionEnvironmentChanged
```

rather than immediately mutate the Case.

---

# 86. FileChanged

Use for selectively watched high-value files.

Examples:

```text
requirements document
generated spec
CI state file
manifest
decision register
```

Do NOT watch entire huge repositories indiscriminately.

---

# 87. Worktree Hooks

Worktree lifecycle maps to:

```text
AttemptIsolationCreated
AttemptIsolationRemoved
```

Claude worktrees are execution isolation.

They are not semantic Case branches.

---

# 88. PreModelSwitch / PostModelSwitch

Current Claude Code allows PreModelSwitch to block user/client-requested model switches, while automatic model changes such as fallback only appear after the fact in PostModelSwitch.

Therefore model governance MUST distinguish:

```text
requested model switch
automatic runtime model switch
```

and cannot assume every model transition is blockable.

---

# 89. Stop Hook

Stop can continue Claude when verification fails.

Current Claude Code caps repeated Stop-hook blocks after eight consecutive blocks.

Therefore Process OS MUST NOT implement an infinite autonomous verification loop solely through Stop-hook blocking.

Longer remediation loops MUST become explicit Moves/Attempts.

---

# 90. TaskCreated / TaskCompleted

These hooks have no matchers and fire globally for native Task tool activity.

Hook logic MUST therefore be cheap and immediately exit when:

```text
session is not Case-bound
```

or:

```text
task is not relevant
```

---

# 91. Subagent Lifecycle

SubagentStart and SubagentStop map to:

```text
ExecutorChildStarted
ExecutorChildFinished
```

A subagent MUST NOT automatically become a canonical Move.

It is execution structure unless explicitly promoted.

---

# 92. Agent Teams

Claude Agent Teams SHOULD be selected when independent peers need direct communication and coordinated shared work.

Agent Teams currently use native tasks with only:

```text
pending
in progress
completed
```

dependencies are automatically unblocked and claiming uses file locking.

Those features are useful execution mechanisms.

They MUST NOT determine our canonical Move state machine.

---

# 93. Team Overhead Rule

Execution Compiler SHOULD avoid Agent Teams for:

```text
strictly sequential work
heavy same-file contention
dependency-dense tiny tasks
```

because Anthropic explicitly documents higher coordination/token overhead and recommends them where peers can operate substantially independently.

---

# 94. Dynamic Workflows

Use when orchestration itself should be codified.

Strong cases:

```text
large fan-out/fan-in
research across many independent sources
migration across many files
repetitive audit
independent verification
```

Current workflows can scale to dozens or hundreds of agents, with intermediate results held by the script rather than the parent conversation.

---

# 95. Workflow Durability Boundary

Current dynamic workflow saved results remain associated with the Claude session; replay/resume semantics depend on resuming that session. A fresh session has no saved workflow run to replay.

Therefore:

```text
Claude workflow runtime state
≠
Process OS durability
```

Process OS must checkpoint meaningful workflow outputs as Events/Evidence.

---

# 96. Background Sessions

For managed execution, prefer:

```text
claude --bg
```

over custom PTY/session hosting.

Current Claude Code's Agent View supervisor persists and restarts background sessions and exposes machine-readable state.

---

# 97. Native Session Commands

Process Dispatcher MAY use supported CLI operations including:

```text
claude --bg
claude --resume
claude --continue
claude --fork-session

claude agents --json

claude attach
claude logs
claude stop
claude respawn
```

Current docs expose these as native lifecycle operations.

---

# 98. Process Dispatcher

The always-on Process Dispatcher is intentionally thin.

Responsibilities:

```text
maintain WSS connection
receive signed semantic commands
launch claude --bg
query claude agents --json
stop/respawn sessions
coordinate local Process Edge
```

It MUST NOT become another Claude supervisor.

Claude's own supervisor owns Claude background process lifecycle.

---

# 99. Dispatcher Installation

Dispatcher is optional for normal interactive use.

Required for:

```text
cloud-triggered execution
execution when no Claude session is open
24/7 worker mode
```

Installation SHOULD be one-click/one-command after plugin pairing.

---

# 100. Context Orchestrator

Context Orchestrator MUST manage:

```text
Case memory
Move memory
Attempt memory
session bindings
context capsules
resume deltas
stale assumptions
compaction lifecycle
session rotation
context contamination
```

---

# 101. Context Levels

```text
Organization Memory
Workspace Memory
Project Memory
Case Memory
Move Memory
Attempt Memory
Session Context
```

Retrieval MUST be relevance-based.

Lower-level context MUST NOT automatically inherit all higher-level memory.

---

# 102. Context Capsule

Canonical structure:

```text
IDENTITY
- Case
- Move
- Attempt

INTENT
- current objective
- relevant success criteria

REALITY
- relevant entities
- current verified facts
- important uncertainty

DECISIONS
- applicable decisions

CONSTRAINTS
- active rules
- steering constraints

PROGRESS
- completed work
- current state
- failed approaches

DEPENDENCIES
- blockers
- downstream impact

EVIDENCE
- relevant evidence

DELTA
- what changed since previous session/capsule

NEXT
- recommended next actions

DO NOT REPEAT
- superseded/failed approaches
```

Capsule MUST be generated from canonical state, not solely from transcript summarization.

---

# 103. Context Capsule Versioning

Every capsule MUST have:

```text
capsule_id
case_revision
move_revision
generated_at
generator_version
included_object_refs
token_estimate
```

Claude session binding records which capsule was injected.

---

# 104. Resume Delta

On resumed sessions, SessionStart now provides highly valuable signals including:

```text
seconds_since_last_response
context_tokens
prompt_cache_likely_expired
estimated_cache_write_usd
```

for applicable sessions.

Context Orchestrator SHOULD use them when deciding:

```text
resume as-is
resume + delta
fork
fresh session
```

---

# 105. `/clear`

Claude emits:

```text
SessionStart(source = clear)
```

after `/clear`.

Process Edge MUST respond by rehydrating essential Case/Move context.

Therefore:

```text
/clear
```

must not sever process ownership.

---

# 106. Compaction

Claude exposes:

```text
PreCompact
PostCompact
SessionStart(source=compact)
```

and PostCompact exposes the generated compact summary.

Required flow:

```text
PreCompact
→ semantic checkpoint

PostCompact
→ record native compact summary
→ compare critical coverage

SessionStart(compact)
→ inject missing canonical state
```

---

# 107. Compaction Control Limitation

A normal plugin currently has no general documented API equivalent to:

```text
force_current_interactive_session_to_run("/compact")
```

or:

```text
force_current_interactive_session_to_run("/clear")
```

Therefore Assisted Mode MAY recommend those actions.

Managed Mode SHOULD prefer:

```text
fresh / resume / fork session lifecycle
```

using supported CLI mechanisms rather than terminal-keystroke hacks.

---

# 108. Context Usage Signal

Claude status-line JSON currently exposes exact context information including:

```text
context_window_size
used_percentage
remaining_percentage
current_usage
```

as well as model, effort, rate-limit data and other runtime information.

However:

> this data is supplied to status-line commands, not ordinary plugin hook events.

Furthermore, plugin `settings.json` currently supports only limited plugin-settable settings keys rather than allowing a plugin to silently install a user's main status line.

Therefore exact live context percentage MUST be treated as an enhanced telemetry capability, not a baseline assumption.

---

# 109. Optional Status-Line Bridge

Advanced mode MAY install a status-line multiplexer with explicit user/admin approval.

It MUST:

1. preserve the user's existing visible status line;
2. receive the same JSON;
3. forward context metrics to Process Edge;
4. invoke the original status line;
5. never replace user display without consent.

Without this integration, Context Orchestrator still operates using lifecycle signals, transcript estimates, resume metrics and semantic context-health analysis.

---

# 110. Context Health

Context Health SHOULD derive from multiple dimensions:

```text
token_pressure
relevance_density
stale_assumption_density
contradiction_density
tool_output_bloat
phase_shift
pivot_count
remaining_expected_work
resume_cache_cost
```

No one threshold like:

```text
context > 80%
```

is sufficient.

---

# 111. Context Actions

Context Controller outputs:

```text
CONTINUE
COMPACT_RECOMMENDED
ROTATE_FRESH
RESUME
FORK
OFFLOAD_SUBAGENT
OFFLOAD_WORKFLOW
```

Autonomy policy determines whether action is automatic.

---

# 112. Subagents as Context Isolation

Claude's own documentation recommends subagents for work that benefits from a separate context window.

Execution Compiler SHOULD offload:

```text
large research
large file exploration
independent audit
```

rather than polluting the main session.

---

# 113. Goal Integration

`/goal` is useful as a local session-level continuous completion loop.

Current implementation uses a separate evaluator after each turn. However, that evaluator judges what Claude surfaced in conversation and does not independently inspect files or run commands.

Therefore:

```text
/goal
```

MAY enforce an inner execution objective.

It MUST NOT become canonical Process Completion authority.

---

# 114. Cross-Session Messaging

Where available, Claude provides:

```text
ListAgents
SendMessage
```

for session communication.

Use for:

```text
peer findings
dependency notification
handoffs
contract changes
```

but Process OS MUST retain its own durable semantic Event.

Native messages alone are not durable process truth.

---

# 115. Cross-Machine Policy

Claude allows administrators to disable cross-session send/list and receiving; cross-machine messages can also require explicit approval.

Therefore Execution Compiler MUST treat cross-session messaging as:

```text
capability-probed
policy-dependent
```

not universal.

---

# 116. External Event Gateway

External inputs:

```text
GitHub
CI
email
calendar
CRM
ERP
webhooks
MCP systems
human uploads
physical telemetry
```

normalize into:

```text
RawExternalEvent
```

Then semantic interpretation produces proposed:

```text
Event
Assertion
Entity
Relation
Evidence
```

Policy decides acceptance.

---

# 117. Raw vs Interpreted Events

Always preserve:

```text
RawExternalEvent
```

separately from AI interpretation.

Example:

```text
email text
    ↓ AI interpretation
possible DecisionMade
```

The email remains provenance.

The inferred Decision is a proposal until authority rules permit acceptance.

---

# 118. Process Packs

Process Pack manifest:

```json
{
  "id": "yoda.procurement",
  "version": "1.0.0",

  "type_schemas": [],
  "relation_types": [],
  "views": [],
  "controllers": [],
  "default_rules": [],
  "execution_hints": [],
  "extractors": []
}
```

Packs SHOULD be declarative by default.

---

# 119. Domain Packs vs Process Packs

Domain:

```text
software
procurement
journalism
legal
sales
research
logistics
```

Behavior:

```text
investigation
compliance
approval
incident
selection
negotiation
production
monitoring
```

A Case composes both.

---

# 120. Pack Security

Declarative pack data MAY be auto-installed under organization policy.

Executable extensions MUST require stronger trust.

Unsigned arbitrary executable code MUST NOT silently enter the Control Plane through a process pack.

---

# 121. View Compiler

Input:

```text
Case semantic types
active controllers
volume
process archetypes
user role
```

Output:

```text
recommended views
default navigation
card fields
filters
```

Example:

```text
many Requirements + Evidence
→ Compliance view

many Claims + Sources
→ Evidence Graph

many concurrent Moves
→ Kanban
```

---

# 122. WHY Engine

WHY query:

```json
{
  "target": "move-id",
  "question": "why_blocked"
}
```

Engine traverses:

```text
current projection
→ triggering Events
→ dependency Relations
→ Rules
→ Evidence
→ Decisions
```

Output MUST separate:

```text
deterministic cause
AI-generated explanation
```

The explanatory prose must reference underlying canonical objects.

---

# 123. Search

Universal search SHOULD support:

```text
exact text
semantic search
structured filters
graph traversal
natural-language query
```

Natural-language query MUST compile to explicit query operations rather than allowing an LLM to invent unseen data.

---

# 124. Storage Architecture

Recommended canonical storage topology:

```text
PostgreSQL
  - aggregates
  - append-only event ledger
  - relations
  - projection metadata
  - access control metadata

Object Storage
  - artifacts
  - optional evidence blobs

Search Index
  - full-text / semantic retrieval

Local Edge SQLite
  - outbox
  - policy cache
  - process cache
  - device state
```

A separate graph database is NOT required initially.

Relations can be represented efficiently in PostgreSQL until measured requirements prove otherwise.

---

# 125. Event Ledger

Event storage MUST be append-only at the application layer.

Normal application operations MUST NOT:

```text
UPDATE old event payload
DELETE old event
```

Corrections are new Events.

Administrative/legal deletion is a separate controlled subsystem.

---

# 126. Projection Snapshots

To avoid replaying enormous Case histories on every request:

```text
snapshot
+
events after snapshot
```

MAY rebuild state.

Snapshots are disposable cache.

Events remain canonical.

---

# 127. OCEL Export

The Event Ledger SHOULD support future export into an OCEL-compatible representation for object-centric process mining.

OCEL 2.x explicitly models events related to multiple objects and object-to-object relationships, which maps well to Universal Process OS history.

Internal semantics need not be restricted to OCEL's exchange model.

---

# 128. Control Plane API

Proposed stable API surface:

```text
/v1/cases
/v1/moves
/v1/decisions
/v1/evidence
/v1/assertions
/v1/rules
/v1/actors

/v1/commands
/v1/events/batch

/v1/query
/v1/why

/v1/devices
/v1/executors

/v1/process-packs
```

Writes MUST go through Commands.

No public API client directly writes projection tables.

---

# 129. Edge Realtime Gateway

Preferred:

```text
WSS /v1/edge
```

Edge connection handshake includes:

```text
device identity
plugin version
Claude version
capability profile
machine metadata
active session bindings
last acknowledged event position
```

---

# 130. Edge Command Protocol

Server pushes semantic Commands.

Edge replies:

```text
received
validated
accepted
deferred
delivered
executed
rejected
failed
```

A separate asynchronous Event communicates resulting domain/execution state.

---

# 131. Browser Realtime

Browser SHOULD receive projection deltas over:

```text
WebSocket or SSE
```

UI should not poll boards repeatedly under normal operation.

---

# 132. Offline Edge

Local edge MUST queue:

```text
events
evidence metadata
command acknowledgements
session telemetry
```

while offline.

Claude execution MAY continue according to cached policy.

---

# 133. Offline Conflict

Server remains canonical.

On reconnect:

1. upload local observations/events;
2. deduplicate;
3. apply canonical sequence;
4. detect semantic conflicts;
5. regenerate projections;
6. send corrective state to Edge/UI.

Do not attempt CRDT-style merging of every semantic object.

Some conflicts require decisions.

---

# 134. Device Identity

Pairing creates:

```text
device_id
device public/private keypair
organization binding
user binding
```

Private device key MUST remain local.

Server stores public key.

---

# 135. Command Signing

High-impact server-to-device commands SHOULD include a cryptographic signature covering:

```text
command_id
device_id
actor_id
target
payload hash
issued_at
expires_at
nonce
```

Edge MUST reject:

```text
bad signature
wrong device
expired
replayed nonce
invalid authority
```

---

# 136. Authentication

Human web auth SHOULD use standard organizational authentication:

```text
OIDC
SSO
MFA
```

Plugin/device onboarding SHOULD use browser-based pairing.

Manual API-token copy/paste is fallback only.

---

# 137. Device Pairing UX

Normal path:

```text
Install plugin
↓
Claude starts
↓
Plugin detects unpaired device
↓
one browser link/code
↓
login
↓
approve device
↓
device linked
```

No YAML.

No manual MCP JSON.

No handcrafted API key.

---

# 138. Installation

Claude currently supports non-interactive marketplace management:

```text
claude plugin marketplace add ...
claude plugin install ...
```

and a marketplace can be added directly from a remote `marketplace.json` URL.

Therefore onboarding MAY expose one shell line that performs both native operations.

---

# 139. Enterprise Installation

Admins MAY declare marketplaces and enabled plugins centrally through Claude managed settings using facilities such as:

```text
extraKnownMarketplaces
enabledPlugins
```



Enterprise rollout SHOULD exploit this so users need no manual marketplace setup.

---

# 140. Hook Trust Restrictions

Claude enterprise policy can restrict hooks to managed hooks, with force-enabled managed plugins receiving special treatment. HTTP hook URLs and environment interpolation can also be allowlisted.

The plugin MUST expose deployment documentation compatible with these enterprise controls.

---

# 141. Privacy Modes

Minimum modes:

```text
METADATA
STRUCTURED
RICH
SOVEREIGN
```

## METADATA

Central receives:

```text
IDs
states
timing
actors
opaque references
```

## STRUCTURED

Adds:

```text
semantic Events
summaries
Assertions
Evidence metadata
```

## RICH

Adds approved:

```text
artifacts
tool outputs
transcript segments
```

## SOVEREIGN

Self-hosted Control Plane.

---

# 142. Transcript Default

Full transcripts MUST NOT be uploaded by default.

Canonical process behavior MUST work without them.

Transcript ingestion is:

```text
explicit
scoped
retention-controlled
classification-aware
```

---

# 143. Secret Handling

Secrets MUST NOT be:

```text
embedded in Events
embedded in Context Capsules
shown in WHY
stored in process pack manifests
```

Store references to secret providers where possible.

---

# 144. Policy Enforcement Architecture

Policy evaluation occurs at two levels.

## Server

Authoritative organizational policy.

## Edge

Cached enforcement subset for local fail-closed behavior.

Policy inputs:

```text
actor
action
resource
Case
risk
environment
device trust
executor
```

OPA/Rego is a viable implementation model because it evaluates declarative rules over structured data, but the exact engine remains an implementation decision.

---

# 145. Audit

Audit log MUST record:

```text
auth events
policy decisions
human overrides
executor assignment
steering
Case mutations
device changes
permission-sensitive actions
data export
administrative deletion
```

Audit itself MUST be append-oriented and tenant-isolated.

---

# 146. Observability

Every request/command/attempt SHOULD propagate:

```text
trace_id
span_id
correlation_id
case_id
attempt_id
```

OpenTelemetry-compatible tracing SHOULD be used for infrastructure observability.

Process causality remains a separate semantic concept from infrastructure traces.

---

# 147. Cost Accounting

Attempt usage SHOULD capture where available:

```text
input tokens
output tokens
cache creation/read tokens
model
effort
duration
monetary cost
agent count
workflow usage
```

Current Claude status-line data exposes substantial runtime and rate-limit information where status-line telemetry is enabled.

---

# 148. Budget Controls

Cases and Moves MAY define:

```text
hard budget
soft budget
agent concurrency cap
model restrictions
effort restrictions
```

Budget Controller MUST alert before hard exhaustion when possible.

---

# 149. Notifications

Notification object MUST carry:

```text
reason
severity
target actors
Case
trigger
dedupe key
expiration
recommended action
```

Notifications SHOULD describe meaning:

```text
"Security approval now blocks release"
```

not implementation noise:

```text
"Task #418 updated"
```

---

# 150. Human Work

Humans are first-class executors.

Human-assigned Move uses the same:

```text
Move
Attempt
Evidence
Completion
```

model.

No special "manual task system" should exist beside AI work.

---

# 151. Process Health

Health vector:

```text
outcome
schedule
risk
evidence
knowledge
resources
attention
automation
cost
```

Any composite score MUST remain explainable.

---

# 152. Critical Path

When timing/dependencies/resources permit, Runtime SHOULD compute:

```text
critical path
float
downstream delay impact
```

A human changing a deadline or dependency should immediately see affected outcomes.

---

# 153. Process Drift

Process Intelligence compares:

```text
expected topology
observed Event history
```

and detects:

```text
recurring inserted steps
hidden dependencies
repeat failures
manual intervention hotspots
approval bottlenecks
rework
```

Drift findings create proposals, not silent template changes.

---

# 154. Process Simulation

Simulation MUST run on forked state:

```text
canonical Event position N
+
hypothetical changes
```

Simulation Events MUST never enter canonical history unless explicitly adopted.

---

# 155. Failure: Control Plane Offline

Expected behavior:

```text
Claude continues
Edge buffers Events
critical cached policy remains active
browser shows degraded connectivity
```

No process truth is lost after local acknowledgment.

---

# 156. Failure: Edge Offline

Case remains canonical.

Move MAY be:

```text
executor_unreachable
```

Scheduler MAY reassign according to policy.

---

# 157. Failure: Claude Session Crash

Record:

```text
AttemptInterrupted
```

If native background supervisor restarts it successfully, update runtime binding.

Move remains unchanged.

---

# 158. Failure: Claude Upgrade

Capability profile MUST be recomputed after Claude version changes.

Do not assume an old capability cache remains valid.

---

# 159. Failure: Plugin Upgrade

Persistent device/process state MUST live in:

```text
CLAUDE_PLUGIN_DATA
```

or other durable local storage, not versioned plugin install files.

Schema migration MUST be transactional.

---

# 160. Failure: Duplicate Hooks

Hooks may be retried or duplicate Events may arise from process restart.

Event IDs/idempotency MUST prevent duplicate canonical effects.

---

# 161. Failure: Out-of-Order Hooks

Projections MUST not rely on arrival ordering alone.

Use:

```text
session sequence where available
event causal links
occurred_at
server case sequence
```

---

# 162. Failure: Agent Claims Done Without Evidence

TaskCompleted local gate MAY reject native completion.

Even if it does not:

```text
Attempt can finish
Move remains unsatisfied
```

Thus system remains correct.

---

# 163. Failure: Stale Steering

Every steering Command MUST have:

```text
target attempt
expected instruction revision
expiry
```

A steering command for superseded Attempt A MUST NOT accidentally modify replacement Attempt B.

---

# 164. Failure: AI Hallucinates Process Structure

AI-proposed entities/relations MUST preserve:

```text
proposal source
confidence
provenance
authority requirement
```

Low-confidence/high-impact changes require human review.

---

# 165. Performance Requirements

Initial production targets:

```text
UI command acknowledgment:
p95 < 300 ms within primary region

projection delta delivery:
p95 < 500 ms

edge WSS command delivery:
p95 < 500 ms excluding client connectivity

local hook no-op:
p95 < 30 ms

local critical policy hook:
p95 < 100 ms

Case projection read:
p95 < 200 ms

WHY first deterministic response:
p95 < 1 s
```

AI-generated explanations MAY stream afterward.

---

# 166. Hook Performance

Synchronous hooks occur inside Claude execution.

They MUST remain extremely cheap.

Pattern:

```text
read local cache
evaluate simple predicate
enqueue local event
return
```

NOT:

```text
call five APIs
run vector search
invoke giant model
ponder metaphysics
return eventually
```

---

# 167. Durability Requirements

After server acknowledges an Event:

```text
Event loss tolerance = zero
```

Projection loss is acceptable because projections are rebuildable.

Local outbox MUST survive process restart.

---

# 168. Availability Targets

Control Plane:

```text
99.9% initial service target
```

Execution continuity target is stronger because local execution is designed to tolerate central outages.

---

# 169. Multi-Tenancy

Every canonical record MUST belong to:

```text
organization_id
```

directly or through a provable parent.

Tenant boundary MUST be enforced at:

```text
API
database
realtime subscriptions
search
AI retrieval
artifact storage
logs
analytics
```

No cross-tenant semantic retrieval.

---

# 170. Data Retention

Retention SHOULD be separately configurable for:

```text
Events
execution telemetry
transcripts
artifacts
audit
analytics
```

Canonical event retention defaults longer than raw execution telemetry.

---

# 171. Compatibility Strategy

Support policy:

```text
latest Claude Code = Tier 1

recent compatible versions with required primitives = Tier 2

older versions = degraded / unsupported
```

Capability probe determines actual behavior.

---

# 172. Experimental Feature Rule

Features marked by Claude as preview/experimental MUST satisfy:

```text
optional
capability-probed
policy-controlled
stable fallback exists
```

This currently applies particularly to Channels and agent-based hook use in sensitive enforcement paths.

---

# 173. Compatibility Degradation Example

If Channels unavailable:

```text
steering
→ WSS edge queue
→ PreToolUse safe-point
```

If Agent Teams unavailable:

```text
team strategy
→ subagents or independent sessions
```

If Dynamic Workflows unavailable:

```text
workflow
→ scheduler-managed fan-out
```

If cross-session messaging disabled:

```text
handoff
→ Process Events + Context Capsule
```

If status-line bridge absent:

```text
context health
→ lifecycle/semantic estimate
```

---

# 174. Zero-Configuration Requirement

After pairing, system MUST automatically detect where possible:

```text
device
current project
git repository
branch
worktree
Claude version
feature capabilities
existing native tasks
active background sessions
organization membership
```

User should configure only ambiguities.

---

# 175. Existing Work Reconstruction

First-use discovery MAY inspect:

```text
repository metadata
active Claude tasks
session state
project instructions
connected issue tracker
user's explicit prompt
```

AI may propose:

```text
Case
Moves
dependencies
pack selection
```

Nothing inferred as authoritative requirement without provenance.

---

# 176. Universal Onboarding Goal

The full product may internally contain:

```text
event sourcing
policy engines
semantic graphs
MCP
Claude hooks
context orchestration
distributed execution
```

but expected normal user journey remains:

```text
INSTALL
↓
LOGIN
↓
WORK
```

This is a technical requirement, not marketing copy.

---

# 177. Adversarial Acceptance Test: Coding

Scenario:

```text
Claude implementing authentication
human changes persistence strategy mid-execution
```

MUST demonstrate:

```text
steering version event
safe-point delivery
old Attempt provenance preserved
context updated
test evidence scoped to correct commit
completion blocked until new criteria pass
```

---

# 178. Adversarial Acceptance Test: Tender

Scenario:

```text
external clarification modifies requirement after draft completed
```

MUST demonstrate:

```text
RuleSuperseded
EvidenceInvalidated
compliance recalculation
affected Moves reopened/generated
human attention updated
WHY causal path
```

---

# 179. Adversarial Acceptance Test: Journalism

Scenario:

```text
source retracts previous claim
contradictory document remains
```

MUST preserve:

```text
original Claim
Retraction
document Evidence
Contradiction
updated confidence
new investigative Move
```

No truth collapse.

---

# 180. Adversarial Acceptance Test: Negotiation

Scenario:

```text
CEO says "we approve"
but procurement authority remains unknown
```

System MUST NOT produce:

```text
agreement = confirmed
```

It SHOULD produce:

```text
Claim
Signal
AuthorityUnknown
Decision/Observation Move
```

---

# 181. Adversarial Acceptance Test: Incident

Scenario:

```text
impact doubles during investigation
```

System MUST support:

```text
priority escalation
preemption
suspension of lower-priority Attempt
emergency Move
later reevaluation of suspended work
```

---

# 182. Adversarial Acceptance Test: Research

Scenario:

```text
three experiments disprove hypothesis
```

System MUST allow:

```text
Intent LEARN = satisfied
Hypothesis = rejected
Project outcome != failed
```

---

# 183. Adversarial Acceptance Test: Physical Logistics

Scenario:

```text
inventory lot splits into used/defective/remaining quantities
```

System MUST model entity transformation/splitting without forcing one scalar object status.

---

# 184. Adversarial Acceptance Test: Context

Scenario:

```text
Claude session hits compaction
then /clear
then resumes in new session
```

Process MUST preserve:

```text
Move
Attempt or successor Attempt
decisions
constraints
evidence
failed approaches
process history
```

without relying on original transcript continuity.

---

# 185. Adversarial Acceptance Test: Cloud Failure

Scenario:

```text
Control Plane unavailable
Claude continues work
```

MUST demonstrate:

```text
local event queue
cached policy enforcement
no duplicate canonical events after reconnect
projection repair
```

---

# 186. Adversarial Acceptance Test: Human/AI Race

Scenario:

```text
human edits Move revision 7
Claude edits same Move revision 7
```

MUST produce:

```text
one accepted revision 8
one revision conflict
explicit reconciliation
```

Never silent overwrite.

---

# 187. Adversarial Acceptance Test: Stale Evidence

Scenario:

```text
tests pass
commit changes
```

MUST automatically transition:

```text
Evidence(valid)
→ Evidence(stale)

verification(passed)
→ verification(pending/stale)
```

where configured by scope semantics.

---

# 188. Adversarial Acceptance Test: Unsupported Claude Feature

Scenario:

```text
Channels unavailable
cross-session messaging disabled
```

Core process execution and steering MUST continue through stable fallback mechanisms.

---

# 189. Explicit Non-Goals

Universal Process OS SHALL NOT:

1. make Claude Code its canonical database;
2. require a permanently alive Claude conversation;
3. treat every domain concept as a task;
4. treat every AI statement as truth;
5. require full transcript synchronization;
6. depend on preview Claude features for correctness;
7. implement a competing Claude background supervisor;
8. expose arbitrary remote shell execution through the control plane;
9. force every process into Kanban;
10. force users to understand internal orchestration machinery.

---

# 190. Final Technical Contract

The canonical closed loop is:

```text
CASE STATE
   │
   ▼
CONTROLLERS
   │
   ▼
NEEDS / OPPORTUNITIES
   │
   ▼
MOVES
   │
   ▼
EXECUTION PLAN
   │
   ▼
ATTEMPTS
   │
   ├──── Human
   ├──── Claude
   ├──── API
   └──── Other executor
   │
   ▼
EVENTS + EVIDENCE
   │
   ▼
EVENT LEDGER
   │
   ▼
DERIVED CASE STATE
```

Claude-specific execution is:

```text
MOVE
 ↓
ATTEMPT
 ↓
Execution Compiler
 ↓
Claude strategy
 │
 ├─ current session
 ├─ fresh session
 ├─ background session
 ├─ subagent
 ├─ Agent Team
 ├─ Dynamic Workflow
 └─ worktree-isolated execution
 ↓
Claude native events
 ↓
Process Edge
 ↓
Universal Events / Evidence
```

Human control is:

```text
KANBAN / ATTENTION / GRAPH
 ↓
SEMANTIC COMMAND
 ↓
CASE RUNTIME
 ↓
POLICY / REVISION / SAFETY CHECK
 ↓
EVENT
 ↓
EXECUTION COMMAND if needed
 ↓
PROCESS EDGE
 ↓
CLAUDE / HUMAN / EXTERNAL EXECUTOR
```

Context continuity is:

```text
PROCESS MEMORY
 ↓
CONTEXT SELECTION
 ↓
CONTEXT CAPSULE
 ↓
CLAUDE SESSION

session may:
  compact
  clear
  terminate
  resume
  fork
  rotate

PROCESS MEMORY SURVIVES
```

The strongest technical invariant remains:

> **The Case is durable. Everything used to execute it is replaceable.**

And the strongest user-experience invariant remains:

> **The system absorbs complexity so the human can see, understand and steer the work without becoming the orchestration engine personally.**

That is the technical system we build.