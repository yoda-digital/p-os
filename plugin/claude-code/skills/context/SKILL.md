---
name: context
description: View and manage session context health
---

# Context — Context Capsule & Health

Trigger this skill when the user asks to see the full process context,
check "context health", or before a long/complex task where grounding in
the full 11-section capsule matters more than the short `process` summary.

## Steps

1. Call `process.context.get` (optionally with `case_id`) to fetch the full
   Context Capsule: IDENTITY, INTENT, REALITY, DECISIONS, CONSTRAINTS,
   PROGRESS, DEPENDENCIES, EVIDENCE, DELTA, NEXT, DO NOT REPEAT (spec
   section 7.1).
2. Present it section by section, in order — this is a grounding document,
   not a chat summary. Preserve the section headers so the user can scan
   it.
3. Call out explicitly:
   - **DO NOT REPEAT** — repeating a superseded or failed approach here is
     a real regression, not a style issue.
   - **CONSTRAINTS** — active rules and steering constraints in force.
   - **DELTA** — what changed since the last session (only populated on
     resume/compact/fork).
4. If the user means *context window* health (token budget, compaction
   risk) rather than the Process OS Context Capsule, clarify which one they
   mean before proceeding — this skill covers the process capsule
   specifically.
5. If `process.context.get` reports no cached capsule and the control plane
   is unreachable, fall back to `process.case.get` plus `process.move.list`
   for a partial picture, and say clearly that it's partial.

## Notes

The capsule is generated from canonical event-sourced state (control
plane) plus local cache (spec section 7.2) — a local cache hit is
near-instant; a cache miss fetches from the control plane.
