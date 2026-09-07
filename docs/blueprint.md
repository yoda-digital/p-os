# Universal Process OS
## Architecture Blueprint

**Status:** Canonical Architecture Blueprint  
**Depends on:** `vision.md`  
**Next documents:** `specs_design.md`, `implementation_plan.md`  
**Architecture baseline:** September 2026  
**Primary first-class runtime:** Claude Code  
**Primary human control surface:** `ai-kanban.yoda.digital`  
**Distribution model:** Claude Code marketplace plugin + centralized control plane + optional managed runner

---

# 0. Purpose of This Document

This document defines the architecture of Universal Process OS.

It answers:

- what the system is made of;
- where canonical truth lives;
- how processes are represented;
- how humans and agents interact with them;
- how Claude Code integrates without becoming the ontology;
- how Kanban remains fully interactive while remaining a projection;
- how live steering works;
- how context and session lifecycle are managed;
- how arbitrary domains are supported;
- how organizational multi-user operation works;
- how autonomy and governance coexist;
- how the system remains secure;
- how the product can be extraordinarily capable while remaining extraordinarily easy to install.

This document intentionally does **not** freeze:

- exact database schemas;
- complete REST/WebSocket contracts;
- exact UI component design;
- implementation language choices for every component;
- migration sequencing;
- sprint breakdowns.

Those belong in `specs_design.md` and `implementation_plan.md`.

---

# 1. Architectural Thesis

Universal Process OS consists of four principal planes:

```text
┌─────────────────────────────────────────────────────────────┐
│                    EXPERIENCE PLANE                         │
│                                                             │
│ Kanban · Attention · Graph · Timeline · Evidence · Search  │
│ Decisions · Agents · Compliance · Analytics · WHY          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     CONTROL PLANE                           │
│                                                             │
│ Universal Case Runtime · Policies · Controllers · Routing  │
│ Event Ledger · Projections · Context Intelligence          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                         semantic commands
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     EXECUTION PLANE                         │
│                                                             │
│ Claude Code · Humans · APIs · CI · Pi · Codex · Systems    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                         events/evidence
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      REALITY PLANE                          │
│                                                             │
│ Files · Repositories · Email · Documents · Sensors · ERP   │
│ External authorities · People · Physical world · Services  │
└─────────────────────────────────────────────────────────────┘
```

The key dependency direction is:

```text
Process semantics
      ↓
execution strategy
      ↓
executor-specific implementation
```

Never:

```text
Claude feature
      ↓
invent corresponding process concept
```

Claude Code is the most deeply integrated execution runtime.

It is not the model of the world.

---

# 2. Top-Level Product Architecture

The system consists of:

```text
                         USERS
                           │
                           ▼
               ┌───────────────────────┐
               │ ai-kanban.yoda.digital│
               │                       │
               │ Universal Control     │
               │ Plane + Cockpit       │
               └───────────┬───────────┘
                           │
               HTTPS / WSS │ semantic protocol
                           │
       ┌───────────────────┼────────────────────┐
       │                   │                    │
       ▼                   ▼                    ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│ Process Edge│      │ Process Edge│      │ Process Edge│
│ machine A   │      │ machine B   │      │ machine C   │
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │                    │                    │
       ▼                    ▼                    ▼
 Claude Code           Claude Code           Claude Code
 Humans / APIs         CI / tools            other runtime
```

Optional:

```text
Process Edge
     │
     ▼
Managed Runner
     │
     ├─ launch Claude
     ├─ resume Claude
     ├─ fork session
     ├─ rotate context
     └─ background execution
```

---

# 3. Core Architectural Boundaries

The following boundaries are hard.

## 3.1 Process truth vs execution truth

Canonical:

```text
Move M-42
```

Execution-specific:

```text
Attempt A-17
Claude Session S-81
Claude Task T-14
Subagent SA-3
Worktree WT-8
```

A Move survives all of these.

---

## 3.2 Case state vs UI state

Canonical:

```text
Case
Entities
Assertions
Rules
Moves
Events
Evidence
```

Projection:

```text
Kanban column
red badge
progress percentage
dependency graph
risk dashboard
```

Dragging a card does not mutate arbitrary state directly.

It issues a semantic command to the Case Runtime.

---

## 3.3 Capability vs authority

An executor may technically be able to perform an action while being explicitly unauthorized to perform it.

```text
Claude:
capability = HIGH

Process policy:
authority = DENIED
```

Authority wins.

---

## 3.4 Process memory vs model context

Canonical process memory may be extremely large.

A model sees only a selected Context Capsule.

```text
Process Memory
     │
     │ retrieval
     ▼
Context Capsule
     │
     ▼
Claude Context Window
```

---

## 3.5 Stable platform integration vs experimental acceleration

Stable Claude capabilities form the baseline.

Experimental/research-preview capabilities may enhance the experience but must never be single points of architectural failure.

For example, Claude Channels can push events directly into an already-running session, but Channels remain a research-preview feature with rollout and allowlisting constraints. They are therefore an optional low-latency delivery mechanism, never the only steering mechanism.

---

# 4. The Universal Semantic Kernel

The kernel should remain intentionally small.

The canonical primitives are:

```text
Case
Entity
Relation
Event
Assertion
Intent
Rule
Actor
Move
Attempt
Evidence
Resource
Decision
```

Some of these may ultimately be implemented through shared lower-level primitives, but they remain distinct semantic concepts at the product level.

---

# 5. Case

`Case` is the aggregate boundary for an evolving process situation.

Examples:

```text
Release v2.4
Tender UNDP-2026-44
Investigate Procurement X
Client ACME Negotiation
Production Incident INC-143
Research Hypothesis H17
```

A Case owns or references:

```text
Intents
Entities
Relations
Assertions
Rules
Actors
Moves
Attempts
Evidence
Decisions
Events
Resources
Views
Policies
```

A Case can be:

- short-lived;
- indefinite;
- dormant;
- reopened;
- forked;
- related to other Cases;
- hierarchical;
- cross-project;
- cross-department.

A Case is not synonymous with a project.

---

# 6. Organization, Workspace, Project, Case

The organizational model must not be a rigid tree.

Recommended conceptual model:

```text
Organization
 ├─ Workspaces
 ├─ Organizational Units
 ├─ Teams
 ├─ Users
 └─ Service Actors

Project
Case
Process Pack
Resource
```

Relations define membership:

```text
User MEMBER_OF Team
User MEMBER_OF Department
Case BELONGS_TO Project
Case INVOLVES Team
Case OWNED_BY Workspace
User HAS_ROLE Reviewer IN Case
```

This supports matrix organizations naturally.

A process may cross:

```text
Sales
→ Legal
→ Delivery
→ Finance
```

without being cloned into four disconnected boards, humanity having suffered enough from that particular ritual.

---

# 7. Intent Model

A Case may contain multiple simultaneous Intents.

Intent classes include at minimum:

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

An Intent contains:

```text
owner
priority
success semantics
failure semantics
stopping semantics
constraints
dependencies
conflicts
confidence
time horizon
```

Intents may conflict.

Example:

```text
maximize proposal quality
minimize preparation cost
submit before deadline
avoid unsupported claims
```

The runtime must not assume these collapse into one scalar objective.

---

# 8. Entity and Relation Graph

Entities represent meaningful objects.

Relations connect them.

Example:

```text
Requirement R-17
    REQUIRES
Document D-8

Document D-8
    PRODUCED_BY
Move M-22

Evidence E-91
    SUPPORTS
RequirementSatisfaction RS-17
```

Relations may have:

```text
type
direction
validity interval
source
confidence
metadata
```

This gives us an object-centric representation usable across domains.

---

# 9. Epistemic Model

Knowledge must remain explicitly typed.

The system distinguishes:

```text
Observation
Claim
Belief
Hypothesis
Inference
Evaluation
VerifiedAssertion
Unknown
Contradiction
Retraction
```

Every Assertion may specify:

```text
subject
predicate
object/value
modality
source
provenance
confidence
valid_from
valid_until
observed_at
scope
```

The kernel must support conflicting Assertions simultaneously.

Example:

```text
Claim C1:
Supplier says delivery takes 30 days.

Observation O3:
Historical median is 48 days.

Belief B4:
30-day delivery appears unlikely.
confidence = 0.78
```

No premature collapse into one `delivery_days = 30`.

---

# 10. Evidence Model

Evidence is a first-class semantic object.

Evidence may:

```text
SUPPORT
CONTRADICT
VERIFY
INVALIDATE
ESTABLISH_PROVENANCE
ESTABLISH_AUTHORITY
ESTABLISH_COMPLIANCE
```

Evidence must be context-sensitive.

Example:

```text
E-1:
test suite passed
scope = commit abc123
```

When release HEAD changes:

```text
abc123 → def456
```

the system may derive:

```text
E-1 stale for current-release verification
```

Evidence invalidation should trigger downstream recalculation.

---

# 11. Rule and Governance Model

Rules model normative constraints.

Categories include:

```text
Requirement
Obligation
Prohibition
Permission
Policy
Deadline
Invariant
ApprovalRule
RetentionRule
SafetyRule
BudgetRule
SeparationOfDuties
```

Rule evaluation may produce:

```text
SATISFIED
UNSATISFIED
UNKNOWN
WAIVED
NOT_APPLICABLE
VIOLATED
AT_RISK
```

Rules may have:

```text
authority source
scope
effective date
expiration
version
supersession
exceptions
waivers
```

A changed Rule may invalidate downstream process state.

---

# 12. Actor Model

Actor types:

```text
Human
AI Agent
Team
Organization
External Authority
Software Service
Executor Runtime
```

Actor properties:

```text
identity
roles
capabilities
authority
permissions
availability
cost profile
trust level
jurisdiction
delegations
```

Actors may participate differently in different Cases.

---

# 13. Move Model

`Move` is the primary unit of intentional process intervention.

Generic classes:

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

A Task is a specialization of `ACT`.

A Move may define:

```text
objective
preconditions
postconditions
required capabilities
required authority
expected evidence
constraints
deadline
priority
risk
resource needs
cost limits
context needs
executor policy
```

Move lifecycle is richer than a single scalar task status.

---

# 14. Move State Vector

Canonical Move state is multidimensional.

Example:

```text
readiness: READY
execution: RUNNING
verification: PENDING
attention: AUTONOMOUS
risk: MEDIUM
temporal: ON_TRACK
outcome: UNSATISFIED
```

Possible execution values:

```text
NOT_STARTED
QUEUED
RUNNING
PAUSED
SUSPENDED
FINISHED
```

Possible terminal semantics may include:

```text
SATISFIED
CANCELLED
SUPERSEDED
ABANDONED
EXPIRED
NOT_APPLICABLE
FAILED
```

These must not be collapsed into `DONE`.

---

# 15. Attempt Model

A Move can have zero or many Attempts.

Example:

```text
Move M42
│
├─ Attempt A1 → failed approach
├─ Attempt A2 → superseded after steering
└─ Attempt A3 → succeeded
```

Attempt contains execution-specific information:

```text
executor
runtime
session references
agent references
worktree
model
effort
start/end
cost
token use
results
failure reason
produced artifacts
produced evidence
steering history
```

This cleanly separates:

> what must happen

from:

> this particular attempt to make it happen.

---

# 16. Event-Sourced Canonical History

Every meaningful state change produces an immutable Event.

Examples:

```text
CaseCreated
IntentDeclared
EntityCreated
EntityObserved
RelationAdded
AssertionAdded
AssertionRetracted
RuleAdded
RuleSuperseded
MoveCreated
MoveActivated
MovePaused
MoveCancelled
MoveSuperseded
AttemptStarted
AttemptFailed
AttemptSucceeded
EvidenceAttached
EvidenceInvalidated
DecisionRequested
DecisionMade
HumanSteeringIssued
AgentSteeringIssued
ContextRotated
SessionStarted
SessionEnded
ExternalEventObserved
```

Events contain at least:

```text
event_id
tenant_id
case_id
type
actor_id
occurred_at
recorded_at
causation_id
correlation_id
target_refs[]
payload
provenance
```

Current state is projection:

```text
CaseState = fold(EventStream)
```

No UI operation bypasses the event model.

---

# 17. Causality

Every system-generated action must be traceable.

Example:

```text
ClarificationReceived E101
      ↓ caused
RuleSuperseded E102
      ↓ invalidated
EvidenceInvalidated E103
      ↓ caused
ComplianceUnsatisfied E104
      ↓ caused
MoveGenerated E105
```

This powers:

```text
WHY?
Time Travel
Audit
Process Mining
Debugging
Impact Analysis
```

---

# 18. Controllers

Controllers continuously evaluate Cases.

Controllers are specialized, composable mechanisms.

Core controllers:

```text
Intent Controller
Dependency Controller
Evidence Controller
Completion Controller
Rule/Compliance Controller
Deadline Controller
Risk Controller
Resource Controller
Attention Controller
Context Controller
Execution Controller
Cost Controller
Drift Controller
```

They consume Events and produce:

```text
derived state
recommendations
new Moves
warnings
semantic commands
```

Controllers must be individually inspectable.

Avoid one god-agent called:

```text
ProjectManagerGPT
```

with 74 pages of prompt constitution.

---

# 19. Deterministic vs AI Controllers

Controllers explicitly declare their reasoning class.

## Deterministic

Examples:

```text
deadline exceeded
dependency unresolved
required signature missing
budget threshold exceeded
```

## Semantic / AI-assisted

Examples:

```text
evidence appears contradictory
scope drift likely
task decomposition inadequate
context has become polluted
process structure likely inefficient
```

AI outputs are typed:

```text
recommendation
confidence
reasoning summary
evidence references
```

and are never silently promoted to facts.

---

# 20. Process Reconciliation

Reconciliation remains a major mechanism, but not the universal process ontology.

Useful for:

```text
ACHIEVE
MAINTAIN
RECOVER
COMPLY
```

Example:

```text
Desired:
production healthy

Observed:
error rate high

Controller:
generate mitigation Move
```

For:

```text
EXPLORE
LEARN
NEGOTIATE
CREATE
```

other controller families dominate.

Therefore architecture is:

```text
Case
 ↓
Controllers / Reasoners
 ↓
Needs / Opportunities
 ↓
Moves
```

not:

```text
Desired State
 ↓
one universal reconciler
 ↓
Tasks
```

---

# 21. Completion Engine

Completion is derived.

A Move may specify a Completion Contract.

Example:

```text
require:
  evidence(test-suite-pass)
  evidence(api-compatible)
  approval(security-review)
```

Completion Engine evaluates:

```text
SATISFIED
UNSATISFIED
UNKNOWN
BLOCKED
WAIVED
```

An Attempt ending does not automatically satisfy the Move.

---

# 22. Human Override

Humans with sufficient authority may override derived restrictions.

Example:

```text
Move cannot activate:
dependency R17 unresolved
```

Authorized user selects:

```text
FORCE ACTIVATE
```

System requires:

```text
reason
risk acknowledgement
authority check
```

and records:

```text
HumanOverride
```

Overrides never erase the underlying violation.

---

# 23. Kanban Architecture

Kanban is a first-class bidirectional projection.

Default universal operational board:

```text
BACKLOG
READY
ACTIVE
WAITING
NEEDS INPUT
VERIFY
DONE
```

Domain packs may customize projections.

A Kanban column is defined as a query over state.

Example:

```text
READY :=
readiness == READY
AND execution == NOT_STARTED
```

Not:

```text
row.status = "ready"
```

This distinction is fundamental.

---

# 24. Kanban Commands

User operations produce semantic commands.

Examples:

```text
CreateMove
EditMove
RequestActivation
PauseMove
ResumeMove
CancelMove
SupersedeMove
ReprioritizeMove
AssignExecutor
AddDependency
RemoveDependency
ChangeDeadline
AttachEvidence
AddConstraint
ForkMove
RequestVerification
```

The Control Plane validates:

```text
authority
policy
version
preconditions
risk
```

before appending Events.

---

# 25. Live Steering

Active Attempts can be steered.

Steering classes:

## Advisory

```text
Consider checking X.
```

## Constraint

```text
Do not modify schema.
```

## Redirect

```text
Abandon Redis approach.
Use PostgreSQL.
```

## Pause

Suspend at safe point.

## Hard Stop

Terminate current Attempt.

## Fork

Continue current approach while launching alternative.

## Reassign

Transfer Move or new Attempt to another executor.

Every steering action creates a versioned Event.

---

# 26. Steering Delivery Model

Steering must have layered delivery.

## Tier A: stable safe-point delivery

Plugin/edge receives pending steering.

Hooks deliver or enforce it at controlled lifecycle points.

Claude hooks currently support command, HTTP, MCP-tool, prompt-based, and experimental agent-based handlers depending on event type. Events such as `PreToolUse`, `Stop`, `TaskCreated`, `TaskCompleted`, and `TeammateIdle` can participate in control decisions.

This is the baseline.

---

## Tier B: real-time channel delivery

Where available and authorized:

```text
Control Plane
→ Process Channel
→ active Claude session
```

Because Channels remain research preview, this is acceleration only.

---

## Tier C: runner-level interruption

For hard stop:

```text
Control Plane
→ Process Edge
→ Managed Runner
→ terminate/suspend execution
```

This is operational control, not semantic conversation steering.

---

# 27. Claude Code Integration Strategy

The Claude plugin should be deeply native.

Claude plugins can currently package:

```text
skills/
agents/
hooks/
.mcp.json
.lsp.json
monitors/
bin/
settings.json
```

with plugin distribution designed for reusable team/community installation.

Our plugin should use that architecture rather than wrap Claude in an entirely separate harness.

---

# 28. Proposed Plugin Package

Conceptual layout:

```text
universal-process/
│
├─ .claude-plugin/
│  └─ plugin.json
│
├─ skills/
│  ├─ process/
│  ├─ process-status/
│  ├─ process-steer/
│  ├─ process-context/
│  ├─ process-why/
│  └─ process-import/
│
├─ agents/
│  ├─ process-architect.md
│  ├─ process-guardian.md
│  └─ evidence-verifier.md
│
├─ hooks/
│  └─ hooks.json
│
├─ monitors/
│  └─ monitors.json
│
├─ .mcp.json
│
└─ bin/
   └─ process-edge
```

Exact names remain provisional.

---

# 29. Process MCP

The plugin-bundled MCP server exposes structured process operations to Claude.

Categories:

```text
Case discovery
Move discovery
Context retrieval
Move creation/proposal
Evidence registration
Decision requests
Process WHY
Agent coordination
Steering acknowledgement
Execution reporting
```

Claude interacts with semantic tools.

It should not manipulate database internals.

---

# 30. Hook Integration

Use hooks for synchronization, governance, context lifecycle, and reliable interception.

High-value events include:

```text
SessionStart
UserPromptSubmit
PreToolUse
PostToolUse
PostToolUseFailure
PostToolBatch
TaskCreated
TaskCompleted
SubagentStart
SubagentStop
TeammateIdle
WorktreeCreate
WorktreeRemove
FileChanged
CwdChanged
PreCompact
PostCompact
PreModelSwitch
PostModelSwitch
Stop
SessionEnd
```

Claude currently exposes explicit `TaskCreated` and `TaskCompleted` hooks, with `TaskCompleted` designed to support enforcing completion criteria.

---

# 31. Native Claude Tasks

Claude-native tasks remain valuable execution primitives.

Current Agent Team tasks expose:

```text
pending
in progress
completed
```

plus dependencies.

Because this state model is intentionally simple, it must not become canonical Process OS state.

Mapping:

```text
Move
  ↓
Attempt
  ↓
Claude native task(s)
```

A Move may map:

```text
1 → 1
1 → N
N → 1 workflow
or no Claude task at all
```

---

# 32. Claude Agent Teams

Use Agent Teams when:

- peers require independent contexts;
- agents need direct collaboration;
- work benefits from peer challenge;
- information must flow laterally rather than only through a parent.

Do not use teams merely because parallelism exists.

Team coordination overhead is real.

Process OS chooses teams based on topology and expected benefit.

---

# 33. Dynamic Workflows

Use Dynamic Workflows for structured orchestration such as:

```text
fan-out / fan-in
map-reduce research
large migrations
independent audits
multi-source verification
repetitive parallel work
```

The current runtime supports paused runs and replay/resume behavior within session-associated saved workflow state.

Workflow runtime state is Attempt execution state, not Process OS truth.

---

# 34. Cross-Session Messaging

Where enabled, use Claude's native cross-session communication rather than inventing duplicate peer messaging.

Use cases:

```text
dependency notification
finding handoff
contract change notification
peer question
agent result broadcast
```

Cross-session messaging has explicit administrative inbound/outbound controls, so capability detection and policy compatibility are mandatory.

---

# 35. Background Monitors

Claude plugin monitors can watch logs/files/external state and deliver notifications during active sessions automatically.

Use monitors for local event sources such as:

```text
test output
build logs
local files
service logs
repository state
```

The Process Edge converts relevant monitor activity into structured process Events.

---

# 36. Worktrees

A code-writing Attempt can own a worktree.

Process state tracks:

```text
Attempt
→ Worktree
→ Branch
→ Commits
→ Artifacts
→ Evidence
```

Worktree lifecycle hooks make creation/removal visible to the plugin.

Worktrees are execution isolation.

They are not Case branches.

A Case fork is semantic.

A Git worktree is operational.

---

# 37. Execution Compiler

The Execution Compiler maps Move semantics to executor strategy.

Input:

```text
Move
Context requirements
Risk
Capabilities
Authority
Dependencies
Parallelism
Communication topology
Budget
Deadline
Available executors
```

Output:

```text
ExecutionPlan
```

Possible strategies:

```text
same-session execution
fresh Claude session
subagent
Agent Team
Dynamic Workflow
background session
worktree-isolated session
human assignment
external API
wait/event trigger
mixed execution
```

---

# 38. Execution Plan Example

Input:

```text
Move:
Research 40 independent vendors
cross-check findings
budget moderate
time sensitive
```

Compiler:

```text
strategy:
dynamic workflow

fan-out:
vendor research agents

fan-in:
synthesis

verification:
independent adversarial reviewer
```

---

# 39. Capability Detection

Never assume all Claude features exist or are enabled.

At runtime maintain:

```text
ClaudeCapabilities {
  tasks
  hooks
  agent_teams
  dynamic_workflows
  cross_session_messaging
  channels
  background_sessions
  worktrees
  monitors
  agent_hooks
  ...
}
```

Execution Compiler selects only supported strategies.

Preview features must have fallback paths.

---

# 40. Context Orchestrator

Context orchestration is a core subsystem.

Responsibilities:

```text
monitor session context health
select relevant process memory
generate Context Capsules
hydrate sessions
handle resume deltas
prepare compaction checkpoints
validate post-compaction state
recommend or execute rotation
decide fresh vs resume vs fork
offload context-heavy work
prevent cross-Move contamination
```

---

# 41. Context Hierarchy

Conceptual memory hierarchy:

```text
Organization Memory
       ↓
Workspace Memory
       ↓
Project Memory
       ↓
Case Memory
       ↓
Move Memory
       ↓
Attempt Memory
       ↓
Session Context
```

Retrieval is selective.

Higher-level memory does not automatically flood lower-level context.

---

# 42. Context Capsule

A Context Capsule should contain structured sections:

```text
CASE
INTENT
CURRENT MOVE
CURRENT ATTEMPT

CURRENT REALITY
IMPORTANT ASSERTIONS
DECISIONS
CONSTRAINTS
POLICIES

COMPLETED WORK
FAILED APPROACHES
OPEN QUESTIONS
DEPENDENCIES

RELEVANT EVIDENCE
ARTIFACTS
FILES / REFERENCES

RECENT PROCESS DELTA
NEXT EXPECTED ACTIONS
DO NOT REPEAT
```

Capsules are generated from canonical Process state.

They are not merely transcript summaries.

---

# 43. SessionStart Hydration

Claude `SessionStart` hooks can inject additional context into the session, and current lifecycle metadata includes resume/fork details such as prior context size and stale-cache information.

Use this to:

```text
identify Case binding
load Context Capsule
inject delta since previous session activity
restore policies
restore Move ownership
```

---

# 44. Compaction Lifecycle

Claude exposes `PreCompact` and `PostCompact`; the latter includes the generated compact summary.

Process OS uses:

```text
PreCompact
→ semantic checkpoint

Claude compact
→ native summary

PostCompact
→ compare / validate

SessionStart(compact)
→ rehydrate critical missing state
```

Process continuity must not depend on the native compact summary being perfect.

---

# 45. Session Rotation

Context Orchestrator may decide:

```text
CONTINUE
COMPACT
ROTATE
FORK
OFFLOAD
```

based on:

```text
token pressure
semantic relevance density
stale assumptions
phase transition
tool-output pollution
number of pivots
contradiction density
remaining work
estimated future context need
```

Not:

```text
if context > 80%:
    panic()
```

---

# 46. Runner-Managed Session Lifecycle

Optional Process Runner allows managed session lifecycle.

Claude CLI supports resuming and forking sessions through official CLI mechanisms including `--resume` and `--fork-session`.

Managed mode therefore supports:

```text
start fresh
resume
fork
terminate
rotate
background execution
```

without terminal-input hacks.

---

# 47. Execution Modes

## Native Mode

User launches Claude manually.

System:

```text
observes
syncs
hydrates
advises
steers at safe points
```

---

## Assisted Mode

System recommends lifecycle actions.

Example:

```text
Context health degraded.

Recommended:
fresh session

[ROTATE]
[COMPACT]
[CONTINUE]
```

---

## Managed Mode

Runner controls session lifecycle.

System automatically:

```text
starts
rotates
forks
resumes
stops
```

---

## Autonomous Mode

Moves can be assigned and executed without an already-open interactive terminal.

---

# 48. Process Edge

`process-edge` is the local trust-boundary component.

Responsibilities:

```text
plugin ↔ control-plane transport
device authentication
event batching
offline queue
command validation
local cache
session binding
Claude capability discovery
runner coordination
privacy filtering
```

Default packaging should hide it inside the plugin experience.

Users should not install a daemon merely to synchronize a board.

---

# 49. Network Model

Prefer:

```text
local → cloud
```

outbound connections only.

Transport:

```text
HTTPS
WSS
```

No requirement for inbound ports on developer machines.

This minimizes:

```text
NAT issues
firewall friction
VPN friction
enterprise objections
```

---

# 50. Offline Behavior

Local execution must survive Control Plane unavailability.

Process Edge maintains:

```text
local event outbox
active Move cache
policy cache
pending control commands
session bindings
```

On reconnect:

```text
reconcile event stream
detect conflicts
apply valid pending commands
```

The system is central-authoritative but execution-resilient.

---

# 51. Command Security

The cloud must never send arbitrary shell commands.

Allowed command vocabulary is semantic:

```text
StartMove
SteerAttempt
PauseAttempt
CancelAttempt
AssignMove
ChangePriority
AddConstraint
RequestEvidence
RequestContextRotation
```

Process Edge validates:

```text
signature
device
tenant
actor
authority
target
expected version
nonce
expiration
policy
```

Only then maps semantic intent to local implementation.

---

# 52. Device Identity

Each installation receives a cryptographic identity.

Concept:

```text
Device
  id
  public_key
  user
  organization
  machine metadata
  capabilities
  trust status
  last seen
```

Private keys remain local.

Device revocation must be immediate.

---

# 53. Data Privacy Modes

At minimum:

## Metadata

Central stores structured process metadata only.

## Structured

Central stores Events, semantic summaries, evidence metadata.

## Rich

Central stores selected artifacts and richer execution data.

## Sovereign

Self-hosted organization deployment.

Per-Case overrides may be stricter than organization defaults.

---

# 54. Transcript Policy

Full Claude transcripts are **not required** for canonical Process OS behavior.

Default synchronization should favor:

```text
structured lifecycle events
summaries
references
evidence metadata
hashes
semantic state
```

Transcript ingestion is explicit and policy-controlled.

This reduces both security risk and organizational resistance.

---

# 55. Human Attention Engine

Attention Engine converts process complexity into a prioritized human queue.

Inputs:

```text
authority requirement
risk
deadline
blocking impact
uncertainty
business impact
number of downstream Moves
```

Output:

```text
CRITICAL
HIGH
MEDIUM
LOW
```

Example:

```text
CRITICAL:
Approve production rollback

HIGH:
Clarify tender requirement

MEDIUM:
Choose preferred architecture
```

The goal is not maximum notification.

It is minimum necessary interruption.

---

# 56. Decision Objects

Human decisions are first-class.

Decision contains:

```text
question
options
evidence
arguments
risks
tradeoffs
AI recommendation
confidence
authority
deadline
impact
chosen option
rationale
```

A Decision may block multiple Moves.

Decision history is durable.

---

# 57. Waiting

`WAIT` is first-class.

Wait conditions:

```text
date
external event
person response
document receipt
state transition
approval
webhook
schedule
```

Waiting is not automatically blocking failure.

A Case can be healthy while waiting.

---

# 58. External Event Gateway

Control Plane accepts external events from:

```text
GitHub
CI
email
messaging
ERP
CRM
webhooks
MCP-connected systems
custom integrations
```

Incoming events are normalized:

```text
ExternalEvent
→ semantic interpretation
→ Case Event
→ controller evaluation
```

AI extraction may propose interpretation.

Policy determines whether it is auto-accepted or needs confirmation.

---

# 59. Domain Packs

Domain packs define vocabulary and semantics.

Examples:

```text
software
procurement
journalism
legal
sales
research
logistics
publishing
```

A domain pack can provide:

```text
entity types
relation types
assertion types
rules
views
AI extraction prompts
default policies
domain validators
```

---

# 60. Process Packs

Process packs define behavioral archetypes.

Examples:

```text
investigation
incident
negotiation
review
approval
production
selection
monitoring
compliance
research
```

A Case composes both:

```text
procurement
+
compliance
+
production
+
approval
```

This is more powerful than rigid templates.

---

# 61. Pack Generation

Frontier models should reduce configuration ceremony.

Given user intent and existing artifacts, Process Architect may generate a proposed pack configuration.

Example:

```text
Detected:
procurement response

Suggested:
procurement domain
compliance process
document-production process
approval process
```

Human may accept, edit, or reject.

No 17-screen setup wizard.

---

# 62. View Compiler

View Compiler selects useful projections from Case semantics.

Examples:

Many:

```text
Claim + Evidence
```

→ Evidence Graph.

Many:

```text
Requirement + Rule
```

→ Compliance Matrix.

Many:

```text
parallel Moves
```

→ Kanban.

Many:

```text
Assets + Locations
```

→ Flow / location view.

This lets one kernel produce domain-native experiences.

---

# 63. Core Views

Platform should ultimately support:

```text
Attention
Kanban
Timeline
Dependency Graph
Knowledge / Evidence Graph
Decisions
Requirements / Compliance
Actors / Agents
Resources
Risks
Calendar / Deadlines
Analytics
Process Drift
Time Travel
```

Not every Case exposes every view.

---

# 64. Universal Search / Command Surface

Natural language query over Process state:

```text
What requires me today?

Why is Release 2.4 blocked?

Show requirements with weak evidence.

What changed since Friday?

Which Claude sessions are working on critical Moves?

Which commitments are overdue?

What would slip if Maria is unavailable?
```

Results remain grounded in structured Case data.

---

# 65. WHY Engine

Every derived state should expose a causal explanation.

Input:

```text
WHY(Move M42, BLOCKED)
```

Output:

```text
M42 requires R17.
R17 requires approval A9.
A9 is unresolved.
A9 belongs to Maria.
Therefore M42 cannot activate.
```

Links should permit traversal to every underlying event/evidence object.

---

# 66. Time Travel

Because the Event Ledger is canonical:

```text
state_at(t)
```

can reconstruct:

```text
board
rules
assertions
evidence
agents
Moves
risks
decisions
```

at any historical point.

Time travel is read-only.

Branch simulation is separate.

---

# 67. Process Forking and Simulation

The system should eventually support:

```text
Fork Case at Event E101
```

and simulate alternative assumptions.

Example:

```text
What if deadline moves forward 48 hours?

What if only one senior engineer is available?

What if we choose proposal strategy B?
```

Simulation state never contaminates canonical Case truth until explicitly adopted.

---

# 68. AI Process Architect

Specialized meta-agent.

Responsibilities:

```text
initial Case structuring
Move decomposition
process topology analysis
process pack generation
parallelization opportunities
bottleneck detection
process improvement proposals
simulation assistance
```

Architect does not automatically gain authority to execute all recommendations.

---

# 69. AI Process Guardian

Separate specialized agent/controller.

Responsibilities:

```text
scope drift
missing evidence
stale evidence
policy violations
unsafe autonomy
deadline risk
duplicate work
loops
agent conflicts
unresolved assumptions
```

Architect optimizes.

Guardian protects.

Executor executes.

Keep these roles separate.

---

# 70. Evidence Verifier

Dedicated verifier can validate completion requirements.

Depending on requirement:

```text
deterministic tool
Claude prompt hook
Claude agent hook
human reviewer
external system
```

Claude currently supports prompt-based hook decisions and experimental agent-hook verification with tool access; production policies should prefer deterministic mechanisms wherever possible, because agent hooks remain experimental.

---

# 71. Autonomy Policy

Case autonomy profile:

```text
OBSERVE
SUGGEST
OPERATE
AUTONOMOUS
```

Rather than one global switch, authority may vary by action class.

Example:

```text
Claude may:
create low-risk Moves
reprioritize own subtasks
spawn subagents

Claude may not:
approve spending
delete Case
override security policy
submit tender
```

This is far more useful than `agent_mode=true`.

---

# 72. Budget and Cost Governance

Track:

```text
tokens
model
effort
agent count
runtime
monetary cost where available
cost by Move
cost by Case
cost by team
```

Policies:

```text
Move max budget
Case max budget
model restrictions
parallelism cap
approval threshold
```

Execution Compiler incorporates cost into strategy.

---

# 73. Model / Effort Routing

When runtime supports it, strategy can choose model/effort according to:

```text
complexity
uncertainty
risk
expected value
budget
latency
```

Mechanical work need not consume highest-cost reasoning.

High-risk architecture should not be delegated to a cheap classifier merely because an accountant discovered tokens.

Human override remains available.

---

# 74. Organizational Process Intelligence

Historical Event streams enable:

```text
cycle time
waiting time
human attention time
rework
failed attempts
critical paths
evidence gaps
autonomy effectiveness
cost
executor performance
process drift
```

The key metric is not:

```text
tasks completed
```

but increasingly:

```text
outcomes achieved
with what evidence,
cost,
risk,
human effort,
and process friction
```

---

# 75. Process Mining

Compare:

```text
designed process
```

with:

```text
observed execution history
```

Detect:

```text
steps always added manually
dead steps
recurring loops
common failure points
implicit dependencies
approval bottlenecks
rework patterns
```

Process Architect proposes new pack versions.

Human approves structural evolution.

---

# 76. Installation Experience

Target:

```text
ONE COMMAND
     ↓
LOGIN
     ↓
USE CLAUDE NORMALLY
```

Marketplace distribution is the correct Claude-native delivery model because plugins are explicitly designed for reusable distribution across teams and community installations.

The user should not manually configure:

```text
hooks
MCP
WebSocket
machine identity
Case binding
repository mapping
```

unless automatic inference fails.

---

# 77. First-Run Experience

Plugin starts.

It detects:

```text
repository
remote
project
cwd
existing tasks
Claude session
organization
available features
```

Potential output:

```text
Universal Process connected.

Detected:
Project: undp-dwh
Repository: yoda/undp-dwh
Current branch: main

I created the initial process view
from your active work.
```

Useful state exists immediately.

---

# 78. Existing Process Discovery

System may infer current work from:

```text
Claude tasks
repository structure
git status
issue references
CLAUDE.md
project docs
connected systems
explicit user intent
```

Inference produces proposals.

Never silently invent authoritative requirements.

---

# 79. Imports

Long-term import paths:

```text
Jira
Linear
Trello
GitHub Issues
CSV
Notion
documents
existing Claude tasks
```

Import pipeline:

```text
raw source
→ semantic extraction
→ proposed Cases / Moves / relations
→ ambiguity review
→ canonical import
```

---

# 80. Mobile / PWA Control Surface

Mobile experience prioritizes:

```text
attention
approve
reject
steer
comment
attach evidence
pause
stop
assign
WHY
```

Not full desktop process modeling.

Example notification:

```text
Claude needs your decision.

Two architecture options remain.
Option A recommended.

[Review]
```

---

# 81. Notifications

Notifications should be semantic.

Bad:

```text
Task 541 updated.
```

Good:

```text
Tender submission is at risk.

Financial approval is now on
the critical path and is due in 6h.
```

Attention Controller determines notification necessity.

---

# 82. Collaboration

Core collaboration:

```text
comments
threads
mentions
watchers
attachments
reactions
activity feed
```

Comments can trigger semantic suggestions.

Example:

```text
@Claude recheck this requirement
```

may produce a proposed verification Move.

---

# 83. Concurrency and Versioning

Human and agent may edit the same object concurrently.

Commands should carry expected revision.

Concept:

```text
UpdateMove
target_version = 17
```

If canonical is 18:

```text
CONFLICT
```

System can:

```text
merge
rebase
refresh
authorized force override
```

Never default to silent last-write-wins for process semantics.

---

# 84. Deletion Semantics

Canonical historical objects are not physically deleted through normal UI operations.

User-facing Delete maps to context-dependent semantics:

```text
REMOVE_FROM_VIEW
CANCEL
SUPERSEDE
VOID
ARCHIVE
```

Hard physical deletion exists only for:

```text
retention policy
privacy/legal deletion
administrative repair
```

and must preserve auditable tombstone semantics where legally permitted.

---

# 85. API / Extension Philosophy

Everything the first-party UI can do should eventually be expressible through stable semantic APIs.

External integrations should operate on:

```text
Cases
Moves
Events
Evidence
Decisions
Actors
```

not internal database rows.

Executor adapters should conform to a universal executor contract.

---

# 86. Universal Executor Contract

Conceptual lifecycle:

```text
discover capabilities
accept execution request
start Attempt
report progress
receive steering
emit Events
emit Evidence
pause / resume
finish Attempt
cancel
```

Claude Code implements this contract deeply.

Other runtimes can implement subsets.

---

# 87. Human Executor

Humans are first-class executors.

Human Move appears in:

```text
My Work
Attention
Kanban
Calendar
```

Human completion is still subject to evidence/governance if required.

AI does not get superior ontological status merely because it emits more JSON.

---

# 88. Process Health

Case health should be multidimensional:

```text
Outcome Health
Schedule Health
Evidence Health
Risk Health
Resource Health
Knowledge Health
Attention Debt
Automation Health
Cost Health
```

A composite health score may exist as convenience.

It must remain explainable.

---

# 89. Critical-Path and Impact Analysis

Dependency graph plus timing/resource information enables:

```text
critical path
downstream impact
deadline risk
resource contention
```

Changing a Move may immediately answer:

```text
What will this delay?
```

This is substantially more valuable than merely moving its card.

---

# 90. Universal Architecture Diagram

```text
                           HUMAN / AI
                               │
                               ▼
                     ┌───────────────────┐
                     │ EXPERIENCE PLANE  │
                     │                   │
                     │ Kanban Attention  │
                     │ Graph WHY Search  │
                     └─────────┬─────────┘
                               │
                         semantic commands
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    CONTROL PLANE                            │
│                                                             │
│  ┌───────────────┐      ┌──────────────────────────────┐   │
│  │ CASE RUNTIME  │◄────►│ EVENT LEDGER / PROJECTIONS   │   │
│  └───────┬───────┘      └──────────────────────────────┘   │
│          │                                                  │
│  ┌───────▼───────────────────────────────────────────────┐ │
│  │ CONTROLLERS                                           │ │
│  │ Intent Evidence Policy Risk Deadline Context Cost ... │ │
│  └───────┬───────────────────────────────────────────────┘ │
│          │                                                  │
│  ┌───────▼──────────┐      ┌────────────────────────────┐ │
│  │ EXECUTION        │      │ VIEW COMPILER             │ │
│  │ COMPILER         │      │ PROCESS INTELLIGENCE      │ │
│  └───────┬──────────┘      └────────────────────────────┘ │
└──────────┼─────────────────────────────────────────────────┘
           │
       Command Bus
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXECUTION EDGES                          │
│                                                             │
│ Claude Edge   Human Edge   API Edge   Future Agent Edges   │
└───────┬─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                     CLAUDE CODE                             │
│                                                             │
│ MCP · Hooks · Skills · Agents · Tasks · Teams · Workflows  │
│ Worktrees · Messaging · Monitors · Context lifecycle       │
└─────────────────────────────────────────────────────────────┘
```

---

# 91. Deployment Blueprint

## SaaS Control Plane

```text
ai-kanban.yoda.digital

Web App
API Gateway
Realtime Gateway
Auth
Case Runtime
Command Service
Event Service
Projection Service
Policy Service
Context Intelligence
Execution Scheduler
Process Intelligence
Notification Service
Integration Gateway
```

---

## Data Layer

Conceptually:

```text
Transactional Store
Append-only Event Store
Projection Store
Search Index
Object/Artifact Store
Optional vector/semantic index
```

The exact database choices belong in `specs_design.md`.

Do not adopt distributed infrastructure merely because architecture diagrams become more photogenic.

---

## Local

```text
Claude Plugin
Process MCP
Process Edge
Local Cache
Offline Outbox
Optional Runner
```

---

# 92. Reliability Principles

## Cloud unavailable

Claude continues locally where policy permits.

## Local machine unavailable

Moves remain canonical and may be reassigned.

## Claude crashes

Attempt fails/interruption recorded.

Move survives.

## Session disappears

Process survives.

## Context compacted badly

Process Context Capsule restores canonical state.

## Agent hallucinates completion

Completion Engine rejects unsupported state.

## Human changes requirements

Historical version remains visible.

## External requirement changes

Impact propagation recalculates affected state.

---

# 93. Security Principles

1. Central server never receives implicit arbitrary shell authority.
2. Semantic commands only.
3. Local trust boundary enforces execution.
4. Device identities are revocable.
5. Authorization checked server-side and edge-side where relevant.
6. Sensitive content synchronized minimally by default.
7. Executor capabilities are explicitly registered.
8. Preview Claude capabilities never bypass organization policy.
9. Every privileged override is audited.
10. No hidden agent process mutations.

---

# 94. Product Invariants

## P-01

The Case is durable.

## P-02

Tasks are not canonical process truth.

## P-03

Kanban is first-class but remains a projection.

## P-04

Kanban is bidirectional and operational.

## P-05

Humans can steer active work.

## P-06

Agents can propose or perform process changes within explicit authority.

## P-07

Completion requires evidence according to policy.

## P-08

Conversation context is disposable.

## P-09

Process context is durable.

## P-10

Claude Code is a first-class executor, not the ontology.

## P-11

Every important state is explainable.

## P-12

Every structural mutation is causal and versioned.

## P-13

External events may change the process without tasks running.

## P-14

Waiting is legitimate.

## P-15

A failed Attempt does not imply failed work.

## P-16

Capability does not imply authority.

## P-17

Experimental Claude capabilities always have stable fallbacks.

## P-18

Maximum capability must coexist with minimal onboarding.

## P-19

The system infers safe defaults instead of demanding configuration.

## P-20

Removing Claude must not destroy the conceptual Process model.

---

# 95. Anti-Patterns

The architecture must explicitly reject the following.

## Anti-pattern 1

```text
tasks table
+
Claude session ID
+
WebSocket
=
product
```

That is a Claude dashboard.

---

## Anti-pattern 2

Making every domain concept a Task.

---

## Anti-pattern 3

One giant `status` enum.

---

## Anti-pattern 4

One omnipotent AI project-manager agent.

---

## Anti-pattern 5

Using full transcripts as process memory.

---

## Anti-pattern 6

Treating AI output as authoritative truth by default.

---

## Anti-pattern 7

Silent last-write-wins between human and AI.

---

## Anti-pattern 8

Requiring Channels or other preview features for core behavior.

---

## Anti-pattern 9

Making users manually configure every plugin capability.

---

## Anti-pattern 10

Building ten integrations before Claude Code integration is exceptional.

---

# 96. First-Class Claude Philosophy

Claude integration must feel native enough that the user does not think:

> I am using another harness around Claude.

The desired experience is:

```text
install plugin
↓
login
↓
use Claude normally
```

while Process OS silently adds:

```text
durable process state
task synchronization
evidence
context restoration
live Kanban
steering
session intelligence
governance
organization visibility
```

Only advanced users need to understand the machinery.

---

# 97. What the User Ultimately Sees

A normal user sees:

```text
Organization
   ↓
Project / Case
   ↓
Kanban
   ↓
Active Move
```

and can:

```text
inspect
steer
pause
delegate
approve
ask WHY
```

The system handles:

```text
which Claude session
which subagent
which workflow
which worktree
which context capsule
which model
which retry
which verification mechanism
```

unless the user chooses to inspect those details.

---

# 98. Architectural Definition of Success

The architecture succeeds when all of the following are simultaneously true:

### Universality

A journalist, developer, procurement specialist, salesperson, researcher, and operations team can use the same kernel without pretending their work is software development.

### Deep Claude integration

Claude feels native, observable, steerable, and context-aware.

### Human clarity

A person can understand the process without reading terminal history.

### Human authority

Humans can intervene at any time where policy permits.

### AI autonomy

Agents can operate independently where policy permits.

### Durability

Processes survive sessions, contexts, machines, retries, and executors.

### Explainability

Every important derived state has a causal explanation.

### Evidence

Completion means something stronger than an agent claiming success.

### Organizational scale

The model supports multiple users, teams, departments, machines, and Cases.

### Easy onboarding

A useful experience appears almost immediately after installation.

---

# 99. Final Architecture Statement

Universal Process OS is:

> **a centralized, event-sourced, semantic control plane for arbitrary evolving Cases, coupled to distributed human and machine execution edges, with Claude Code as the first deeply native cognitive runtime.**

Kanban is:

> **the primary human operational cockpit for work-like process state, fully bidirectional and capable of live steering.**

Claude Code is:

> **a powerful execution ISA consisting of sessions, tasks, subagents, teams, workflows, hooks, worktrees, messaging, monitors, and context lifecycle primitives.**

The Process Edge is:

> **the secure local bridge translating between universal semantic commands and runtime-specific execution.**

The Case Runtime is:

> **the durable source of organizational process truth.**

The Context Orchestrator is:

> **the mechanism that makes sessions disposable while preserving process cognition.**

The Event Ledger is:

> **the causal memory from which state, WHY, audit, time travel, and process intelligence emerge.**

The long-term differentiator is not a prettier Kanban.

It is the combination of:

```text
Universal process semantics
        +
Human operational control
        +
Frontier-agent execution
        +
Durable context
        +
Evidence and governance
        +
Organizational process intelligence
```

delivered behind an experience that should feel almost offensively simple:

```text
INSTALL
   ↓
LOGIN
   ↓
WORK
```

That is the architectural blueprint.