# Universal Process OS  
## Vision

**Status:** Vision  
**Product class:** Universal Process Control Plane / Universal Case Runtime  
**Primary initial execution platform:** Claude Code  
**Primary human interface:** Adaptive Process Cockpit with first-class Kanban  
**Core principle:** The process is durable. Agents, tasks, sessions, plans, and execution attempts are disposable.

---

# 1. Vision

Build a universal operating system for processes in which humans, frontier AI agents, software systems, external actors, rules, knowledge, evidence, resources, decisions, and events can participate in one coherent operational model.

The system must be capable of representing, coordinating, observing, steering, explaining, and improving processes of radically different kinds without forcing them into a software-development-shaped workflow.

It must work naturally for processes such as:

- software engineering;
- tender and procurement preparation;
- investigative journalism;
- scientific research;
- sales and negotiation;
- legal and compliance work;
- incident response;
- operations;
- logistics and physical production;
- hiring;
- creative production;
- publishing;
- audits;
- monitoring;
- long-running organizational processes;
- processes not anticipated when the platform was designed.

The first deeply integrated execution environment will be Claude Code.

Claude Code, however, is not the product's ontology, database, task system, or source of truth.

Claude Code is an extremely capable execution substrate connected to a larger process operating system.

The long-term product is therefore not:

> a better Claude task manager.

Nor:

> an AI-powered Kanban.

Nor:

> a project-management tool with agents.

It is:

> **A universal semantic control plane for evolving human and machine processes, with frontier AI as a native participant and Kanban as one of the primary human control surfaces.**

---

# 2. The Problem

Modern process-management systems make a foundational simplification:

```text
Task
  ↓
Status
  ↓
Assignee
  ↓
Done
```

This works tolerably well when the world is simple.

The world is usually not simple.

A real process contains things such as:

```text
goals
questions
unknowns
requirements
claims
decisions
people
organizations
documents
systems
resources
risks
evidence
obligations
permissions
deadlines
events
dependencies
commitments
approvals
exceptions
work
waiting
failed attempts
external changes
```

A task is only one possible manifestation of that reality.

Existing tools nevertheless force almost everything into tasks, comments, statuses, and custom fields.

The predictable result is that the representation becomes progressively less faithful to the process it is supposed to manage.

AI agents make this problem significantly worse.

An AI coding harness may internally:

- create tasks;
- split tasks;
- spawn agents;
- discover dependencies;
- revise plans;
- change assumptions;
- retry failed approaches;
- create artifacts;
- consume context;
- compact context;
- open new sessions;
- run tools;
- delegate work;
- wait for external state;
- ask humans for decisions.

Most of this activity is distributed temporally across terminal output, conversations, tool calls, task lists, agent sessions, and files.

The human is forced to reconstruct the actual state mentally.

Effectively:

```text
current_process_state =
    mentally_fold(all_previous_agent_activity)
```

This is an absurd interface for supervising increasingly autonomous systems.

The more capable frontier models become, the worse this problem gets.

The bottleneck shifts from:

> Can the model perform the work?

to:

> Can humans understand, supervise, redirect, verify, and govern everything the model is doing?

Universal Process OS exists to solve that problem.

---

# 3. Fundamental Product Thesis

The system begins with one important rejection:

> **A task is not the fundamental unit of a process.**

The fundamental unit is a **Case**.

A Case represents an evolving situation that matters.

Examples:

```text
Release software v2.4

Prepare UNDP tender ABC

Investigate procurement X

Resolve production outage

Evaluate acquisition target

Negotiate enterprise agreement

Investigate scientific hypothesis

Deliver 10 custom machines

Publish investigative article
```

A Case may have:

- a predetermined outcome;
- several possible acceptable outcomes;
- no known final outcome;
- no tasks at a particular moment;
- thousands of tasks;
- one human;
- hundreds of agents;
- external systems;
- physical resources;
- uncertain knowledge;
- changing requirements;
- indefinite lifetime.

This allows the system to model reality without pretending every process is a disguised sprint.

---

# 4. Processes Are Not Workflows

A workflow assumes that process evolution can be substantially described as:

```text
A
↓
B
↓
C
↓
D
```

Many real processes do not behave that way.

An investigation may evolve:

```text
Question
  ↓
Hypothesis
  ↓
Evidence
  ↓
Contradiction
  ↓
New actor discovered
  ↓
Three new questions
```

A negotiation may evolve:

```text
Proposal
  ↓
Interest
  ↓
New stakeholder appears
  ↓
Budget disappears
  ↓
Alternative scope proposed
  ↓
No deal
```

A production incident may evolve:

```text
Hypothesis A
  ↓
Evidence disproves A
  ↓
Impact doubles
  ↓
Emergency mitigation
  ↓
Hypothesis B
```

A tender may change because a contracting authority publishes a clarification that invalidates previously completed work.

Universal Process OS must therefore treat workflows as one useful expression of process behavior, not as the underlying truth.

---

# 5. Universal Semantic Model

The system should be built around a deliberately small universal semantic kernel.

The kernel deals with concepts such as:

## Case

The evolving situation being managed.

## Entity

Something relevant to the Case.

Examples:

```text
person
organization
document
contract
requirement
server
release
shipment
machine
source
hypothesis
invoice
```

## Relation

How entities relate.

Examples:

```text
DEPENDS_ON
SUPPORTS
CONTRADICTS
REQUIRES
OWNS
BLOCKS
SUPERSEDES
REPRESENTS
CONTAINS
```

## Event

Something that happened.

Examples:

```text
document received
build failed
supplier replied
human approved
deadline changed
agent completed attempt
requirement superseded
```

Events form durable history.

## Assertion

Something asserted about reality.

Assertions can represent:

```text
observation
claim
belief
hypothesis
evaluation
verified fact
```

They may carry:

```text
source
provenance
confidence
scope
time
validity
```

The system must never silently collapse:

```text
CLAIM
BELIEF
OBSERVATION
VERIFIED FACT
```

into the same thing.

## Intent

Something an actor or Case is trying to accomplish.

Intent may be:

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

This is critical because not every process seeks a predefined desired state.

Research may seek knowledge.

Negotiation may seek an acceptable agreement if one exists.

Investigation may seek justified conclusions.

Monitoring may have no terminal state at all.

## Rule

Something that constrains process behavior.

Examples:

```text
requirement
obligation
policy
permission
prohibition
deadline
approval rule
safety rule
invariant
```

## Actor

Something capable of intentional participation.

Examples:

```text
human
Claude
Pi
team
organization
external authority
software service
```

Actors have capabilities, but capability is not authority.

## Move

A proposed intentional intervention in the process.

Examples:

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

A conventional task is only one kind of Move.

This distinction is essential.

---

# 6. Kanban Remains First-Class

Kanban remains one of the product's primary interfaces.

It is not being replaced.

It is being upgraded from:

> task database rendered as columns

into:

> **a live bidirectional human control surface projected from process state.**

For suitable processes, the default view may still look familiar:

```text
BACKLOG
READY
ACTIVE
WAITING
NEEDS INPUT
VERIFY
DONE
```

But the card represents richer reality.

For example:

```text
AUTH-42
Refresh token handling

RUNNING
Claude/backend-2

Outcome evidence: 4/6
Risk: HIGH

Current activity:
integration verification

[STEER]
[PAUSE]
[STOP]
[FORK]
[DELEGATE]
```

Kanban is therefore not merely observational.

It is operational.

---

# 7. Bidirectional Human Control

A central principle of the system is:

> **Humans must be able to influence the process while it is happening.**

From the Kanban or other views, authorized humans should be able to:

```text
create
edit
remove
cancel
pause
resume
reassign
reprioritize
split
merge
fork
supersede
change dependencies
change deadlines
change acceptance criteria
attach evidence
add constraints
change executor
request verification
change risk
redirect an active attempt
```

This includes steering work that is already being executed.

Example:

```text
Claude is implementing approach A.
```

Human adds:

```text
Do not use Redis.
Preserve the public API.
Use PostgreSQL-backed sessions.
```

The system records this as an explicit process event and delivers the steering instruction to the active executor.

It must never rewrite history as if that instruction had existed from the beginning.

The process history must preserve:

```text
14:00 Attempt started under Intent v1

14:13 Human Steering issued

14:13 Constraint added

14:14 Attempt continued under Intent v2
```

That historical integrity is fundamental to explainability.

---

# 8. The Process Can Also Influence Itself

Humans are not the only actors capable of changing the process.

Authorized agents and controllers may:

- discover dependencies;
- propose new work;
- invalidate stale evidence;
- change priorities;
- detect risks;
- request decisions;
- escalate unresolved obligations;
- generate additional verification;
- pause unsafe work;
- recommend process restructuring.

These modifications are always represented explicitly.

The system must never allow invisible agent improvisation to become canonical process truth.

Every meaningful structural mutation has provenance.

---

# 9. Completion Is Proven, Not Declared

One of the defining principles of the product is:

> **Completion is derived from evidence and policy, not merely asserted by an executor.**

An agent saying:

```text
Done.
```

is not sufficient.

A software Move may require:

```text
implementation present
unit tests passed
integration tests passed
security review passed
documentation updated
```

A tender requirement may require:

```text
document present
eligibility proven
signature present
approval received
compliance mapping complete
```

A research Move may require:

```text
independent sources
contradictions addressed
confidence threshold reached
```

The system therefore distinguishes:

```text
Attempt finished
```

from:

```text
Move satisfied
```

and from:

```text
Intent satisfied
```

A failed Attempt does not imply a failed Move.

A failed Move does not necessarily imply a failed Case.

A negative experimental result may even satisfy a learning Intent perfectly.

---

# 10. Evidence Is a First-Class Object

Evidence must be more than an attachment.

Evidence should know:

```text
what it supports
what it contradicts
its source
its provenance
its scope
its timestamp
its validity
its freshness
its confidence
```

Evidence may become stale.

Example:

```text
Tests passed on commit A
```

does not prove:

```text
Current release passes tests
```

after commit B is introduced.

The system must be able to propagate that invalidation automatically.

This principle applies equally to:

- software tests;
- legal evidence;
- journalistic sources;
- procurement documents;
- business assumptions;
- research findings;
- operational measurements.

---

# 11. There Is No Universal Scalar Status

Real processes occupy multiple states simultaneously.

A Case can be:

```text
operational: ACTIVE
epistemic: UNCERTAIN
risk: HIGH
compliance: SATISFIED
attention: HUMAN_REQUIRED
temporal: ON_TRACK
resources: CONSTRAINED
```

The system therefore uses a multidimensional state model rather than one canonical `status`.

Different views project different dimensions.

Kanban may show execution lifecycle.

Management may show risk.

Compliance teams may show requirement satisfaction.

Researchers may show epistemic uncertainty.

Humans may see only what requires their attention.

---

# 12. Adaptive Views

Kanban is important, but it is not the only useful representation.

The same universal process model should produce domain-appropriate views automatically.

### Software

```text
Kanban
Dependency Graph
Agents
Evidence
Timeline
```

### Procurement

```text
Requirements
Compliance Matrix
Documents
Deadlines
Approvals
Kanban
```

### Investigation

```text
Questions
Claims
Sources
Evidence
Contradictions
Timeline
Kanban
```

### Sales

```text
Stakeholders
Commitments
Signals
Decisions
Next Moves
Timeline
```

### Incident Response

```text
Impact
Live Events
Hypotheses
Active Response
Risks
Timeline
```

### Research

```text
Hypotheses
Experiments
Evidence
Uncertainty
Branches
```

These views are projections.

They are never the source of truth.

---

# 13. Human Attention Is More Important Than Human Surveillance

A sufficiently autonomous system should not require humans to stare at boards all day.

The primary home screen should answer:

> What actually requires me?

For example:

```text
NEEDS YOU

CRITICAL
Approve production rollback

HIGH
Resolve tender requirement ambiguity

MEDIUM
Choose between architecture A and B

Autonomous work:
42 active
18 waiting
387 satisfied
```

The purpose of autonomy is to reduce human supervision load, not to produce a more elaborate dashboard that must be babysat.

Kanban remains available for inspection and intervention.

The attention layer determines what deserves human cognition.

---

# 14. Claude Code as the First Native Execution Runtime

Claude Code is the ideal first execution platform because modern Claude Code already provides a rich agent runtime with:

- plugins;
- skills;
- hooks;
- MCP;
- custom agents;
- subagents;
- Agent Teams;
- dynamic workflows;
- background execution;
- cross-session coordination;
- worktrees;
- scheduled behavior;
- context lifecycle events;
- task lifecycle events;
- external-event integration;
- native execution controls.

Universal Process OS should exploit these capabilities deeply rather than rebuilding them badly.

The architecture should therefore treat Claude Code features as execution primitives.

The process expresses:

> what should happen and under what constraints.

The execution layer determines:

> how Claude should execute it.

For example:

```text
small isolated investigation
→ subagent

parallel independent research
→ dynamic workflow

continuous peer collaboration
→ Agent Team

isolated coding attempt
→ worktree + background session

external waiting
→ event/monitor/channel

human-authority requirement
→ attention queue
```

The user should not need to choose these mechanisms manually.

The system should.

---

# 15. Claude Code Is Not the Source of Truth

This principle is non-negotiable.

Claude-native tasks, sessions, agents, and workflows are execution structures.

They are not canonical process objects.

For example:

```text
Move M-91
Prepare technical methodology

    ↓

Attempt A-4
executed by Claude Code

    ↓

Claude Task 17
Claude Task 18
Claude Task 19
```

The Move survives even if:

- Claude creates different tasks;
- the session is compacted;
- the session crashes;
- the work is resumed elsewhere;
- another agent continues;
- the human takes over;
- the execution strategy changes completely.

The process must outlive its executor.

---

# 16. Context Is Part of Process Orchestration

Managing AI work without managing context is incomplete.

Universal Process OS must therefore contain a **Context Orchestrator**.

It understands:

```text
Case
Move
Attempt
Session
context utilization
relevant knowledge
stale knowledge
active constraints
decisions
evidence
phase of work
```

The system must make intelligent decisions such as:

```text
CONTINUE
COMPACT
ROTATE SESSION
START FRESH SESSION
FORK
DELEGATE
OFFLOAD TO SUBAGENT
```

Context management must not be driven only by token percentage.

The system should consider:

```text
context pressure
semantic relevance
task phase
stale assumptions
tool-output bloat
number of pivots
contradictions
remaining expected work
```

---

# 17. Conversation Context Is Disposable

One of the strongest product principles is:

> **Conversation context is disposable. Process context is durable.**

A Claude session may be:

- cleared;
- compacted;
- resumed;
- forked;
- replaced;
- terminated.

The process should continue unaffected.

Before a context transition, the system can construct a structured **Context Capsule** containing only what matters:

```text
Case
Intent
Move
Attempt
current reality
important decisions
constraints
completed work
failed approaches
open questions
dependencies
evidence
relevant files
next logical actions
```

A new or refreshed Claude session receives the relevant capsule.

The process therefore no longer depends on one conversation remaining coherent forever.

---

# 18. Sessions Become Cognitive Resources

A session should not be visible as the primary unit of work.

The user sees:

```text
Move M42
RUNNING
```

Internally:

```text
Attempt A7
 ├─ Session S18
 ├─ Session S24
 └─ Session S29

Verification
 └─ Session S31
```

Sessions become implementation details.

The Context Orchestrator may rotate them automatically when doing so improves reasoning quality.

This allows the system to treat frontier models as replaceable cognitive workers rather than fragile conversations that must be preserved indefinitely.

---

# 19. Central Control Plane

The organizational product should be centralized.

A service such as:

```text
ai-kanban.yoda.digital
```

can act as the Universal Process Control Plane.

It manages:

```text
Organizations
Workspaces
Teams
Users
Cases
Processes
Actors
Moves
Rules
Evidence
Events
Agents
Executors
Attention
Views
Analytics
```

The organizational source of truth belongs here.

Local machines maintain the execution state required for reliable operation.

The desired architecture is:

```text
central-authoritative
+
local execution
+
offline resilient
```

rather than attempting to synchronize multiple competing local truths.

---

# 20. Claude Code Plugin

The Claude Code integration should be distributed as a normal plugin, ideally through a marketplace.

The plugin acts as a first-class **execution edge adapter**.

Conceptually:

```text
Claude Code
     │
     ▼
Process Plugin
     │
     ▼
Universal Process Control Plane
```

The plugin provides the bridge between Claude-native execution events and universal process semantics.

It should feel ambient.

Claude remains Claude.

Users should not have to adopt a completely rewritten harness merely to participate in Process OS.

---

# 21. Optional Autonomous Runner

Most users should need only the plugin.

For fully autonomous use, an optional lightweight runner can allow the control plane to launch or resume Claude execution even when no interactive Claude session is currently open.

This enables:

```text
Human creates Move in browser
        ↓
Scheduler assigns Claude
        ↓
Local runner starts session
        ↓
Context hydrated
        ↓
Work begins
```

The runner is an execution capability, not a separate conceptual product.

Its installation should be automatic and optional.

---

# 22. Ultra-Easy Onboarding

Maximum functionality must not produce maximum ceremony.

The target onboarding experience is:

```text
1. Install
2. Login
3. Work
```

A useful board should exist before the user manually configures anything.

The platform should infer safely detectable information such as:

```text
user
machine
repository
project
branch
worktree
Claude session
existing tasks
available capabilities
organizational membership
```

If the current workspace appears to contain a software project, the system should infer that.

If it appears to contain tender documentation, the system should detect requirements and suggest an appropriate process model.

If the user imports existing work, the system should reconstruct as much process state as possible.

The principle is:

> **Anything the system can infer safely, the user should not be forced to configure manually.**

Complexity belongs inside the product.

Not inside onboarding.

---

# 23. Progressive Power

The system should be simple immediately and deep indefinitely.

### Minute 1

```text
Board appears automatically.
```

### Day 1

User discovers:

```text
steering
dependencies
agents
evidence
```

### Week 1

User discovers:

```text
automation
rules
process packs
adaptive views
```

### Month 1

Organization uses:

```text
departments
analytics
governance
process intelligence
```

### Enterprise

```text
SSO
SCIM
advanced policy
self-hosting
audit
custom packs
custom executors
```

A user should never need to understand the entire architecture to benefit from it.

---

# 24. Extensibility Instead of Ontological Bloat

Universality must not be achieved by adding every possible domain concept to the core.

The kernel must remain small.

Domain-specific behavior belongs in extension packs.

Examples:

```text
software
procurement
journalism
legal
research
sales
logistics
```

Process-behavior packs may separately describe:

```text
investigation
incident
negotiation
review
approval
selection
monitoring
compliance
production
```

They can be composed.

For example:

```text
procurement
+
compliance
+
production
+
approval
```

or:

```text
journalism
+
investigation
+
publication review
```

This provides universality through composition rather than by turning the kernel into a catalog of every noun humanity has invented.

---

# 25. Multi-Executor by Design

Claude Code is the first and deepest executor.

It must not be the only one the architecture can represent.

A Move may eventually be executed by:

```text
Claude Code
human
Pi
Codex
external API
CI system
business application
webhook
organization
```

Or:

```text
nobody
```

because `WAIT` may itself be legitimate process behavior.

The universal protocol is therefore conceptually:

```text
Process produces Moves.
Executors perform Attempts.
Attempts produce Events and Evidence.
Events update Process state.
```

This relationship is more durable than any one agent implementation.

---

# 26. Process Intelligence

Structured process history becomes one of the system's most valuable assets.

Over time, the platform can learn:

```text
where processes actually stall

which requirements usually create rework

which evidence is frequently missing

which approvals become critical paths

which executor strategies work best

which process steps are routinely bypassed

where humans repeatedly intervene

which process structures should evolve
```

This is not model memory.

It is structured operational knowledge.

The system can compare:

```text
designed process
vs
observed process
```

and propose improvements.

---

# 27. Explainability as a Core UX Primitive

Every meaningful derived state should be explainable.

The interface should offer a universal:

# WHY?

Examples:

```text
WHY blocked?

WHY this agent?

WHY now?

WHY did this requirement reopen?

WHY is this evidence stale?

WHY does this need human approval?

WHY did the process change?

WHY was this Attempt stopped?
```

The answer should be derived from causal process history.

Example:

```text
Requirement R12 changed
    ↓
Evidence E8 became invalid
    ↓
Compliance C4 became unsatisfied
    ↓
Move M17 was generated
    ↓
Release M28 became blocked
```

This makes autonomous execution legible.

---

# 28. Time Travel

Because process history is durable, the system should allow users to inspect:

> What did the process look like at time T?

The system can reconstruct:

```text
known information
beliefs
rules
active work
agents
risks
evidence
dependencies
decisions
```

as they existed at that point.

This enables:

- auditing;
- debugging;
- incident analysis;
- legal review;
- process improvement;
- understanding why an agent acted as it did.

---

# 29. Autonomy Is Configurable

Different organizations and Cases require different levels of autonomy.

A Case should support policies roughly analogous to:

### Observe

Agents inspect but do not modify process state.

### Suggest

Agents propose changes.

Humans approve them.

### Operate

Agents can modify and execute within explicit boundaries.

### Autonomous

Agents manage most of the process and escalate exceptions.

### High Autonomy Within Policy

Agents may:

```text
create Moves
replan
spawn agents
fork approaches
choose execution strategy
close evidence-backed work
```

subject to:

```text
authority
risk
cost
deadline
tool policy
human approval requirements
```

Autonomy is therefore policy-controlled rather than binary.

---

# 30. Authority Is Different From Capability

A frontier model may be capable of making a recommendation.

That does not mean it is authorized to make the decision.

The system must represent:

```text
capability
authority
permission
delegation
responsibility
```

separately.

This becomes essential in:

- finance;
- legal;
- healthcare coordination;
- security;
- procurement;
- management;
- production;
- compliance.

A process may explicitly require:

```text
human-authoritative decision
```

while still allowing AI to gather evidence, summarize tradeoffs, and recommend an option.

---

# 31. Security Principle

A centralized control plane connected to local AI harnesses must never become a remote-shell system disguised as task management.

The cloud should issue semantic commands such as:

```text
StartMove
SteerAttempt
PauseMove
CancelMove
AddConstraint
RequestEvidence
ChangePriority
```

not arbitrary local shell instructions.

Local execution adapters remain responsible for enforcing:

```text
identity
authority
policy
scope
permissions
command validity
```

Central coordination must not require surrendering local-machine trust boundaries.

---

# 32. Privacy Principle

The process control plane does not need every prompt, file, terminal output, or conversation transcript by default.

Default synchronization should prioritize structured process events and metadata.

Sensitive content may remain local while central state contains:

```text
reference
hash
classification
summary
provenance
```

Organizations should be able to select progressively richer storage modes, including self-hosted deployment where required.

---

# 33. Product Experience

The desired feeling is not:

> I am managing AI agents.

It is:

> **I am managing the work, and the system handles the agents.**

A human opens the platform and sees the organization:

```text
AI
Delivery
Sales
Media
Operations
```

then Processes:

```text
Tender ABC
Release 2.4
Investigation X
Client Y
Incident Z
```

then Moves:

```text
running
waiting
needs human
at risk
verified
```

The human can inspect deeply when necessary.

But ordinarily the system should hide unnecessary machinery.

The same philosophy applies to context:

The user should not normally care whether a Move required:

```text
Session A
→ compact
→ Session B
→ subagent C
→ verification session D
```

The user cares whether:

```text
Move M42
```

is progressing correctly.

---

# 34. What Makes the Product Potentially Revolutionary

None of the individual ideas is unprecedented.

The potential innovation is their composition into one coherent operational system:

```text
universal semantic process model
+
event-sourced history
+
evidence-derived completion
+
epistemic state
+
governance and authority
+
adaptive process evolution
+
human attention routing
+
bidirectional Kanban control
+
AI execution orchestration
+
context orchestration
+
session lifecycle management
+
process mining
+
multi-executor architecture
+
extreme onboarding simplicity
```

Most existing tools begin with tasks and add AI.

This system begins with reality and allows tasks and AI execution to emerge from it.

That is a fundamentally different direction.

---

# 35. Non-Negotiable Invariants

## INV-01

A task is not process truth.

## INV-02

A Case may exist without Tasks.

## INV-03

A process is not required to have a predetermined final state.

## INV-04

A process does not have one universal scalar status.

## INV-05

Claims, observations, beliefs, hypotheses, and verified facts must remain distinguishable.

## INV-06

Evidence must be contextual, temporal, provenance-aware, and invalidatable.

## INV-07

External reality may advance a process without internal work occurring.

## INV-08

Waiting is legitimate process behavior.

## INV-09

A failed Attempt does not imply a failed Move, Intent, or Case.

## INV-10

Negative outcomes may satisfy learning or investigative Intents.

## INV-11

Process structure may evolve during execution.

## INV-12

Every structural mutation preserves causality.

## INV-13

Every derived state must be explainable.

## INV-14

Capability and authority are separate concepts.

## INV-15

AI recommendations do not automatically become authoritative decisions.

## INV-16

Views are projections, never sources of truth.

## INV-17

Claude-native state is execution state, not canonical process state.

## INV-18

Human steering must remain possible while execution is active.

## INV-19

Conversation context is disposable.

## INV-20

Process context is durable.

## INV-21

Context orchestration is part of process orchestration.

## INV-22

Universality comes from extensibility and semantic composition, not from enumerating every domain inside the kernel.

## INV-23

The system must remain conceptually meaningful even if Claude Code is completely absent.

## INV-24

Maximum capability must not require maximum configuration.

## INV-25

Anything that can be inferred safely should not require manual user configuration.

---

# 36. The Ultimate Product Test

Remove Claude Code.

Does the Case still make sense?

If not, the product is merely a Claude dashboard.

Remove Kanban.

Does the process still exist?

If not, the product is merely a task manager.

Remove the current session.

Does the work survive?

If not, the product is merely a conversation harness.

Remove the current agent.

Can another authorized executor continue?

If not, the product is merely agent-specific orchestration.

Change the domain from software engineering to journalism, procurement, sales, logistics, or research.

Does the semantic model remain coherent?

If not, the product is not universal.

These are the tests the architecture must continuously survive.

---

# 37. Final Vision

Universal Process OS should make increasingly autonomous work **understandable, steerable, durable, governable, and organization-scale**.

The system should let a user move from:

```text
"What the hell is Claude doing?"
```

to:

```text
"I know what the process is trying to achieve,
what is happening,
why it is happening,
what evidence exists,
what requires me,
and I can intervene at any moment."
```

The technical machinery underneath may include multiple agents, multiple sessions, context rotation, event streams, process controllers, policies, evidence graphs, external systems, dynamic workflows, and domain-specific logic.

The human experience should remain simple:

```text
Install
↓
Login
↓
Work
```

The product's deepest principle is therefore:

> **Complexity belongs inside the system. Clarity belongs at the surface.**

And its defining architectural idea is:

> **The process survives everything: tasks, agents, sessions, context windows, plans, failures, and execution strategies may change, but the Case and its causal history remain coherent.**

That is the product.